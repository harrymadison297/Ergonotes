---
name: writing
description: Write or improve a note in the user's Ergonotes vault the way the vault is meant to be written: one idea per note, a clear title, linked to related notes, tagged with existing tags, in the user's language. Use when the user asks to write, draft, expand, rewrite, restructure or summarise something into a note, to turn text into a note, or to write an article, meeting prep, how-to, decision, project or reading note.
argument-hint: "[topic or what to write]"
---

# Writing a note

The goal is a note the user will find again, understand in a year, and connect to the others. Work through the steps; do not
skip the first two.

## 1. Understand the job

- What is it for, and who reads it (the user alone, or something they will share)? Ask one short question if that changes the note; otherwise go on.
- Is the user giving you material (paste, dictation, a link) or asking you to produce it? If it is their material, **keep their words and their order**: tidy, do not rewrite. If you produce it, say which parts came from you.
- Language: the user's. A Vietnamese request gets a Vietnamese note, with names, code and quotations unchanged.

## 2. Look before you write

1. `search_notes` with two or three wordings of the subject. If a note already covers it, `read_note` and extend that one (`append_to_note`, `insert_after_heading`, `replace_text`). Say so to the user instead of creating a twin.
2. `list_tags`, and keep the tags that fit; propose at most 3 for the note. Never invent a tag that is a variant of one that exists.
3. Note two or three related notes to link to (`get_links` on a close match shows its neighbours).

## 3. Choose the shape

Pick one template from `templates/` and adapt it; delete sections that stay empty.

| The note is | Template |
| --- | --- |
| a single idea or claim, in your own words | `templates/idea.md` |
| what was learned from a source (book, article, talk) | `templates/source.md` |
| a project: goal, state, next actions, log | `templates/project.md` |
| steps to do something | `templates/howto.md` |
| a choice and why | `templates/decision.md` |
| a map of notes on one subject | `templates/hub.md` |
| a meeting (before or after) | `templates/meeting.md` |

## 4. Write it

- **Title:** says what the note says. "Spaced repetition beats rereading" is a title; "Notes" is not. Short, no `\ / : * ? " < > |` (it is the file name).
- **Start with the point** in one or two sentences. Details follow.
- **One idea per note.** If a second idea needs a heading of its own and its own title, it is a second note: create it and link both ways.
- **Structure:** headings in order (`#` once at most, since the title is the name), short paragraphs, lists for parallel items, a table only for real comparisons. Callouts (`> [!note]`) for asides worth setting apart.
- **Links:** at least one to a related note, as `[Title](relative/path/Note.md)`, placed where they help the reader ("see [Spaced repetition](...)"), not only in a list at the end. If you mention a note that exists, link it.
- **Tasks and dates** that come out of the text are written as in `using-ergonotes/references/syntax.md`: `- [ ] … @due(...)`, `@event(...)`.
- **Tags:** through `create_note.tags` or `add_tags`, never `#tag` in the text.
- **Length:** as long as the idea needs. Cut preamble and repetition. Do not pad.

## 5. Save and check

- New note: `create_note` (Inbox unless the user named a folder). Existing: the smallest edit.
- If `create_note` returns a `warning`, stop and read the note it names; merge into it if it is the same subject.
- `read_note` the result. Check the title, the headings, the links, the tags. Fix what is off.
- Tell the user the note's title and where it is, in one or two lines, and what you linked.

## Do not

- Do not write facts as if they came from the user's notes when they did not. Mark your own additions ("Added by Claude").
- Do not change the wording of text the user gave you beyond tidying (fixing typos, paragraphs, headings).
- Do not delete content from an existing note; ask first.
- Do not put a table of contents, `#tags`, `id`, or dates of creation into the text; the app handles them.
- Do not paste a drawing's JSON: for a diagram use the `drawing` skill.
