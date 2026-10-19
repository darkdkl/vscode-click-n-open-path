const Module = require('module');
const fs = require('fs');
const path = require('path');

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') return require.resolve('./vscode-stub');
  return resolveFilename.call(this, request, ...rest);
};

const FIXTURES = path.join(__dirname, 'fixtures');
const PROJECT = path.join(FIXTURES, 'project');
const HOME = path.join(FIXTURES, 'home');
process.env.HOME = HOME;

const vscode = require('vscode');
const extension = require('../extension');

const state = vscode._state;
let context = null;

function reset() {
  if (context) context.subscriptions.forEach((d) => d.dispose());
  context = null;
  state.overrides = {};
  state.folderOverrides = {};
  state.workspaceFolders = [{ uri: vscode.Uri.file(PROJECT) }];
  state.configListeners.clear();
  state.registrations = [];
}

function activate(settings = {}) {
  if (context) context.subscriptions.forEach((d) => d.dispose());
  setSettings(settings);
  context = { subscriptions: [] };
  extension.activate(context);
  return context;
}

function setSettings(settings) {
  for (const [key, value] of Object.entries(settings)) state.overrides[`clickOpenPath.${key}`] = value;
}

function setFolderSettings(folder, settings) {
  state.folderOverrides[folder] = Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [`clickOpenPath.${key}`, value])
  );
}

function changeSettings(settings) {
  setSettings(settings);
  fireConfigChange(Object.keys(settings).map((key) => `clickOpenPath.${key}`));
}

function fireConfigChange(keys) {
  const event = {
    affectsConfiguration: (section) => keys.some((k) => k === section || k.startsWith(section + '.')),
  };
  for (const listener of [...state.configListeners]) listener(event);
}

function activeRegistrations() {
  return state.registrations.filter((r) => !r.disposed);
}

function provider(kind) {
  const found = activeRegistrations().filter((r) => r.kind === kind);
  if (found.length !== 1) throw new Error(`expected one active ${kind} provider, got ${found.length}`);
  return found[0].provider;
}

function createDocument(text, file = 'main.py', scheme = 'file') {
  const lines = text.split('\n');
  const offsetAt = ({ line, character }) =>
    lines.slice(0, line).reduce((sum, l) => sum + l.length + 1, 0) + character;
  const fsPath = scheme === 'untitled' ? file : path.join(PROJECT, file);
  return {
    uri: { scheme, fsPath },
    getText: (range) => (range ? text.slice(offsetAt(range.start), offsetAt(range.end)) : text),
    lineAt: (line) => ({ text: lines[line] }),
    positionAt(offset) {
      let line = 0;
      while (line < lines.length - 1 && offset > lines[line].length) {
        offset -= lines[line].length + 1;
        line++;
      }
      return new vscode.Position(line, offset);
    },
    positionOf(needle, shift = 0) {
      const index = text.indexOf(needle);
      if (index < 0) throw new Error(`"${needle}" is not in the document`);
      return this.positionAt(index + shift);
    },
  };
}

const NOT_CANCELLED = { isCancellationRequested: false };

async function links(text, settings = {}, file, scheme) {
  activate({ underline: true, ...settings });
  const doc = createDocument(text, file, scheme);
  const result = await provider('link').provideDocumentLinks(doc, NOT_CANCELLED);
  return result.map((l) => ({
    text: doc.getText(l.range),
    target: path.relative(PROJECT, l.target.fsPath),
    fragment: l.target.fragment,
  }));
}

async function definition(text, needle, shift = 0, settings = {}, file, scheme) {
  activate(settings);
  const doc = createDocument(text, file, scheme);
  const result = await provider('definition').provideDefinition(doc, doc.positionOf(needle, shift));
  if (!result) return null;
  const [link] = result;
  return {
    text: doc.getText(link.originSelectionRange),
    target: path.relative(PROJECT, link.targetUri.fsPath),
    line: link.targetRange.start.line,
    character: link.targetRange.start.character,
  };
}

async function watchStat(run, exists = () => false) {
  const original = fs.promises.stat;
  const calls = [];
  fs.promises.stat = async (p) => {
    calls.push(p);
    if (exists(p)) return { isFile: () => true };
    return original(p);
  };
  try {
    return { result: await run(), calls };
  } finally {
    fs.promises.stat = original;
  }
}

module.exports = {
  FIXTURES,
  PROJECT,
  HOME,
  vscode,
  reset,
  activate,
  setFolderSettings,
  changeSettings,
  fireConfigChange,
  activeRegistrations,
  links,
  definition,
  watchStat,
};
