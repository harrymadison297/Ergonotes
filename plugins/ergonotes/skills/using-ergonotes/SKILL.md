---
name: using-ergonotes
description: The foundation for anything that touches the user's Ergonotes notes, tasks, daily notes, tags or drawings: which MCP tool to use, how to read and write safely, what never to do. Use whenever the user mentions their notes, a note's title, "my vault", Ergonotes, tasks or reminders kept in notes, or asks to find, read, summarise, write, edit, move, tag or organise notes.
---

# Using Ergonotes

Ergonotes keeps the user's notes as Markdown files in a folder (the **vault**), organised as PARA folders (Projects, Areas,
Resources, Archive), an **Inbox** for new captures, tags and links between notes. You reach the vault through the Ergonotes
MCP tools. Their names are `search_notes`, `read_note`, and so on; Claude Code shows them with a prefix.

If no Ergonotes tool is available, the desktop app is not running: say so and ask the user to open it. Do not look for the
files and edit them directly.

## The loop for every job

1. **Find.** `search_notes` (words, and optional `folder`, `tag`, `since`, `until`), or `list_recent`, `list_folders`, `list_tags`, `list_tasks`.
2. **Read.** `read_note` (add `heading` to read one section of a long note), `get_links` for backlinks and links, `read_record` for a recording's transcript.
3. **Decide the smallest change.** Extend an existing note rather than start a near-duplicate. If `create_note` warns that the title exists, read that note and append to it.
4. **Write.** One of `append_to_note`, `insert_after_heading`, `replace_text`, `create_note`, `add_tags`, `move_note`, `rename_note`, `complete_task`, `daily_note`; `update_note` only to rewrite a whole note you have just read.
5. **Check.** `read_note` again and confirm the result is what you meant. Tell the user which notes you touched, by title.

## Rules that do not bend

- **Read before you write.** Never change a note you have not read in this conversation.
- **Smallest edit.** `replace_text` needs a `find` that matches exactly once: copy it from the note, with enough context.
- **Inbox by default.** A new note with no folder named by the user lands in the Inbox; the user triages it. Do not file notes into PARA folders on your own (the `triage` skill does that, when asked).
- **Never delete.** There is no delete tool. Do not blank a note to get the same effect. If the user wants something gone, tell them how to do it in the app (Trash keeps it 30 days).
- **Private means invisible.** A note marked private, and Habits, do not exist for you. A "Note not found" can mean that. Never try to reach them through the files.
- **Do not edit the vault's files directly** (no Write/Edit/shell on `.md` files in the vault folder), and never touch `.ergonotes/`, `.trash/` or `.habits/`. The app keeps history, links and sync consistent only for changes made through its tools.
- **Personal data.** Notes may hold private information. Do not copy it elsewhere or into other tools unless the user asks.
- **Do not invent.** When the notes do not say, say so. Mark anything that comes from you rather than from the notes.
- **Language.** Write in the language the user writes in (Vietnamese in, Vietnamese out). Keep names, code, and quotations as they are.
- **Unknown syntax stays.** `![[x]]`, `%%…%%`, Dataview or HTML belong to other tools. Keep them exactly as they are.

## Choosing the skill

| The user wants | Skill |
| --- | --- |
| a note written or improved | `writing` |
| to save something quickly | `capture` |
| to plan or close the day | `daily` |
| to add, schedule, tick or review tasks | `tasks` |
| the Inbox sorted | `triage` |
| minutes from a recorded meeting | `meeting` |
| an answer from their notes | `ask` |
| a weekly or monthly look back | `review` |
| the vault checked for problems | `maintain` |
| to know how an element is written (table, callout, toggle, formula, event...) | `elements` |
| tags chosen, renamed or merged | `tagging` |
| files or images attached | `attachments` |
| a diagram, sketch or icon in a note | `drawing` |

## Reference

- `references/tools.md`: every tool, its arguments and what it returns.
- `references/syntax.md`: how tasks, dates, events and blocks are written in Markdown.
- `references/errors.md`: what each error means and what to do.
