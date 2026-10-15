---
name: ergonotes
description: Search, read and write the user's Ergonotes notes through the Ergonotes MCP server. Use when the user asks to find, summarise, write, edit or organise notes, tasks or daily notes.
---

# Working with Ergonotes

The `ergonotes` MCP server exposes the user's notes (Markdown). Tools: `search_notes`, `list_recent`, `read_note`, `read_record`,
`create_note`, `append_to_note`, `replace_text`, `insert_after_heading`, `update_note`, `rename_note`, `add_tags`,
`move_note`, `list_folders`, `list_tasks`, `complete_task`, `daily_note`.

## Connect

```
claude mcp add --transport http ergonotes https://<your-server>/mcp --header "Authorization: Bearer <token>"
```

Create the token in Ergonotes under **Settings → AI & agents**. One token per agent; revoke it when you stop using it.

## Rules

- **Read before you write.** Use `search_notes` then `read_note`; never overwrite a note you have not read.
- **Prefer small edits.** `append_to_note` to add, `replace_text` to change one passage (the text must match exactly once),
  `insert_after_heading` to add under a heading. `update_note` replaces the whole body: use it only for a full rewrite.
- New notes go to the Inbox unless the user names a folder (`list_folders` gives ids). The user triages the Inbox.
- Tasks are Markdown checklists: `- [ ] text @due(2026-10-15T17:00) @remind(2026-10-15T16:30) @flag`.
- Link notes with a standard Markdown link to the note's file, `[Title](relative/path/Note.md)` (`read_note` shows the folder), or `[[Note title]]`.
- Tags are frontmatter; set them with `create_note.tags` or `add_tags`. Do not put `#tags` in the text.
- Do not delete notes. There is no delete tool on purpose.
- **Private notes do not exist for you.** The user can mark a note private; it never appears in search results, lists or
  reads, and writes to it are refused as "Note not found". Do not try to work around that.
- Notes may contain personal information; do not copy them elsewhere unless asked.
- Drawings are stored as ```` ```ergonote-excalidraw ```` blocks. Leave them untouched; do not try to edit their JSON.
- Other elements have a plain form you may read and write: a toggle is `<details><summary>Title</summary>` … `</details>`
  (blocks inside), a page break is `<div style="page-break-after: always;"></div>`, a date is `@date(2026-10-20)`, an event is
  `Team sync @event(2026-10-20T09:00-10:30)` (or `@event(2026-10-20)`), a tick box is `☐` / `☑`, a formula is `$x^2$` or a
  `$$` … `$$` block, a diagram is a ````` ```mermaid ````` fence. Images and files are real files in `attachments/` embedded as
  `![alt](attachments/x.png)`; a short clip is `[Voice note](attachments/x.webm "audio")`. A recording or a meeting is a
  folder, `[Meeting 2026-10-20 09:00](attachments/record_20261020_090000 "type_record")`, holding its audio, the frames taken
  from the shared screen and a transcript: keep that link as it is, and read what was said with `read_record` (a block per
  minute, `[m:ss]` marks) instead of opening the files. The table of contents is not written
  down: the app builds it from the headings. Other syntax you do not know (`![[x]]`, `%%…%%`, HTML) belongs to other tools:
  leave it exactly as it is.
