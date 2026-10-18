---
name: tasks
description: Add, schedule, tick, group and review tasks in the user's Ergonotes notes: checklist items with due dates, reminders and flags, kept inside notes. Use when the user asks to add a to-do, set a deadline or reminder, mark something done, see what is overdue or due this week, or clean up their task list.
argument-hint: "[what to do with tasks]"
---

# Tasks

In Ergonotes a **task is a checklist line inside a note**; it does not exist anywhere else. `list_tasks` reads them all.

```
- [ ] Send the invoice @due(2026-10-15T17:00) @remind(2026-10-15T16:30) @flag
```

## Adding

1. Decide the note: the project or area note it belongs to (search for it); otherwise today's daily note (`daily_note`); otherwise a note titled "To do" in the Inbox. Do not make a new note per task.
2. Write the line with the smallest wording that still makes sense a month later: a verb and an object ("Send Acme the signed contract"). Add context as a link, not as a paragraph.
3. Dates: `@due(YYYY-MM-DD)` for a day, with `THH:MM` when a time matters. `@remind(...)` only when the user wants to be told, set before the due time. `@flag` only for what they call important or urgent. Resolve "Friday" and "tomorrow" against today's date; if you cannot be sure of today's date or the time zone, ask.
4. Put it where it belongs with `insert_after_heading` (for example under "Next actions") or `append_to_note`. Read the note first so you match its list style.

## Ticking

`list_tasks` to find the item (`noteId`, `index`), `complete_task`. Confirm by text, not index. For "I did all of these", tick one by one.

## Reviewing

- **Overdue / today / this week:** `list_tasks`, group by due date, show the text, the note title (linked) and the date. Flagged first.
- **Without a date:** list them separately and ask which deserve one; do not set dates yourself.
- **Stale:** tasks undone for a long time; ask whether to keep, reschedule or tell the user how to drop them (you cannot delete lines the user did not ask you to remove; with their say-so use `replace_text` to remove a line).

## Moving a date

Use `replace_text` on the line, changing only the `@due(...)`. Keep the rest.

## Not tasks

- A calendar entry is an **event**: `@event(2026-10-20T09:00-10:30)`; it cannot be ticked.
- Habits (things done repeatedly, with streaks) are a separate feature and are private to AI. Do not create or edit them; tell the user to use the Habits page.
- A reminder alone is just `@remind` on a task. There are no standalone reminders.

## Do not

- Do not copy a task into several notes.
- Do not tick a task the user did not say is done.
- Do not change a task's wording when only its date changes.
