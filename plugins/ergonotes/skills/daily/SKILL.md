---
name: daily
description: Plan the day or close it in the user's daily note: open today's note, pull in tasks that are due or overdue, choose the three that matter, record what happened, and carry unfinished work to tomorrow. Use for "plan my day", "what's on today", "start my day", "end of day", "shutdown", "daily review", or when the user wants something written in today's note.
argument-hint: "[plan | close | a date YYYY-MM-DD]"
---

# The daily note

The day's note is created by the app from its template when the day is opened. Use `daily_note` with a date (YYYY-MM-DD);
it opens the note and creates it if missing. Work out "today" from the user's context; if you cannot tell the date or the
time zone, ask once.

## Plan (morning)

1. `daily_note` for today; `read_note` it, so you know its headings and what is already there.
2. `list_tasks` (open ones). Sort into: overdue, due today, flagged (`flag`), due this week.
3. **Events** (`@event(...)`) are written in notes; there is no tool that lists them. Read what today's note already shows and, if the user keeps events elsewhere, ask. Do not guess.
4. Propose **three things that matter most** and why, plus what can wait. Keep it short and wait for the user's reaction.
5. After they agree, write it into the note with `insert_after_heading` under a heading that exists ("Today", "Plan"); if the note has none, add `## Today` with `append_to_note`. Format:

```markdown
## Today
- [ ] The most important thing @due(2026-10-18)
- [ ] Second
- [ ] Third

**Later this week:** [Project A](../Projects/Project A.md), the invoice
```

Do not re-create tasks that already exist in other notes: link to the note instead, or mention the task's text without
copying it.

## Close (evening)

1. `read_note` today's note and `list_tasks` for what is still open.
2. Ask what happened if the note does not say; do not invent it.
3. Add a short **Done / Learned / Tomorrow** under the day's heading with `insert_after_heading` or `append_to_note`. Use `complete_task` for things the user says they finished.
4. Unfinished tasks: do not duplicate them. Where a task lives in the daily note itself, move it to tomorrow's note: `daily_note` for tomorrow, `append_to_note` the line with a new `@due`, and `replace_text` the old line to mark it moved ("(moved to tomorrow)"). Tasks in other notes keep their place; mention them.

## Another date

For "yesterday", "last Friday" or a date, use that date in `daily_note`. Never rewrite a past day's content: add under a heading
such as "Added later".

## Do not

- Do not create the daily note for many days ahead.
- Do not remove tasks or text from the day's note; mark and move.
- Do not write the user's feelings or reflections for them. Ask, then record their words.
