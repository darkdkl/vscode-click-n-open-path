# Click'n'Open Path Changelog

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
