const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STRING_RE = /(["'`])((?:\\.|(?!\1)[^\\\r\n])+)\1/g;
const QUOTE_RE = /["'`]/;
const LINE_SUFFIX_RE = /^(.*?)(?::(\d+)(?::(\d+))?)?$/;
const BARE_RE = /(?:\b[A-Za-z]:(?=[\\/]))?[\p{L}\p{N}\p{M}_.~/\\+@%-]+(?::\d+(?::\d+)?)?/gu;
const WORD_RE = /[\p{L}\p{N}]/u;

const SELECTOR = [{ scheme: 'file' }, { scheme: 'untitled' }, { scheme: 'vscode-notebook-cell' }];
const FILE_SCHEMES = ['file', 'vscode-notebook-cell'];
const STAT_TTL_MS = 2000;
const STAT_CACHE_LIMIT = 10000;
const LINE_WINDOW = 1000;

function looksLikePath(s) {
  if (s.length < 2 || s.length > 500) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return false;
  if (/\s{2,}|[<>|*?"]/.test(s)) return false;
  return /[\\/]/.test(s) || /\.[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*$/.test(s);
}

function expandHome(p) {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

function isRemotePath(p) {
  return /^[\\/]{2}/.test(p) || p.startsWith('/net/');
}

function documentFile(document) {
  return FILE_SCHEMES.includes(document.uri.scheme) ? vscode.Uri.file(document.uri.fsPath) : null;
}

function settings(document) {
  const scope = document && (documentFile(document) || document.uri);
  return vscode.workspace.getConfiguration('clickOpenPath', scope);
}

function candidateRoots(document, config) {
  const roots = [];
  const file = documentFile(document);
  if (file) roots.push(path.dirname(file.fsPath));
  const folder = vscode.workspace.getWorkspaceFolder(file || document.uri);
  const folders = folder ? [folder] : vscode.workspace.workspaceFolders || [];
  for (const f of folders) roots.push(f.uri.fsPath);
  for (const r of config.get('searchRoots') || []) {
    const expanded = expandHome(r);
    if (path.isAbsolute(expanded)) roots.push(expanded);
    else for (const f of folders) roots.push(path.join(f.uri.fsPath, expanded));
  }
  return [...new Set(roots)];
}

const statCache = new Map();

function isFile(p) {
  const now = Date.now();
  const hit = statCache.get(p);
  if (hit && now - hit.time < STAT_TTL_MS) return hit.result;
  if (statCache.size > STAT_CACHE_LIMIT) {
    for (const [key, entry] of statCache) if (now - entry.time >= STAT_TTL_MS) statCache.delete(key);
  }
  const result = fs.promises.stat(p).then((st) => st.isFile(), () => false);
  statCache.set(p, { time: now, result });
  return result;
}

async function resolvePath(raw, roots) {
  const p = expandHome(raw);
  if (path.isAbsolute(p)) return !isRemotePath(p) && (await isFile(p)) ? p : null;
  for (const root of roots) {
    const full = path.resolve(root, p);
    if (isRemotePath(full) && !isRemotePath(root)) continue;
    if (await isFile(full)) return full;
  }
  return null;
}

function parseCandidate(start, match, quoted) {
  const [, raw, line, col] = match.match(LINE_SUFFIX_RE);
  const unescaped = quoted ? raw.replace(/\\\\/g, '\\') : raw;
  return {
    start,
    end: start + match.length,
    raw,
    rawPath: path.sep === '\\' ? unescaped : unescaped.replace(/\\/g, '/'),
    line: line && Math.max(1, Number(line)),
    col: col && Math.max(1, Number(col)),
  };
}

function quotedCandidates(text, offset = 0) {
  const result = [];
  for (const m of text.matchAll(STRING_RE)) {
    const start = offset + m.index + 1;
    const candidate = parseCandidate(start, m[2], true);
    if (looksLikePath(candidate.raw)) result.push(candidate);
    if (QUOTE_RE.test(m[2])) result.push(...quotedCandidates(m[2], start));
  }
  return result;
}

function bareCandidates(text, offset = 0) {
  const result = [];
  for (const m of text.matchAll(BARE_RE)) {
    if (text[m.index - 1] === ':') continue;
    const candidate = parseCandidate(offset + m.index, m[0].replace(/[.]+$/, ''), false);
    if (/[\\/]/.test(candidate.raw) && WORD_RE.test(candidate.raw)) result.push(candidate);
  }
  return result;
}

async function resolveCandidate(candidate, roots) {
  const resolved = await resolvePath(candidate.rawPath, roots);
  return resolved && { ...candidate, resolved };
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

class PathLinkProvider {
  async provideDocumentLinks(document, token) {
    const text = document.getText();
    const config = settings(document);
    if (text.length > config.get('maxFileSize')) return [];

    const roots = candidateRoots(document, config);
    const found = [];
    const add = (results) => {
      for (const r of results) if (r && !found.some((f) => overlaps(f, r))) found.push(r);
    };

    add(await Promise.all(quotedCandidates(text).map((c) => resolveCandidate(c, roots))));
    if (token.isCancellationRequested) return [];

    if (config.get('unquotedPaths')) {
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

class PathDefinitionProvider {
  async provideDefinition(document, position) {
    const lineText = document.lineAt(position.line).text;
    const ch = position.character;
    const from = lineText.length > 2 * LINE_WINDOW ? Math.max(0, ch - LINE_WINDOW) : 0;
    const text = lineText.slice(from, from + 2 * LINE_WINDOW);
    const contains = (c) => c.start <= ch && ch <= c.end;

    const config = settings(document);
    const candidates = quotedCandidates(text, from).filter(contains);
    if (config.get('unquotedPaths')) candidates.push(...bareCandidates(text, from).filter(contains));

    const roots = candidateRoots(document, config);
    for (const c of candidates) {
      const found = await resolveCandidate(c, roots);
      if (!found) continue;
      const line = found.line ? found.line - 1 : 0;
      const col = found.col ? found.col - 1 : 0;
      return [
        {
          originSelectionRange: new vscode.Range(position.line, found.start, position.line, found.end),
          targetUri: vscode.Uri.file(found.resolved),
          targetRange: new vscode.Range(line, col, line, col),
        },
      ];
    }
    return null;
  }
}

function activate(context) {
  const linkProvider = new PathLinkProvider();
  const definitionProvider = new PathDefinitionProvider();
  let registration = null;

  const register = () => {
    if (registration) registration.dispose();
    registration = settings().get('underline')
      ? vscode.languages.registerDocumentLinkProvider(SELECTOR, linkProvider)
      : vscode.languages.registerDefinitionProvider(SELECTOR, definitionProvider);
  };

  register();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('clickOpenPath')) register();
    }),
    { dispose: () => registration.dispose() }
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
