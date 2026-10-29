# Click'n'Open Path Changelog

## 0.6.0

- Open a path from the keyboard: **Alt+O** (**Cmd+Alt+O** on macOS), command **Open Path at Cursor**. It opens the path under the cursor, or the only path on the line, or lets you pick one from a list, the nearest first. Selected text is opened as a path
- The extension is written in TypeScript

## 0.5.0

- Jupyter notebooks: paths in cells are resolved against the notebook folder
- Windows paths: drive letters (`C:/data/a.csv`) and backslashes, also escaped in strings (`"data\\a.csv"`). On macOS and Linux backslashes are read as `/`
- Paths outside of quotes may contain non-Latin letters (`docs/отчёт.md`), and are found after `=` (`--config=conf/app.yml`, `.env` files)
- A quoted path between two apostrophes (`it's in "my data/a.csv", isn't it`) is no longer missed, and strings with escaped quotes are read correctly
- `path:10:0` (columns from 0, as in pylint) and `path:0` no longer break Go to Definition
- Network paths (`//server/share`, `/net/...`) are never checked, so a file from an untrusted repository can't make VS Code connect to another computer
- `clickOpenPath.searchRoots`, `unquotedPaths` and `maxFileSize` can be set per workspace folder
- Fewer file system checks: results are kept for 2 seconds, version numbers like `"1.2.3"` aren't looked up, and only 1000 characters around the cursor are read in very long lines

## 0.4.0

- Paths aren't underlined all the time any more: a path is underlined only while you hover it with Ctrl (Cmd on macOS) held, like Go to Definition. F12 and Peek work on paths too
- Setting `clickOpenPath.underline` (off by default) brings back the permanent underline
- Setting `clickOpenPath.autoRefresh` is removed: paths are now looked up when you hover or click them, so they're always up to date
- Changes of the settings apply right away

## 0.3.0

- Icon
- Setting `clickOpenPath.autoRefresh` (off by default): links are recomputed when files are created or deleted in the workspace, and when the extension settings change

## 0.2.0

- Paths outside of quotes: in comments, YAML, Markdown and shell scripts. Such paths must contain a `/`. Setting: `clickOpenPath.unquotedPaths`

## 0.1.0

- Ctrl+click (Cmd+click on macOS) a file path in a string literal to open the file
- `path:line` and `path:line:column` open the file at that position
- `~` is expanded to the home folder
- Relative paths are resolved against the folder of the current file, the workspace folder and `clickOpenPath.searchRoots`
