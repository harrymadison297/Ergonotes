---
name: meeting
description: Turn a recorded meeting or recording in the user's Ergonotes into minutes: summary, decisions, action items with owners and dates, open questions and key quotes with their time marks, using the transcript. Use when the user asks for minutes, a summary, action items or follow-ups of a meeting, call, lecture or recording.
argument-hint: "[title of the note with the recording]"
---

# Minutes from a recording

A **recording** or **meeting** is a folder in the vault (audio, frames taken from the shared screen, a transcript), linked
from a note like `[Meeting 2026-10-20 09:00](attachments/record_20261020_090000 "type_record")`. `read_record` gives the
transcript: one block per minute, with `[m:ss]` marks.

## Steps

1. Find the note that shows the recording (`search_notes`, or ask). `read_note` it: it may already have notes or minutes; do not repeat or overwrite them.
2. `read_record` with the note's id. If the transcript says `(no transcript yet)`, tell the user to create it in the app and stop. If the answer is "This note shows no recordings", say so.
3. Read the whole transcript before you write; speakers and topics are often clear only at the end.
4. Write the minutes under a heading **Minutes** (or the user's language: "Biên bản") at the end of the same note: `insert_after_heading` if the heading exists, else `append_to_note`.
5. `read_note` to check, then summarise to the user in two lines.

## What the minutes hold

```markdown
## Minutes
**Summary:** three to five sentences: what the meeting was for and what came out of it.

**Decisions**
- What was decided, by whom if said [12:40]

**Action items**
- [ ] What, owner @due(2026-10-27) [18:05]

**Open questions**
- What stayed unresolved

**Key points / quotes**
- [03:10] "Short exact quote."
```

- Time marks `[m:ss]` point back into the recording; keep them on decisions, actions and quotes.
- Action items are real tasks: checklist lines. Put the owner in the text ("Minh: send the draft"), a `@due` only when a date was said or clearly implied (resolve "next Friday" from the meeting date). If the owner or date was not said, leave it out and put "(owner?)" so the user sees the gap.
- Quotes: exact words from the transcript, short.
- Use the language of the meeting.

## Frames (pictures of the shared screen)

You do not see them through the tools. The transcript is what you have; say so if the user asks about what was on screen.

## Do not

- Do not invent names, numbers, dates or decisions. A transcript can be wrong (speech to text): mark unclear terms with "(?)" instead of guessing.
- Do not change or remove the recording link.
- Do not paste the whole transcript into the note.
- Do not send the minutes anywhere else.
