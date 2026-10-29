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
const STATUS_TIMEOUT_MS = 4000;
const STATUS_TEXT_LIMIT = 80;

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

function contains(candidate: Candidate, ch: number): boolean {
  return candidate.start <= ch && ch <= candidate.end;
}

function lineCandidates(lineText: string, ch: number, config: vscode.WorkspaceConfiguration): Candidate[] {
  const from = lineText.length > 2 * LINE_WINDOW ? Math.max(0, ch - LINE_WINDOW) : 0;
  const text = lineText.slice(from, from + 2 * LINE_WINDOW);
  const candidates = quotedCandidates(text, from);
  if (config.get<boolean>('unquotedPaths')) candidates.push(...bareCandidates(text, from));
  return candidates;
}

function targetPosition(found: Found): vscode.Position {
  return new vscode.Position(found.line ? found.line - 1 : 0, found.col ? found.col - 1 : 0);
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
    const ch = position.character;
    const config = settings(document);
    const candidates = lineCandidates(document.lineAt(position.line).text, ch, config).filter((c) =>
      contains(c, ch)
    );

    const roots = candidateRoots(document, config);
    for (const c of candidates) {
      const found = await resolveCandidate(c, roots);
      if (!found) continue;
      const target = targetPosition(found);
      const link: vscode.LocationLink = {
        originSelectionRange: new vscode.Range(position.line, found.start, position.line, found.end),
        targetUri: vscode.Uri.file(found.resolved),
        targetRange: new vscode.Range(target, target),
      };
      return [link];
    }
    return null;
  }
}

async function openFound(found: Found): Promise<void> {
  const options: vscode.TextDocumentShowOptions = {};
  if (found.line) {
    const target = targetPosition(found);
    options.selection = new vscode.Range(target, target);
  }
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(found.resolved), options);
}

function escapeIcons(text: string): string {
  return text.replace(/\$\(/g, '\\$(');
}

function shorten(text: string): string {
  return text.length > STATUS_TEXT_LIMIT ? `${text.slice(0, STATUS_TEXT_LIMIT - 1)}…` : text;
}

function sameTarget(a: Found, b: Found): boolean {
  return a.resolved === b.resolved && a.line === b.line && a.col === b.col;
}

async function pickAndOpen(targets: Found[], lineText: string): Promise<void> {
  const items = targets.map((f) => ({
    label: escapeIcons(lineText.slice(f.start, f.end)),
    description: escapeIcons(vscode.workspace.asRelativePath(f.resolved)),
    found: f,
  }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Choose a file to open' });
  if (picked) await openFound(picked.found);
}

async function openPathAtCursor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const { document, selection } = editor;
  const config = settings(document);
  const roots = candidateRoots(document, config);

  const text = document.getText(selection).trim().replace(/^["'`]+|["'`]+$/g, '');
  const selected = /[\r\n]/.test(text) ? '' : text;
  if (selected) {
    const found = await resolveCandidate(parseCandidate(0, selected, false), roots);
    if (found) return openFound(found);
  }

  const cursor = selection.isEmpty ? selection.active : selection.start;
  const ch = cursor.character;
  const lineText = document.lineAt(cursor.line).text;
  const candidates = lineCandidates(lineText, ch, config);
  const found: Found[] = [];
  for (const r of await Promise.all(candidates.map((c) => resolveCandidate(c, roots)))) {
    if (r && !found.some((f) => overlaps(f, r))) found.push(r);
  }

  const atCursor = found.find((f) => contains(f, ch));
  if (atCursor) return openFound(atCursor);

  const distance = (f: Found) => (ch < f.start ? f.start - ch : ch - f.end);
  const targets = [...found]
    .sort((a, b) => distance(a) - distance(b))
    .filter((f, i, all) => all.findIndex((g) => sameTarget(f, g)) === i);
  if (targets.length === 1) return openFound(targets[0]);
  if (targets.length > 1) return pickAndOpen(targets, lineText);

  const missing = selected || candidates.find((c) => contains(c, ch))?.raw;
  vscode.window.setStatusBarMessage(
    `$(info) ${missing ? `File not found: ${escapeIcons(shorten(missing))}` : 'No file path on this line'}`,
    STATUS_TIMEOUT_MS
  );
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
    vscode.commands.registerCommand('clickOpenPath.openPathAtCursor', openPathAtCursor),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('clickOpenPath')) register();
    }),
    { dispose: () => registration?.dispose() }
  );
}

export function deactivate(): void {}
