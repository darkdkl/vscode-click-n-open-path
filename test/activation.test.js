const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { reset, activate, changeSettings, fireConfigChange, activeRegistrations } = require('./helpers');

beforeEach(reset);

const kinds = () => activeRegistrations().map((r) => r.kind);

test('by default paths work like Go to Definition', () => {
  activate();
  assert.deepEqual(kinds(), ['definition']);
});

test('underline: true registers document links instead', () => {
  activate({ underline: true });
  assert.deepEqual(kinds(), ['link']);
});

test('saved files, unsaved documents and notebook cells of any language are covered', () => {
  activate();
  assert.deepEqual(activeRegistrations()[0].selector, [
    { scheme: 'file' },
    { scheme: 'untitled' },
    { scheme: 'vscode-notebook-cell' },
  ]);
});

test('switching underline replaces the provider right away', () => {
  activate();
  changeSettings({ underline: true });
  assert.deepEqual(kinds(), ['link']);
  changeSettings({ underline: false });
  assert.deepEqual(kinds(), ['definition']);
});

test('any extension setting re-registers the provider, other settings do not', () => {
  const { registrations } = require('./vscode-stub')._state;
  activate({ underline: true });
  changeSettings({ searchRoots: ['lib'] });
  assert.equal(registrations.length, 2);
  fireConfigChange(['editor.fontSize']);
  assert.equal(registrations.length, 2);
  assert.deepEqual(kinds(), ['link']);
});

test('deactivation removes the provider', () => {
  const context = activate();
  context.subscriptions.forEach((d) => d.dispose());
  assert.deepEqual(kinds(), []);
});
