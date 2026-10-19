const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STRING_RE = /(["'`])((?:(?!\1)[^\\\r\n])+)\1/g;
const LINE_SUFFIX_RE = /^(.*?)(?::(\d+)(?::(\d+))?)?$/;
const BARE_RE = /[\w.~/+@%=-]+(?::\d+(?::\d+)?)?/g;

function looksLikePath(s) {
  if (s.length < 2 || s.length > 500) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return false;
  if (/\s{2,}|[<>|*?"]/.test(s)) return false;
  return s.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(s);
}

function expandHome(p) {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

function settings() {
  return vscode.workspace.getConfiguration('clickOpenPath');
}

function candidateRoots(document) {
  const roots = [];
  if (document.uri.scheme === 'file') roots.push(path.dirname(document.uri.fsPath));
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const folders = folder ? [folder] : vscode.workspace.workspaceFolders || [];
  for (const f of folders) roots.push(f.uri.fsPath);
  const extra = settings().get('searchRoots') || [];
  for (const r of extra) {
    const expanded = expandHome(r);
    if (path.isAbsolute(expanded)) roots.push(expanded);
    else for (const f of folders) roots.push(path.join(f.uri.fsPath, expanded));
  }
  return [...new Set(roots)];
}

async function isFile(p, cache) {
  if (!cache.has(p)) {
    cache.set(p, fs.promises.stat(p).then((st) => st.isFile(), () => false));
  }
  return cache.get(p);
}

async function resolvePath(raw, roots, cache) {
  const p = expandHome(raw);
  if (path.isAbsolute(p)) return (await isFile(p, cache)) ? p : null;
  for (const root of roots) {
    const full = path.resolve(root, p);
    if (await isFile(full, cache)) return full;
  }
  return null;
}

function quotedCandidates(text) {
  const result = [];
  for (const m of text.matchAll(STRING_RE)) {
    if (looksLikePath(m[2].match(LINE_SUFFIX_RE)[1])) result.push({ start: m.index + 1, match: m[2] });
  }
  return result;
}

function bareCandidates(text) {
  const result = [];
  for (const m of text.matchAll(BARE_RE)) {
    const match = m[0].replace(/[.]+$/, '');
    const rawPath = match.match(LINE_SUFFIX_RE)[1];
    if (!rawPath.includes('/') || !/\w/.test(rawPath)) continue;
    if (text[m.index - 1] === ':') continue;
    result.push({ start: m.index, match });
  }
  return result;
}

async function resolveCandidate({ start, match }, roots, cache) {
  const [, rawPath, line, col] = match.match(LINE_SUFFIX_RE);
  const resolved = await resolvePath(rawPath, roots, cache);
  return resolved && { start, end: start + match.length, resolved, line, col };
}

class PathLinkProvider {
  async provideDocumentLinks(document, token) {
    const text = document.getText();
    const config = settings();
    if (text.length > config.get('maxFileSize')) return [];

    const roots = candidateRoots(document);
    const cache = new Map();

    const quoted = quotedCandidates(text).map((c) => resolveCandidate(c, roots, cache));
    const found = (await Promise.all(quoted)).filter(Boolean);
    if (token.isCancellationRequested) return [];

    if (config.get('unquotedPaths')) {
      const bare = bareCandidates(text)
        .filter((c) => !found.some((f) => c.start < f.end && c.start + c.match.length > f.start))
        .map((c) => resolveCandidate(c, roots, cache));
      found.push(...(await Promise.all(bare)).filter(Boolean));
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
    const text = document.lineAt(position.line).text;
    const ch = position.character;
    const contains = (c) => c.start <= ch && ch <= c.start + c.match.length;
    const candidates = quotedCandidates(text).filter(contains);
    if (settings().get('unquotedPaths')) candidates.push(...bareCandidates(text).filter(contains));

    const roots = candidateRoots(document);
    const cache = new Map();
    for (const c of candidates) {
      const found = await resolveCandidate(c, roots, cache);
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

const SELECTOR = [{ scheme: 'file' }, { scheme: 'untitled' }];

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
