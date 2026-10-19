const manifest = require('../package.json');

const DEFAULTS = Object.fromEntries(
  Object.entries(manifest.contributes.configuration.properties).map(([key, p]) => [key, p.default])
);

class Position {
  constructor(line, character) {
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
  workspaceFolders: [],
  configListeners: new Set(),
  registrations: [],
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
    getConfiguration(section) {
      return {
        get(key) {
          const full = `${section}.${key}`;
          return full in state.overrides ? state.overrides[full] : DEFAULTS[full];
        },
      };
    },
    getWorkspaceFolder(uri) {
      return state.workspaceFolders.find((f) => uri.fsPath.startsWith(f.uri.fsPath + '/'));
    },
    get workspaceFolders() {
      return state.workspaceFolders;
    },
    onDidChangeConfiguration(listener) {
      state.configListeners.add(listener);
      return { dispose: () => state.configListeners.delete(listener) };
    },
  },
  languages: {
    registerDocumentLinkProvider: (selector, provider) => register('link', selector, provider),
    registerDefinitionProvider: (selector, provider) => register('definition', selector, provider),
  },
  _state: state,
};
