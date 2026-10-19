const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { reset, definition } = require('./helpers');

beforeEach(reset);

test('Ctrl+hover over a quoted path underlines it and points to the file', async () => {
  assert.deepEqual(await definition('df = read_csv("data/a.csv")', 'a.csv'), {
    text: 'data/a.csv',
    target: 'data/a.csv',
    line: 0,
    character: 0,
  });
});

test(':line:column points to that position, zero-based', async () => {
  const result = await definition('x = "data/a.csv:10:4"', 'data');
  assert.equal(result.text, 'data/a.csv:10:4');
  assert.deepEqual([result.line, result.character], [9, 3]);
});

test('a path outside of quotes, with the cursor right after it', async () => {
  const result = await definition('# see docs/guide.md.', 'guide.md', 'guide.md'.length);
  assert.equal(result.text, 'docs/guide.md');
  assert.equal(result.target, 'docs/guide.md');
});

test('only the path in a quoted sentence is a target', async () => {
  const text = 'msg = "read data/a.csv first"';
  assert.equal((await definition(text, 'data')).text, 'data/a.csv');
  assert.equal(await definition(text, 'first'), null);
});

test('relative to the folder of the current file', async () => {
  assert.equal((await definition('x = "helper.py"', 'helper', 0, {}, 'src/app.py')).target, 'src/helper.py');
});

test('plain text, URLs and missing files have no target', async () => {
  assert.equal(await definition('df = read_csv("data/a.csv")', 'read_csv'), null);
  assert.equal(await definition('see https://example.com/docs/guide.md', 'guide'), null);
  assert.equal(await definition('x = "data/missing.csv"', 'missing'), null);
});

test('unquotedPaths: false ignores paths outside of quotes', async () => {
  assert.equal(await definition('# see docs/guide.md', 'guide', 0, { unquotedPaths: false }), null);
});
