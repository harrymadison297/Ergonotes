# Tool reference

All tools take `id` as the note's id (from `search_notes`, `list_recent` or `create_note`). Where a note is not found, not
readable or private, the answer is `Note not found`.

## Find

| Tool | Arguments | Returns |
| --- | --- | --- |
| `search_notes` | `query`; optional `folder` (id, subfolders included), `tag` (`work` also matches `work/acme`), `since`, `until` (YYYY-MM-DD, the day the note last changed), `limit` (default 20, max 50) | notes: `id, title, snippet, tags, updated, folder`. `query` may be empty if a filter is given |
| `list_recent` | `limit` (default 10, max 50) | the latest changed notes |
| `list_folders` | none | folders: `id, title, parent, notes` |
| `list_tags` | none | `{ tag, notes }` for every tag in use (private notes not counted) |
| `list_tasks` | `includeDone` | checklist items across notes: `noteId, note, index, text, done, due, remind, flag` |

## Read

| Tool | Arguments | Returns |
| --- | --- | --- |
| `read_note` | `id`, optional `heading` | `id, title, folder, tags, updated, body, backlinks` (with `heading`: that section only, and `section`) |
| `get_links` | `id` | `backlinks` (notes that link here) and `links` (notes this links to) |
| `read_record` | `id` | for each recording or meeting the note shows: `record, kind, seconds, frames, transcript` (one block per minute, `[m:ss]` marks) |

## Write

| Tool | Arguments | Notes |
| --- | --- | --- |
| `create_note` | `title`; optional `body`, `folder` (id), `tags` | Inbox when no folder. Returns `id, title`, plus `warning` when the title already exists |
| `append_to_note` | `id`, `text` | adds a paragraph at the end |
| `insert_after_heading` | `id`, `heading` (without `#`), `markdown` | adds at the end of that section; lists the headings when it is not found |
| `replace_text` | `id`, `find`, `replace` | `find` must match exactly one place |
| `update_note` | `id`, `title` and/or `body` | replaces the whole body: only after reading the note |
| `rename_note` | `id`, `title` | renames the file; links to the note are rewritten by the app |
| `add_tags` | `id`, `tags` | existing tags stay |
| `move_note` | `id`, `folder` (id; empty = top level) | moves a note or folder |
| `complete_task` | `noteId`, `index` | ticks a checklist item (index from `list_tasks`) |
| `daily_note` | `date` (YYYY-MM-DD) | opens the day's note, creating it from the template when needed |

## Drawing (desktop app only)

`draw`, `insert_diagram`, `read_drawing`, `search_libraries`, `browse_library`, `import_library_item`: see the `drawing` skill.
They return pictures; look at them.

## Resources and prompts

The server also offers the resource `ergonotes://guide` (the conventions), `ergonotes://note/{id}` (a note as Markdown) and
prompts such as `write_note`, `capture`, `daily_plan`, `triage_inbox`, `ask_notes` and `meeting_minutes`.
