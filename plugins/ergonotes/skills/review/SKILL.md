---
name: review
description: Look back over a week or month of the user's notes and tasks and write a review note: what was done, what is still open, what themes came up, what to link or revisit, and what to focus on next. Use for "weekly review", "monthly review", "what did I do this week", "recap", "retrospective".
argument-hint: "[week | month | a date range]"
---

# Review

A review is a short, honest summary made from evidence in the notes, then a few choices for the next period.

## Steps

1. **Range.** Default: the last 7 days (week) or the calendar month; if the user said "this week" use Monday to today. State the dates you used. If you are unsure of today's date, ask.
2. **Gather.** `search_notes` with `since`/`until` (up to 50; page by narrowing the range), `list_recent`, `list_tasks` with `includeDone: true` to see what was ticked and what is overdue. `read_note` the ones that matter (daily notes of the period first: `daily_note` for each date only when they exist; it creates a missing one, so prefer `search_notes` with the daily folder and dates).
3. **Sort.** Done (ticked tasks, finished projects), in progress, overdue or stuck, new notes and ideas, themes (tags that came up more than once), people and projects mentioned.
4. **Write the review note.** Create it with `create_note` titled "Weekly review 2026-W42" (or "Monthly review 2026-10"), Inbox unless the user names a folder, tagged with an existing review tag if there is one. Shape:

```markdown
## Done
- Finished the Acme proposal ([Acme proposal](...))

## In progress
- [Project A](...): what is next

## Overdue or stuck
- [ ] Task text, due 2026-10-10 (from [Note](...))

## Themes
- What kept coming up, with links

## Loose ends
- Notes that should be linked, merged or tagged (do not do it now)

## Next week
1. The three things that matter, and why
```

5. Tell the user the note's title and the three most important findings.

## Rules

- Every item comes from a note or task. No filling. If the week was quiet, say so.
- Do not change other notes. The review lists loose ends; `triage` and `maintain` act on them.
- Do not judge the user; describe.
- Check that the note says what it should by reading it back.
