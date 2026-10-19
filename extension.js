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

function candidateRoots(document) {
  const roots = [];
  if (document.uri.scheme === 'file') roots.push(path.dirname(document.uri.fsPath));
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const folders = folder ? [folder] : vscode.workspace.workspaceFolders || [];
  for (const f of folders) roots.push(f.uri.fsPath);
  const extra = vscode.workspace.getConfiguration('clickOpenPath').get('searchRoots') || [];
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

class PathLinkProvider {
  async provideDocumentLinks(document, token) {
    const text = document.getText();
    const config = vscode.workspace.getConfiguration('clickOpenPath');
    if (text.length > config.get('maxFileSize')) return [];

    const roots = candidateRoots(document);
    const cache = new Map();

    const resolveMatch = async (start, match) => {
      const [, rawPath, line, col] = match.match(LINE_SUFFIX_RE);
      const resolved = await resolvePath(rawPath, roots, cache);
      return resolved && { start, end: start + match.length, resolved, line, col };
    };

    const quoted = [];
    for (const m of text.matchAll(STRING_RE)) {
      const rawPath = m[2].match(LINE_SUFFIX_RE)[1];
      if (looksLikePath(rawPath)) quoted.push(resolveMatch(m.index + 1, m[2]));
    }
    const found = (await Promise.all(quoted)).filter(Boolean);
    if (token.isCancellationRequested) return [];

    if (config.get('unquotedPaths')) {
      const bare = [];
      for (const m of text.matchAll(BARE_RE)) {
        const match = m[0].replace(/[.]+$/, '');
        const start = m.index;
        const end = start + match.length;
        const rawPath = match.match(LINE_SUFFIX_RE)[1];
        if (!rawPath.includes('/') || !/\w/.test(rawPath)) continue;
        if (text[start - 1] === ':') continue;
        if (found.some((f) => start < f.end && end > f.start)) continue;
        bare.push(resolveMatch(start, match));
      }
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

const SELECTOR = [{ scheme: 'file' }, { scheme: 'untitled' }];
const REFRESH_DELAY_MS = 300;
const MAX_NAMES_TO_MATCH = 50;

function activate(context) {
  const provider = new PathLinkProvider();
  let registration = null;
  let watcher = null;
  let timer = null;
  const pendingNames = new Set();

  const autoRefresh = () => vscode.workspace.getConfiguration('clickOpenPath').get('autoRefresh');

  const register = () => {
    if (registration) registration.dispose();
    registration = vscode.languages.registerDocumentLinkProvider(SELECTOR, provider);
  };

  const flushFileEvents = () => {
    const names = [...pendingNames];
    pendingNames.clear();
    if (names.length > MAX_NAMES_TO_MATCH) return register();
    const docs = new Set(vscode.window.visibleTextEditors.map((e) => e.document));
    const texts = [...docs].map((d) => d.getText());
    if (names.some((n) => texts.some((t) => t.includes(n)))) register();
  };

  const onFileEvent = (uri) => {
    pendingNames.add(path.basename(uri.fsPath));
    clearTimeout(timer);
    timer = setTimeout(flushFileEvents, REFRESH_DELAY_MS);
  };

  const updateWatcher = () => {
    if (autoRefresh() && !watcher) {
      watcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false);
      watcher.onDidCreate(onFileEvent);
      watcher.onDidDelete(onFileEvent);
    } else if (!autoRefresh() && watcher) {
      watcher.dispose();
      watcher = null;
      clearTimeout(timer);
      pendingNames.clear();
    }
  };

  register();
  updateWatcher();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('clickOpenPath')) return;
      updateWatcher();
      if (autoRefresh()) register();
    }),
    {
      dispose() {
        clearTimeout(timer);
        if (watcher) watcher.dispose();
        if (registration) registration.dispose();
      },
    }
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
