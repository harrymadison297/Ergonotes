// What an agent needs to know to use the Ergonotes MCP endpoint well. Sent as the server `instructions` (short) and as
// the resource `ergonotes://guide` (full), so an agent that has no skill installed still writes notes correctly.
// The skills of the Claude Code plugin (plugins/ergonotes) go deeper on each job; the rules here are the common core.

export const ERGONOTES_INSTRUCTIONS = [
  "Ergonotes: the user's personal notes. A note is a Markdown file; its title is its file name.",
  'Read before you write: search_notes (or list_recent), then read_note. Never overwrite a note you have not read.',
  'Prefer small edits: append_to_note, insert_after_heading, replace_text. update_note rewrites the whole body.',
  'New notes go to the Inbox unless the user names a folder (list_folders). Reuse tags that exist (list_tags); tags are never written as #tags in the text.',
  'There is no delete tool, on purpose. Private notes do not exist for you; do not try to reach them.',
  'Write in the language the user writes in. Read the resource ergonotes://guide for the full conventions and the syntax.',
].join('\n');

export const ERGONOTES_GUIDE = `# Working with Ergonotes

Ergonotes is the user's personal note system (PARA folders, an Inbox for captures, Zettelkasten-style links). Every note is a
Markdown file in a folder; the title is the file name; tags, pinned and private are frontmatter.

## Tools

| Job | Tools |
| --- | --- |
| Find | \`search_notes\` (query + folder / tag / since / until filters), \`list_recent\`, \`list_tags\`, \`list_folders\`, \`list_tasks\` |
| Read | \`read_note\` (whole, or one section with \`heading\`), \`get_links\` (backlinks and links), \`read_record\` (transcript of a recording or meeting) |
| Add | \`create_note\`, \`append_to_note\`, \`insert_after_heading\`, \`daily_note\` |
| Change | \`replace_text\`, \`update_note\`, \`rename_note\`, \`add_tags\`, \`move_note\`, \`complete_task\` |
| Draw (desktop app only) | \`draw\`, \`insert_diagram\`, \`read_drawing\`, \`search_libraries\`, \`browse_library\`, \`import_library_item\` |

## Rules

- **Read before you write.** Find the note, read it, then edit. \`create_note\` warns when a note with the same title exists:
  read that one and extend it instead of keeping a duplicate.
- **Smallest edit that works.** \`append_to_note\` to add at the end, \`insert_after_heading\` to add under a heading,
  \`replace_text\` to change one passage (it must match exactly once). \`update_note\` replaces the whole body: only for a full
  rewrite of a note you have just read.
- **After a write, read the note again** (\`read_note\`) and check it came out as intended.
- **Inbox by default.** A new note without a named folder lands in the Inbox; the user triages it later. Do not file notes
  into PARA folders on your own unless asked.
- **Tags.** Call \`list_tags\` first and reuse what exists. Tags may be hierarchical (\`work/acme\`). They are frontmatter: set them
  with \`create_note.tags\` or \`add_tags\`, never as \`#tag\` in the text. Do not invent near-duplicates (\`Work\` and \`work\`).
- **Links.** Link related notes with a standard Markdown link to the note's file, \`[Title](relative/path/Note.md)\` (\`read_note\`
  shows the folder; \`get_links\` shows who links to it). \`[[Note title]]\` is read too.
- **No deleting.** There is no delete tool. Do not empty a note to get the same effect; ask the user.
- **Private notes do not exist for you.** A note the user marked private never appears in search, lists, links or reads, and a
  write to it is refused as "Note not found". Habits (the hidden \`.habits/\` folder) are private to AI too. Do not work
  around this.
- Notes can hold personal information. Do not copy them elsewhere unless asked.
- **Language.** Write in the language the user is using (Vietnamese in, Vietnamese out). Keep names, code and quotations as they are.

## Writing a good note

- One idea per note. The title says what the note says (a claim or a clear subject), is short, and works as a file name:
  no \`\\ / : * ? " < > |\`.
- Start with the point. Use headings in order (no jumping from # to ###), short paragraphs, lists for parallel items.
- Search first (\`search_notes\`), link to at least one related note, and add the tags that exist for the subject.
- Keep the user's own words when they give you text; do not "improve" a capture.
- Never state a fact the notes or the user did not give you as if it came from their notes. Say what is missing.

## Tasks, dates and events

- A task is a Markdown checklist line: \`- [ ] Send the invoice @due(2026-10-15T17:00) @remind(2026-10-15T16:30) @flag\`.
  A task lives in its note; there is no separate task store. \`list_tasks\` lists them; \`complete_task\` ticks one.
- A date mention is \`@date(2026-10-20)\`. An event is \`Team sync @event(2026-10-20T09:00-10:30)\` or \`@event(2026-10-20)\`.
- Dates are ISO (\`YYYY-MM-DD\`, with \`THH:MM\` for a time). If the user says "this afternoon" and you do not know the time zone or the date, ask.
- \`daily_note\` opens (creating it if needed) the daily note of a date.

## Elements that have a plain Markdown form

- Toggle: \`<details><summary>Title</summary>\` … \`</details>\` (blocks inside). Page break: \`<div style="page-break-after: always;"></div>\`.
- Callout: a quote that starts \`> [!note] \`. Tick box: \`☐\` / \`☑\`. Formula: \`$x^2$\` or a \`$$\` … \`$$\` block.
- Diagram: a \`mermaid\` fenced block, or better a drawing made with \`draw\` (nodes and links in; layout, text and arrows out; it returns a picture of the result to check). A drawing is an \`ergonote-excalidraw\` fenced block holding JSON: never write or edit its text by hand.
- Images and files are real files under \`attachments/\`, embedded as \`![alt](attachments/x.png)\`; a clip is \`[Voice note](attachments/x.webm "audio")\`.
- A recording or a meeting is a folder: \`[Meeting 2026-10-20 09:00](attachments/record_20261020_090000 "type_record")\`. Keep that link
  exactly; read what was said with \`read_record\` (one block per minute, \`[m:ss]\` marks).
- The table of contents is not written down; the app builds it from the headings.
- Syntax you do not know (\`![[x]]\`, \`%%…%%\`, HTML, Dataview) belongs to other tools: leave it exactly as it is.
`;
