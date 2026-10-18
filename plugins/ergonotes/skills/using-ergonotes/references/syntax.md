# How things are written in a note

A note is Markdown with a few readable extras. The app understands these; write them exactly like this.

## Tasks

```
- [ ] Send the invoice @due(2026-10-15T17:00) @remind(2026-10-15T16:30) @flag
- [x] Booked the room
```

- A task is a checklist line. It lives in its note; there is no separate task list.
- `@due(date)` and `@remind(date)` take `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`. `@flag` marks it important.
- A task may be nested under another with indentation. Keep the text before the `@` marks.
- `@done(...)` belongs to Habits; do not write it on tasks (use `complete_task`).

## Dates and events

- A date: `@date(2026-10-20)`.
- An event (it appears in the Calendar): `Team sync @event(2026-10-20T09:00-10:30)`, `Dentist @event(2026-10-21T15:00)`, `Holiday @event(2026-12-25)`.
- An event line may be a paragraph, a list item or a quote. Not the same as a task: a task can be done, an event cannot.

## Links

- To a note: `[Title](relative/path/Note.md)` (the path is relative to the note's own folder; `read_note` shows the folder). `[[Note title]]` is read too.
- To a recording or meeting: `[Meeting 2026-10-20 09:00](attachments/record_20261020_090000 "type_record")`. Keep it as is.
- To a habit: `[Run](.habits/Run.md "type_habit")`. Keep it as is.

## Blocks

| Element | Written as |
| --- | --- |
| Heading | `#`, `##`, `###` (in order) |
| Bullets, numbers | `- item`, `1. item` |
| Quote | `> text` |
| Callout | `> [!note] Title` then the lines (`[!tip]`, `[!warning]` and other lowercase words work too) |
| Table | a standard pipe table with a header row |
| Divider | `---` on its own line |
| Code | triple backticks with the language |
| Toggle | `<details><summary>Title</summary>` … `</details>` with Markdown inside |
| Page break | `<div style="page-break-after: always;"></div>` |
| Formula | `$x^2$` inline, `$$` … `$$` as a block |
| Diagram | a `mermaid` fenced block (the `drawing` skill does better) |
| Tick box inside text | `☐` or `☑` |
| Image | `![alt](attachments/photo.png)` |
| File | `[report.pdf](attachments/report.pdf)` |
| Voice note | `[Voice note 0:05](attachments/note.webm "audio")` |
| Drawing | an `ergonote-excalidraw` fenced block with scene JSON on one line: do not write or edit it by hand; use the drawing tools |

## Not written down

- The table of contents is built by the app from the headings; do not write one.
- Tags are not in the text. They are the note's frontmatter (`tags:`); use `create_note.tags` or `add_tags`.
- `private`, `pinned`, `id` and dates are frontmatter the app keeps; do not write them.

## Leave alone

Anything else (`![[embed]]`, `%%comment%%`, `^block-id`, Dataview queries, Canvas, raw HTML) belongs to other tools. Keep it byte for byte.
