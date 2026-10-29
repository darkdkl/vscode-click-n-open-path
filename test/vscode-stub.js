const path = require('path');
const manifest = require('../package.json');

const DEFAULTS = Object.fromEntries(
  Object.entries(manifest.contributes.configuration.properties).map(([key, p]) => [key, p.default])
);

class Position {
  constructor(line, character) {
    if (line < 0) throw new Error('Illegal argument: line must be non-negative');
    if (character < 0) throw new Error('Illegal argument: character must be non-negative');
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(a, b, c, d) {
    if (a instanceof Position) {
      this.start = a;
      this.end = b;
    } else {
      this.start = new Position(a, b);
      this.end = new Position(c, d);
    }
  }
}

class Uri {
  constructor(scheme, fsPath, fragment = '') {
    this.scheme = scheme;
    this.fsPath = fsPath;
    this.fragment = fragment;
  }

  static file(fsPath) {
    return new Uri('file', fsPath);
  }

  with({ fragment }) {
    return new Uri(this.scheme, this.fsPath, fragment);
  }
}

class DocumentLink {
  constructor(range, target) {
    this.range = range;
    this.target = target;
  }
}

const state = {
  overrides: {},
  folderOverrides: {},
  workspaceFolders: [],
  configListeners: new Set(),
  registrations: [],
  commands: new Map(),
  executed: [],
  statusMessages: [],
  quickPicks: [],
  pick: (items) => items[0],
  activeTextEditor: undefined,
};

function register(kind, selector, provider) {
  const registration = { kind, selector, provider, disposed: false };
  state.registrations.push(registration);
  return { dispose: () => (registration.disposed = true) };
}

module.exports = {
  Position,
  Range,
  Uri,
  DocumentLink,
  workspace: {
    getConfiguration(section, scope) {
      const folder = scope && Object.keys(state.folderOverrides).find((f) => scope.fsPath.startsWith(f + '/'));
      const layers = [folder && state.folderOverrides[folder], state.overrides, DEFAULTS].filter(Boolean);
      return {
        get(key) {
          const full = `${section}.${key}`;
          return layers.find((layer) => full in layer)[full];
        },
      };
    },
    getWorkspaceFolder(uri) {
      return state.workspaceFolders.find((f) => uri.fsPath.startsWith(f.uri.fsPath + '/'));
    },
    get workspaceFolders() {
      return state.workspaceFolders;
    },
    asRelativePath(p) {
      const folder = state.workspaceFolders.find((f) => p.startsWith(f.uri.fsPath + '/'));
      return folder ? path.relative(folder.uri.fsPath, p) : p;
    },
    onDidChangeConfiguration(listener) {
      state.configListeners.add(listener);
      return { dispose: () => state.configListeners.delete(listener) };
    },
  },
  window: {
    get activeTextEditor() {
      return state.activeTextEditor;
    },
    async showQuickPick(items, options) {
      state.quickPicks.push({ items, options });
      return state.pick(items);
    },
    setStatusBarMessage(text) {
      state.statusMessages.push(text);
      return { dispose() {} };
    },
  },
  commands: {
    registerCommand(id, handler) {
      state.commands.set(id, handler);
      return { dispose: () => state.commands.delete(id) };
    },
    async executeCommand(id, ...args) {
      state.executed.push({ id, args });
    },
  },
  languages: {
    registerDocumentLinkProvider: (selector, provider) => register('link', selector, provider),
    registerDefinitionProvider: (selector, provider) => register('definition', selector, provider),
  },
  _state: state,
};
