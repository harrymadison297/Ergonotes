# Ergonotes for VS Code

Read and edit an [Ergonotes](https://github.com/harrymadison297/Ergonotes) vault, a folder of plain Markdown files, in VS Code. The extension never touches
`.ergonotes/` and needs no password: it works on the notes themselves. The app picks up whatever you change here.

## What it does

- **Syntax**: `@due(...)`, `@remind(...)`, `@done(...)`, `@event(...)`, `@flag`, `[[wiki links]]`, `%%comments%%` and the
  `ergonote-excalidraw` fence are coloured inside Markdown.
- **Preview** (`Ergonotes: Open Preview to the Side`, `Ctrl+K V`): tasks as boxes, tokens as chips, toggles, page breaks,
  formulas, pictures from beside the note, links that open the note in the editor, and a chip with the streak next to a link to a habit.
- **Snippets**: `task`, `remind`, `event`, `eventday`, `habit`, `checkin`, `remark`, `toggle`, `pagebreak`, `drawing`, `formula`.
- **Links**: typing `[[` or `@` offers the notes of the vault (habits first after `@`) and writes a standard Markdown link
  `[Title](relative/path.md)`, as the app does.
- **Tasks and dates**: `Insert Task` (`Ctrl+Alt+T`), `Set Due Date`, `Set Reminder`, `Insert Event`.
- **Habits**: `New Habit` makes a note in `Habits/`; in a habit note the status bar shows the streak and `Check In` writes
  `- [x] @done(2026-10-17T07:42)` into its `## Log`; `Remark on a Day` writes `- 2026-10-16: reason`.

Only what you did is written to a habit note; misses, streaks and rates are computed (ADR 0013).

## What it does not do

There is no rich-text editor here: you edit the Markdown. Drawings, diagrams and recordings are drawn by the app; the preview
names them. Bytes you do not change are never rewritten.

## Build

```sh
npm install          # at the repository root
npm -w ergonotes-vscode run package   # makes apps/vscode/ergonotes-vscode.vsix
code --install-extension apps/vscode/ergonotes-vscode.vsix
```
