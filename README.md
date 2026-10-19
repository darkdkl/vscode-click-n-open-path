# Click'n'Open Path

Ctrl+click (Cmd+click on macOS) a file path in your code, comments or configs to open the file — the same way you jump to a function definition.

```python
df = pd.read_csv("data/train.csv")      # opens data/train.csv
open("src/app.py:42")                   # opens at line 42
cfg = "~/.config/app/settings.toml"     # ~ is expanded
```

Paths outside of quotes work too — in comments, YAML, Markdown, shell scripts, `.env` files — as long as they contain a `/` or `\`:

```yaml
# see docs/guide.md
file: data/train.csv:10:5
run: train --config=configs/base.yml
```

It works in any language and in Jupyter notebooks. Like Go to Definition, a path is underlined only while you hover it with Ctrl (Cmd on macOS) held, and F12 / Peek work on it too. Only paths to existing files can be opened.

To underline all the paths that can be opened, all the time, turn on `clickOpenPath.underline`.

### Install

Search for **Click'n'Open Path** in the Extensions view of VS Code, or run `code --install-extension dark-dmake.click-n-open-path`.

You can also download `click-n-open-path-<version>.vsix` from the [releases](https://github.com/darkdkl/vscode-click-n-open-path/releases), and run `code --install-extension click-n-open-path-<version>.vsix`.

### Where paths are looked up

A relative path is resolved against, in this order:

1. the folder of the current file;
2. the workspace folder;
3. the folders from `clickOpenPath.searchRoots`.

The first folder where the file exists wins. Windows paths (`C:\data\a.csv`, `data\a.csv`) work too, and on macOS and Linux backslashes are read as `/`.

Network paths (`//server/share`, `\\server\share`, `/net/...`) are never opened or checked, so opening a file from an untrusted repository can't make VS Code connect to another computer.

### When the underline is updated

By default a path is looked up when you hover or click it, so it's always up to date.

With `clickOpenPath.underline`, VS Code finds the paths when you open a file or switch to it, and about a second after you stop typing. A file created or deleted on disk doesn't update the underline by itself: edit the file or reopen it.

### Settings

| Setting | Default | Description |
| --- | --- | --- |
| `clickOpenPath.underline` | `false` | Always underline the paths that can be opened. When off, a path is underlined only while hovered with Ctrl/Cmd held |
| `clickOpenPath.searchRoots` | `[]` | Extra folders to resolve relative paths against: absolute, or relative to the workspace folder. Can be set per workspace folder |
| `clickOpenPath.unquotedPaths` | `true` | Also detect paths outside of quotes. Such paths must contain a `/` or `\` |
| `clickOpenPath.maxFileSize` | `1000000` | Only with `underline`: skip documents larger than this many characters |

If Ctrl+click doesn't open paths, check `editor.multiCursorModifier`: with `ctrlCmd`, they open with Alt+click.

### Known limitations

- A path split over several lines isn't detected, and a path outside of quotes can't contain spaces.
- Paths built in code (`f"{root}/a.csv"`, `Path(__file__).parent / "a.csv"`) can't be resolved.
- Directories don't become links, only files.

See the [changelog](CHANGELOG.md) for details.
