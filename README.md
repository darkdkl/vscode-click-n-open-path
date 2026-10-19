# Click'n'Open Path

Ctrl+click (Cmd+click on macOS) a file path in your code, comments or configs to open the file — the same way you jump to a function definition.

```python
df = pd.read_csv("data/train.csv")      # opens data/train.csv
open("src/app.py:42")                   # opens at line 42
cfg = "~/.config/app/settings.toml"     # ~ is expanded
```

Paths outside of quotes work too — in comments, YAML, Markdown, shell scripts — as long as they contain a `/`:

```yaml
# see docs/guide.md
file: data/train.csv:10:5
```

It works in any language. Only paths to existing files become links, so plain text isn't underlined.

### Install

Search for **Click'n'Open Path** in the Extensions view of VS Code, or run `code --install-extension dark-dmake.click-n-open-path`.

You can also download `click-n-open-path-<version>.vsix` from the [releases](https://github.com/darkdkl/vscode-click-n-open-path/releases), and run `code --install-extension click-n-open-path-<version>.vsix`.

### Where paths are looked up

A relative path is resolved against, in this order:

1. the folder of the current file;
2. the workspace folder;
3. the folders from `clickOpenPath.searchRoots`.

The first folder where the file exists wins.

### When links are updated

VS Code recomputes links when you open a file or switch to it, and about a second after you stop typing. A file created or deleted on disk doesn't update the links by itself; enable `clickOpenPath.autoRefresh` for that. It watches the workspace folders only.

### Settings

| Setting | Default | Description |
| --- | --- | --- |
| `clickOpenPath.searchRoots` | `[]` | Extra folders to resolve relative paths against: absolute, or relative to the workspace folder |
| `clickOpenPath.unquotedPaths` | `true` | Also detect paths outside of quotes. Such paths must contain a `/` |
| `clickOpenPath.autoRefresh` | `false` | Recompute links when files are created or deleted in the workspace, and when these settings change |
| `clickOpenPath.maxFileSize` | `1000000` | Skip documents larger than this many characters |

If Ctrl+click doesn't open links, check `editor.multiCursorModifier`: with `ctrlCmd`, links open with Alt+click.

### Known limitations

- A string with a backslash (`"C:\\dir\\file"`, `"a\n.csv"`) or split over several lines isn't detected.
- Paths built in code (`f"{root}/a.csv"`, `Path(__file__).parent / "a.csv"`) can't be resolved.
- Directories don't become links, only files.

See the [changelog](CHANGELOG.md) for details.
