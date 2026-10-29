import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface Candidate {
  start: number;
  end: number;
  raw: string;
  rawPath: string;
  line?: number;
  col?: number;
}

interface Found extends Candidate {
  resolved: string;
}

const STRING_RE = /(["'`])((?:\\.|(?!\1)[^\\\r\n])+)\1/g;
const QUOTE_RE = /["'`]/;
const LINE_SUFFIX_RE = /^(.*?)(?::(\d+)(?::(\d+))?)?$/;
const BARE_RE = /(?:\b[A-Za-z]:(?=[\\/]))?[\p{L}\p{N}\p{M}_.~/\\+@%-]+(?::\d+(?::\d+)?)?/gu;
const WORD_RE = /[\p{L}\p{N}]/u;

const SELECTOR: vscode.DocumentFilter[] = [
  { scheme: 'file' },
  { scheme: 'untitled' },
  { scheme: 'vscode-notebook-cell' },
];
const FILE_SCHEMES = ['file', 'vscode-notebook-cell'];
const STAT_TTL_MS = 2000;
const STAT_CACHE_LIMIT = 10000;
const LINE_WINDOW = 1000;

function looksLikePath(s: string): boolean {
  if (s.length < 2 || s.length > 500) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return false;
  if (/\s{2,}|[<>|*?"]/.test(s)) return false;
  return /[\\/]/.test(s) || /\.[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*$/.test(s);
}

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

function isRemotePath(p: string): boolean {
  return /^[\\/]{2}/.test(p) || p.startsWith('/net/');
}

function documentFile(document: vscode.TextDocument): vscode.Uri | undefined {
  return FILE_SCHEMES.includes(document.uri.scheme) ? vscode.Uri.file(document.uri.fsPath) : undefined;
}

function settings(document?: vscode.TextDocument): vscode.WorkspaceConfiguration {
  const scope = document && (documentFile(document) ?? document.uri);
  return vscode.workspace.getConfiguration('clickOpenPath', scope);
}

function candidateRoots(document: vscode.TextDocument, config: vscode.WorkspaceConfiguration): string[] {
  const roots: string[] = [];
  const file = documentFile(document);
  if (file) roots.push(path.dirname(file.fsPath));
  const folder = vscode.workspace.getWorkspaceFolder(file ?? document.uri);
  const folders = folder ? [folder] : vscode.workspace.workspaceFolders ?? [];
  for (const f of folders) roots.push(f.uri.fsPath);
  for (const r of config.get<string[]>('searchRoots') ?? []) {
    const expanded = expandHome(r);
    if (path.isAbsolute(expanded)) roots.push(expanded);
    else for (const f of folders) roots.push(path.join(f.uri.fsPath, expanded));
  }
  return [...new Set(roots)];
}

const statCache = new Map<string, { time: number; result: Promise<boolean> }>();

function isFile(p: string): Promise<boolean> {
  const now = Date.now();
  const hit = statCache.get(p);
  if (hit && now - hit.time < STAT_TTL_MS) return hit.result;
  if (statCache.size > STAT_CACHE_LIMIT) {
    for (const [key, entry] of statCache) if (now - entry.time >= STAT_TTL_MS) statCache.delete(key);
  }
  const result = fs.promises.stat(p).then(
    (st) => st.isFile(),
    () => false
  );
  statCache.set(p, { time: now, result });
  return result;
}

async function resolvePath(raw: string, roots: string[]): Promise<string | null> {
  const p = expandHome(raw);
  if (path.isAbsolute(p)) return !isRemotePath(p) && (await isFile(p)) ? p : null;
  for (const root of roots) {
    const full = path.resolve(root, p);
    if (isRemotePath(full) && !isRemotePath(root)) continue;
    if (await isFile(full)) return full;
  }
  return null;
}

function parseCandidate(start: number, match: string, quoted: boolean): Candidate {
  const [, raw = '', line, col] = match.match(LINE_SUFFIX_RE) ?? [];
  const unescaped = quoted ? raw.replace(/\\\\/g, '\\') : raw;
  return {
    start,
    end: start + match.length,
    raw,
    rawPath: path.sep === '\\' ? unescaped : unescaped.replace(/\\/g, '/'),
    line: line ? Math.max(1, Number(line)) : undefined,
    col: col ? Math.max(1, Number(col)) : undefined,
  };
}

function quotedCandidates(text: string, offset = 0): Candidate[] {
  const result: Candidate[] = [];
  for (const m of text.matchAll(STRING_RE)) {
    const start = offset + (m.index ?? 0) + 1;
    const candidate = parseCandidate(start, m[2], true);
    if (looksLikePath(candidate.raw)) result.push(candidate);
    if (QUOTE_RE.test(m[2])) result.push(...quotedCandidates(m[2], start));
  }
  return result;
}

function bareCandidates(text: string, offset = 0): Candidate[] {
  const result: Candidate[] = [];
  for (const m of text.matchAll(BARE_RE)) {
    const index = m.index ?? 0;
    if (text[index - 1] === ':') continue;
    const candidate = parseCandidate(offset + index, m[0].replace(/[.]+$/, ''), false);
    if (/[\\/]/.test(candidate.raw) && WORD_RE.test(candidate.raw)) result.push(candidate);
  }
  return result;
}

async function resolveCandidate(candidate: Candidate, roots: string[]): Promise<Found | null> {
  const resolved = await resolvePath(candidate.rawPath, roots);
  return resolved ? { ...candidate, resolved } : null;
}

function overlaps(a: Candidate, b: Candidate): boolean {
  return a.start < b.end && b.start < a.end;
}

class PathLinkProvider implements vscode.DocumentLinkProvider {
  async provideDocumentLinks(document: vscode.TextDocument, token: vscode.CancellationToken) {
    const text = document.getText();
    const config = settings(document);
    if (text.length > (config.get<number>('maxFileSize') ?? Infinity)) return [];

    const roots = candidateRoots(document, config);
    const found: Found[] = [];
    const add = (results: (Found | null)[]) => {
      for (const r of results) if (r && !found.some((f) => overlaps(f, r))) found.push(r);
    };

    add(await Promise.all(quotedCandidates(text).map((c) => resolveCandidate(c, roots))));
    if (token.isCancellationRequested) return [];

    if (config.get<boolean>('unquotedPaths')) {
      const bare = bareCandidates(text).filter((c) => !found.some((f) => overlaps(f, c)));
      add(await Promise.all(bare.map((c) => resolveCandidate(c, roots))));
      if (token.isCancellationRequested) return [];
    }

    return found.map(({ start, end, resolved, line, col }) => {
      let target = vscode.Uri.file(resolved);
      if (line) target = target.with({ fragment: col ? `L${line},${col}` : `L${line}` });
      const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
      const link = new vscode.DocumentLink(range, target);
      link.tooltip = resolved;
      return link;
    });
  }
}

class PathDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(document: vscode.TextDocument, position: vscode.Position) {
    const lineText = document.lineAt(position.line).text;
    const ch = position.character;
    const from = lineText.length > 2 * LINE_WINDOW ? Math.max(0, ch - LINE_WINDOW) : 0;
    const text = lineText.slice(from, from + 2 * LINE_WINDOW);
    const contains = (c: Candidate) => c.start <= ch && ch <= c.end;

    const config = settings(document);
    const candidates = quotedCandidates(text, from).filter(contains);
    if (config.get<boolean>('unquotedPaths')) candidates.push(...bareCandidates(text, from).filter(contains));

    const roots = candidateRoots(document, config);
    for (const c of candidates) {
      const found = await resolveCandidate(c, roots);
      if (!found) continue;
      const line = found.line ? found.line - 1 : 0;
      const col = found.col ? found.col - 1 : 0;
      const link: vscode.LocationLink = {
        originSelectionRange: new vscode.Range(position.line, found.start, position.line, found.end),
        targetUri: vscode.Uri.file(found.resolved),
        targetRange: new vscode.Range(line, col, line, col),
      };
      return [link];
    }
    return null;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const linkProvider = new PathLinkProvider();
  const definitionProvider = new PathDefinitionProvider();
  let registration: vscode.Disposable | undefined;

  const register = () => {
    registration?.dispose();
    registration = settings().get<boolean>('underline')
      ? vscode.languages.registerDocumentLinkProvider(SELECTOR, linkProvider)
      : vscode.languages.registerDefinitionProvider(SELECTOR, definitionProvider);
  };

  register();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('clickOpenPath')) register();
    }),
    { dispose: () => registration?.dispose() }
  );
}

export function deactivate(): void {}
