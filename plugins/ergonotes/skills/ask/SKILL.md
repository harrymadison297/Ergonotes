---
name: ask
description: Answer a question from what is in the user's Ergonotes notes, with links to the notes used, without changing anything. Use for "what did I write about", "find my notes on", "what's the status of", "when did I", "summarise what I know about", or any question the user's own notes could answer.
argument-hint: "[question]"
---

# Ask the notes

A read-only job. The answer comes from the user's notes; it says where.

## Steps

1. **Understand the question.** What would a good answer contain? A fact, a list, a timeline, a summary of a subject, a comparison.
2. **Search several ways.** Try the user's words, synonyms, the likely title, a tag (`list_tags`), a folder, and a date range (`since`/`until`). `search_notes` returns at most 50 results; narrow with filters rather than reading everything.
3. **Read selectively.** `read_note` the best matches; for long notes read only the relevant section with `heading`. `get_links` to follow a trail to the notes around a good match. `read_record` when the answer may be in a recording.
4. **Answer.** Lead with the answer. Then the support: which notes, what each says. Link every note you used, as `[Title](relative/path/Note.md)`, so the user can open it.
5. **Say what is missing.** If the notes do not answer it, or only partly, say that, and what you found. If you add anything from general knowledge, mark it ("Not from your notes: …").

## Shapes of answer

| Question | Answer |
| --- | --- |
| a fact ("what is Acme's contact?") | the fact, then the note |
| a list ("which books did I read in 2025?") | a list with links and dates |
| status of something | what the latest notes say, with dates; what is still open (tasks) |
| a timeline | dates in order, each with its note |
| "what do I know about X" | a short synthesis by theme, each point linked |
| a comparison | a table with sources in the cells |

## Dates and conflicts

Notes disagree sometimes. Give the newest, note the older, and say which is which (`updated` in the results).

## Private notes

A private note does not exist for you. If the user says a note exists that you cannot find, it may be private: say that you cannot see it.

## Do not

- Do not write, tag, move or tick anything. If the user then wants a note written from the answer, switch to `writing`.
- Do not quote more than a few lines; summarise and link.
- Do not guess a note's content from its title.
