---
name: ergonotes
description: Search, read and write the user's Ergonotes notes through the Ergonotes MCP server. Use when the user asks to find, summarise, create or update notes, tasks or daily notes.
---

# Working with Ergonotes

The `ergonotes` MCP server exposes the user's notes (Markdown). Tools: `search_notes`, `list_recent`, `read_note`,
`create_note`, `append_to_note`, `update_note`, `list_folders`, `list_tasks`, `complete_task`, `daily_note`.

## Rules

- **Read before you write.** Use `search_notes` then `read_note`; never overwrite a note you have not read.
- **Prefer `append_to_note`** to `update_note`. `update_note` replaces the whole body.
- New notes go to the Inbox unless the user names a folder (`list_folders` gives ids). The user triages the Inbox.
- Tasks are Markdown checklists: `- [ ] text @due(2026-10-15T17:00) @remind(2026-10-15T16:30) @flag`.
- Link notes with `[[<note-id>|Title]]`; the id comes from `search_notes`/`read_note`.
- Tags are frontmatter; set them with `create_note.tags`. Do not put `#tags` in the text.
- Do not delete notes. There is no delete tool on purpose.
- Notes may contain private information; do not copy them elsewhere unless asked.
