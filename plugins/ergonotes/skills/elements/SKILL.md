---
name: elements
description: How every element of an Ergonotes note is written and when to use it: headings, lists, tasks, events, dates, links, tables, callouts, toggles, quotes, code, formulas, Mermaid diagrams, images and files, recordings, page breaks. Use before writing a note that needs more than plain paragraphs, or when the user asks "how do I add a table / callout / toggle / formula / event / checklist".
argument-hint: "[element name]"
---

# Elements of a note

The editor's Insert menu (type `/`) offers these. Every one has a plain Markdown form, which is what you write through the tools.
The notes are read by other programs too, so stay with the forms below.

## Text

| Element | Write | Use it for | Avoid |
| --- | --- | --- | --- |
| Heading | `## Title` (levels 1 to 3 in the menu; deeper are valid) | structure; one `#` at most (the title is the file name) | skipping levels; bold text standing in for a heading |
| Paragraph | plain text, a blank line between | prose | hard-wrapping lines at 80 columns; the app shows one line as one paragraph |
| Bullets | `- item` | parallel items, no order | nesting beyond three levels |
| Numbers | `1. step` | steps in order | numbering by hand to resume a list |
| Quote | `> text` | quoting a source | long quotes; add the source in the line after |
| Divider | `---` alone on a line | a real break between topics | decoration; at the top of a note it starts frontmatter |
| Inline code | `` `code` `` | names, commands, paths | |
| Code block | ```` ```ts ```` … ```` ``` ```` | code and output, with a language | prose |

## Things the app understands

| Element | Write | Notes |
| --- | --- | --- |
| **Checklist** | `- [ ] text`, `- [x] text` | a task; see `tasks` for due, remind, flag |
| **Task with a date** | `- [ ] Pay rent @due(2026-11-01)` | also `@remind(2026-11-01T08:00)`, `@flag` |
| **Event** | `Team sync @event(2026-10-20T09:00-10:30)` | appears in the Calendar; `@event(2026-10-20T15:00)` for a start only; `@event(2026-12-25)` all day |
| **Date mention** | `@date(2026-10-20)` | a day named inside text |
| **Tick box in text** | `☐` / `☑` | inline, not a task |
| **Link to a note** | `[Title](relative/path/Note.md)` | the path is relative to the note's folder; `get_links` or `read_note` tell you the layout. `[[Title]]` is read too |
| **Link on the web** | `[text](https://…)` | |
| **Callout** | `> [!note] Title` then `> lines` | asides; other words work: `[!tip]`, `[!warning]`, `[!info]` |
| **Toggle** | `<details><summary>Title</summary>` newline, Markdown, `</details>` | hide long detail; Markdown blocks go inside |
| **Table** | `\| A \| B \|` newline `\| --- \| --- \|` newline rows | comparisons; header row required; keep cells short |
| **Page break** | `<div style="page-break-after: always;"></div>` | print and PDF only |
| **Formula** | `$E = mc^2$` inline; `$$` newline formula newline `$$` as a block | LaTeX (KaTeX) |
| **Mermaid** | a ```` ```mermaid ```` block with the diagram text | quick flows; for designed diagrams use `drawing` |
| **Contents** | nothing to write | the app builds the table of contents from the headings, when opened |

### Examples

```markdown
> [!warning] Deadline
> The grant application closes on @date(2026-11-15).

<details><summary>Raw numbers</summary>

| Month | Visits |
| --- | --- |
| Sep | 1,204 |
| Oct | 1,590 |

</details>

Quarterly review @event(2026-12-18T14:00-15:00)
```

## Media (files and recordings)

| Element | Write | Notes |
| --- | --- | --- |
| Image | `![alt text](attachments/photo.png)` | the file is in `attachments/`; always give alt text |
| File | `[report.pdf](attachments/report.pdf)` | PDF, spreadsheets, slides |
| Voice note | `[Voice note 0:05](attachments/note.webm "audio")` | an older short clip, still plays |
| Recording / meeting | `[Meeting 2026-10-20 09:00](attachments/record_20261020_090000 "type_record")` | a folder with audio, frames and transcript; read it with `read_record`; keep the link as written |
| Drawing | an `ergonote-excalidraw` block | made with the `drawing` tools; never typed by hand |

You cannot create attachments, recordings or meetings with the tools (the user adds them in the app: Insert menu, drag and
drop, or Record). You can write the text around them and reference ones that exist. See `attachments`.

## What you cannot make

Recordings, meetings, dictation, transcription and the Excalidraw canvas are app features. Say so plainly and offer the nearest thing (a note with
the structure ready, `drawing` for a diagram).

## Choosing

- A list of things to do: **checklist** (with dates), not bullets.
- Something at a time: **event**. Something to finish: **task**.
- Facts side by side: **table**. Steps: **numbers**. Parallel ideas: **bullets**.
- Detail most readers skip: **toggle**. An aside that matters: **callout**.
- A process, architecture or relationship: **drawing**.
- Maths: **formula**. Code: **code block**.

## Do not

- Do not use HTML beyond `<details>` and the page break; other tools show it raw.
- Do not write Obsidian-only syntax (`![[ ]]` embeds, `%%` comments) yourself; leave existing ones alone.
- Do not put `#tags` in the text: tags are frontmatter (`tagging`).
