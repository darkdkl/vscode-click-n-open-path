const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { FIXTURES, PROJECT, HOME, reset, links, setFolderSettings, watchStat } = require('./helpers');

beforeEach(reset);

test('a quoted path becomes a link without the quotes', async () => {
  assert.deepEqual(await links('df = read_csv("data/a.csv")'), [
    { text: 'data/a.csv', target: 'data/a.csv', fragment: '' },
  ]);
});

test('single quotes and backticks work too', async () => {
  const result = await links("open('data/a.csv')\nload(`docs/guide.md`)");
  assert.deepEqual(result.map((l) => l.target), ['data/a.csv', 'docs/guide.md']);
});

test('a bare file name in quotes is enough', async () => {
  assert.deepEqual((await links('run("main.py")')).map((l) => l.target), ['main.py']);
});

test('relative paths are resolved against the folder of the current file first', async () => {
  const result = await links('a = "helper.py"\nb = "../data/a.csv"\nc = "notes.md"', {}, 'src/app.py');
  assert.deepEqual(result.map((l) => l.target), ['src/helper.py', 'data/a.csv', 'src/notes.md']);
});

test('then against the workspace folder', async () => {
  const result = await links('read("docs/guide.md")', {}, 'src/app.py');
  assert.deepEqual(result.map((l) => l.target), ['docs/guide.md']);
});

test('then against searchRoots, relative or absolute', async () => {
  const extra = path.join(FIXTURES, 'extra');
  const result = await links('a = "util.py"\nb = "shared.txt"', { searchRoots: ['lib', extra] });
  assert.deepEqual(result.map((l) => l.target), ['lib/util.py', '../extra/shared.txt']);
});

test(':line and :line:column open the file at that position', async () => {
  assert.deepEqual(await links('a = "data/a.csv:10"\nb = "data/a.csv:10:4"'), [
    { text: 'data/a.csv:10', target: 'data/a.csv', fragment: 'L10' },
    { text: 'data/a.csv:10:4', target: 'data/a.csv', fragment: 'L10,4' },
  ]);
});

test('line or column 0 opens line 1 or column 1', async () => {
  const result = await links('a = "data/a.csv:0"\nb = "data/a.csv:10:0"');
  assert.deepEqual(result.map((l) => l.fragment), ['L1', 'L10,1']);
});

test('~ is expanded to the home folder', async () => {
  const [link] = await links('cfg = "~/notes.txt"');
  assert.equal(link.text, '~/notes.txt');
  assert.equal(path.resolve(path.join(FIXTURES, 'project'), link.target), path.join(HOME, 'notes.txt'));
});

test('paths outside of quotes: comments, YAML, Markdown, shell', async () => {
  const text = [
    '# see docs/guide.md.',
    'file: data/a.csv:3',
    '[Guide](docs/guide.md) and (./main.py:3:2)',
    'cat ~/notes.txt',
  ].join('\n');
  assert.deepEqual((await links(text)).map((l) => [l.text, l.fragment]), [
    ['docs/guide.md', ''],
    ['data/a.csv:3', 'L3'],
    ['docs/guide.md', ''],
    ['./main.py:3:2', 'L3,2'],
    ['~/notes.txt', ''],
  ]);
});

test('file:// URLs to existing files are left to VS Code', async () => {
  const url = `file://${path.join(FIXTURES, 'project', 'data', 'a.csv')}`;
  assert.deepEqual(await links(`see ${url}\nx = "${url}"`), []);
});

test('a path after = in options, .env files and Makefiles', async () => {
  const result = await links('run --config=docs/guide.md\nDATA_PATH=data/a.csv');
  assert.deepEqual(result.map((l) => l.text), ['docs/guide.md', 'data/a.csv']);
});

test('non-ASCII names outside of quotes', async () => {
  assert.deepEqual((await links('# см. docs/отчёт.md')).map((l) => l.target), ['docs/отчёт.md']);
});

test('apostrophes around a quoted path do not hide it', async () => {
  const result = await links(`# it's in "my data/a b.csv", isn't it`);
  assert.deepEqual(result.map((l) => l.text), ['my data/a b.csv']);
  const quotedOnly = await links(`# it's in "data/a.csv", isn't it`, { unquotedPaths: false });
  assert.deepEqual(quotedOnly.map((l) => l.text), ['data/a.csv']);
});

test('backslashes: escaped, raw strings and unquoted', async () => {
  const text = ['a = "data\\\\a.csv"', 'b = r"docs\\guide.md"', 'see data\\a.csv', 'msg = "say \\"hi\\" to docs/guide.md"'].join('\n');
  assert.deepEqual((await links(text)).map((l) => [l.text, l.target]), [
    ['data\\\\a.csv', 'data/a.csv'],
    ['docs\\guide.md', 'docs/guide.md'],
    ['data\\a.csv', 'data/a.csv'],
    ['docs/guide.md', 'docs/guide.md'],
  ]);
});

test('a Windows drive letter stays part of the path', async () => {
  const { result } = await watchStat(
    () => links('see C:/win/data.csv'),
    (p) => p.endsWith('C:/win/data.csv')
  );
  assert.deepEqual(result.map((l) => l.text), ['C:/win/data.csv']);
});

test('network paths are never touched', async () => {
  const text = [
    'a = "//evil.example/share/a.txt"',
    'see //evil.example/share/b.txt',
    'c = "\\\\\\\\evil.example\\\\share\\\\c.txt"',
    'see \\\\evil.example\\share\\d.txt',
    'e = "/net/evil.example/e.txt"',
    'f = "../../../../../../../../../../net/evil.example/f.txt"',
  ].join('\n');
  const { result, calls } = await watchStat(() => links(text), () => true);
  assert.deepEqual(result, []);
  assert.deepEqual(calls.filter((p) => p.includes('evil.example')), []);
});

test('version numbers are not looked up on disk', async () => {
  const { calls } = await watchStat(() => links('v = "1.2.3"\nw = "10.20.30-beta.1"'));
  assert.deepEqual(calls, []);
});

test('the file system is not asked again right away', async () => {
  const text = 'x = "data/cache-probe.csv"';
  const { calls } = await watchStat(async () => {
    await links(text);
    await links(text);
  });
  assert.equal(calls.filter((p) => p.endsWith('cache-probe.csv')).length, 1);
});

test('a path inside a quoted sentence is found once', async () => {
  assert.deepEqual(await links('msg = "read data/a.csv first"'), [
    { text: 'data/a.csv', target: 'data/a.csv', fragment: '' },
  ]);
});

test('a quoted path is not linked twice', async () => {
  assert.equal((await links('x = "data/a.csv"')).length, 1);
});

test('URLs, missing files, folders and code are not links', async () => {
  const text = [
    'url = "https://example.com/docs/guide.md"',
    'see https://example.com/data/a.csv',
    'missing = "data/missing.csv"',
    'folder = "src/"',
    'x = total/count',
    'os.path.join(a, b)',
    'msg = "hello world"',
  ].join('\n');
  assert.deepEqual(await links(text), []);
});

test('unquotedPaths: false keeps only the quoted paths', async () => {
  const result = await links('# see docs/guide.md\nx = "data/a.csv"', { unquotedPaths: false });
  assert.deepEqual(result.map((l) => l.text), ['data/a.csv']);
});

test('documents larger than maxFileSize are skipped', async () => {
  assert.deepEqual(await links('x = "data/a.csv"', { maxFileSize: 5 }), []);
});

test('notebook cells resolve against the notebook folder', async () => {
  const result = await links('a = "helper.py"\nb = "data/a.csv"', {}, 'src/analysis.ipynb', 'vscode-notebook-cell');
  assert.deepEqual(result.map((l) => l.target), ['src/helper.py', 'data/a.csv']);
});

test('settings of the workspace folder apply', async () => {
  setFolderSettings(PROJECT, { searchRoots: ['lib'] });
  assert.deepEqual((await links('x = "util.py"')).map((l) => l.target), ['lib/util.py']);
});

test('an unsaved document uses the workspace folder', async () => {
  const result = await links('x = "data/a.csv"', {}, 'Untitled-1', 'untitled');
  assert.deepEqual(result.map((l) => l.target), ['data/a.csv']);
});
