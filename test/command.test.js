const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../package.json');
const { reset, openAtCursor } = require('./helpers');

beforeEach(reset);

const twoPaths = 'cp "data/a.csv" "docs/guide.md"  # copy';

test('Alt+O (Cmd+Alt+O on macOS) runs the command in the editor', () => {
  assert.deepEqual(manifest.contributes.keybindings, [
    { command: 'clickOpenPath.openPathAtCursor', key: 'alt+o', mac: 'cmd+alt+o', when: 'editorTextFocus' },
  ]);
  assert.deepEqual(manifest.contributes.commands.map((c) => c.command), ['clickOpenPath.openPathAtCursor']);
});

test('the path under the cursor is opened, even with several on the line', async () => {
  const { opened, picks } = await openAtCursor(twoPaths, { cursor: 'guide' });
  assert.deepEqual(opened, [{ target: 'docs/guide.md' }]);
  assert.deepEqual(picks, []);
});

test('the only path on the line is opened wherever the cursor is', async () => {
  const { opened } = await openAtCursor('df = read_csv("data/a.csv")  # load', { cursor: 'load' });
  assert.deepEqual(opened, [{ target: 'data/a.csv' }]);
});

test(':line:column puts the cursor there', async () => {
  const { opened } = await openAtCursor('see data/a.csv:10:4', { cursor: 'see' });
  assert.deepEqual(opened, [{ target: 'data/a.csv', line: 9, character: 3 }]);
});

test('several paths and the cursor on none: a list, nearest first', async () => {
  const { opened, picks, descriptions } = await openAtCursor(twoPaths, { cursor: 'copy' });
  assert.deepEqual(picks, [['docs/guide.md', 'data/a.csv']]);
  assert.deepEqual(descriptions, [['docs/guide.md', 'data/a.csv']]);
  assert.deepEqual(opened, [{ target: 'docs/guide.md' }]);
});

test('the list follows the cursor', async () => {
  const { picks } = await openAtCursor(twoPaths, { cursor: 'cp' });
  assert.deepEqual(picks, [['data/a.csv', 'docs/guide.md']]);
});

test('closing the list opens nothing', async () => {
  const { opened, picks } = await openAtCursor(twoPaths, { cursor: 'copy', pick: () => undefined });
  assert.equal(picks.length, 1);
  assert.deepEqual(opened, []);
});

test('a selection opens what is selected, even if it is not found by itself', async () => {
  const spaces = await openAtCursor('see my data/a b.csv now', { select: 'my data/a b.csv' });
  assert.deepEqual(spaces.opened, [{ target: 'my data/a b.csv' }]);
  const bareName = await openAtCursor('run main.py first', { select: 'main.py' });
  assert.deepEqual(bareName.opened, [{ target: 'main.py' }]);
});

test('quotes and spaces around the selection are ignored', async () => {
  const { opened, picks } = await openAtCursor('cp "data/a.csv:3" "docs/guide.md"', { select: ' "data/a.csv:3"' });
  assert.deepEqual(opened, [{ target: 'data/a.csv', line: 2, character: 0 }]);
  assert.deepEqual(picks, []);
});

test('a whole line selected with a triple click', async () => {
  const { opened, status } = await openAtCursor('see my data/a b.csv\nnext line', { select: 'see my data/a b.csv\n' });
  assert.deepEqual([opened, status], [[], ['$(info) File not found: see my data/a b.csv']]);
  const pathLine = await openAtCursor('my data/a b.csv\nx = "docs/guide.md"', { select: 'my data/a b.csv\n' });
  assert.deepEqual(pathLine.opened, [{ target: 'my data/a b.csv' }]);
});

test('a selection that is not a file falls back to the cursor', async () => {
  const { opened, status } = await openAtCursor('read("docs/guide.md")', { select: 'guide' });
  assert.deepEqual(opened, [{ target: 'docs/guide.md' }]);
  assert.deepEqual(status, []);
});

test('a selection over several lines is ignored, the line where it starts is used', async () => {
  const { opened } = await openAtCursor('x = "data/a.csv"\ny = "docs/guide.md"', { select: 'a.csv"\ny = "docs' });
  assert.deepEqual(opened, [{ target: 'data/a.csv' }]);
  const empty = await openAtCursor('nothing\nhere', { select: 'nothing\nhere' });
  assert.deepEqual(empty.status, ['$(info) No file path on this line']);
});

test('nothing found: a short message in the status bar', async () => {
  const none = await openAtCursor('x = total / count', { cursor: 'count' });
  assert.deepEqual([none.opened, none.status], [[], ['$(info) No file path on this line']]);
  const missing = await openAtCursor('x = "data/missing.csv"', { cursor: 'missing' });
  assert.deepEqual([missing.opened, missing.status], [[], ['$(info) File not found: data/missing.csv']]);
  const selected = await openAtCursor('see nothing here', { select: 'nothing' });
  assert.deepEqual(selected.status, ['$(info) File not found: nothing']);
});

test('unquotedPaths: false is respected', async () => {
  const { opened, status } = await openAtCursor('see docs/guide.md', {
    cursor: 'guide',
    settings: { unquotedPaths: false },
  });
  assert.deepEqual([opened, status], [[], ['$(info) No file path on this line']]);
});

test('notebook cells', async () => {
  const { opened } = await openAtCursor('x = "helper.py"', {
    cursor: 'x',
    file: 'src/analysis.ipynb',
    scheme: 'vscode-notebook-cell',
  });
  assert.deepEqual(opened, [{ target: 'src/helper.py' }]);
});

test('works with permanent underline too', async () => {
  const { opened } = await openAtCursor('x = "data/a.csv"', { cursor: 'x', settings: { underline: true } });
  assert.deepEqual(opened, [{ target: 'data/a.csv' }]);
});
