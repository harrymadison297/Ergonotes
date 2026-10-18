---
name: capture
description: Save something the user hands over, quickly and as it is, into their Ergonotes Inbox: a thought, text, a link, a quote, a list, something copied from a chat. Use when the user says "save this", "note this down", "remember this", "add to my inbox", "jot down", or pastes content with no instruction other than keeping it.
argument-hint: "[text to save]"
---

# Capture

A capture is the opposite of writing a polished note: speed, fidelity, and nothing lost. The user will triage the Inbox
later (the `triage` skill).

## Do

1. Take the text exactly as given. **Do not summarise, translate, correct or reorder it.**
2. Make a short title from it (a few words that will recognise it later), in the same language. If the text already starts with a title-like line, use that.
3. Body: the text, then, if known, one line `Source: …` (a link, a person, where it came from) and the date as `@date(YYYY-MM-DD)`.
4. `create_note` with no `folder` (so it goes to the Inbox) and no `tags`.
5. Answer with the title only: "Saved to Inbox: *Title*."

## When the input has several unrelated things

Make one note for each (a list of five separate ideas is five captures). If the items clearly belong together (one meeting, one
shopping list), make one note. When unsure, ask in one line.

## When the input is a task

"Remind me to call Minh on Friday" is a task, not a note. Capture it as a checklist line, with its due date, in the note named
for that day (see the `tasks` skill), or as `- [ ] Call Minh @due(2026-10-23T09:00)` in a new Inbox note titled "To do" if the user has no better place. Ask for the time if it matters.

## When the input is a URL

Do not fetch or summarise it unless asked. Title: the page's name if the user gave it, else the domain and a word. Body: the link in Markdown, `[name](https://…)`.

## Do not

- Do not add tags, links or headings; that is triage's job.
- Do not search for duplicates unless the user asks; a capture is cheap.
- Do not put it in a PARA folder, even if you can guess which.
