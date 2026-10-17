# A habit is a note that records only what was done; everything else is computed

*Amended by ADR 0014: a Habit now lives in the hidden `.habits/` folder and is no longer a Note; the rest of this ADR stands.*

ADR 0010 (the vault is a folder of Markdown) and ADR 0009 (plain Markdown forms) stand. CONTEXT.md's rule that a Task lives in a Note is kept: the Tasks a Habit offers are not stored, so they are not Tasks until ticked.

A Habit has to appear as something to do on Home, the Calendar and the Tasks page, show streaks and misses, take a remark for any day, and be mentioned from other notes. Storing a Task per Habit per day would write into notes by itself, two Devices would both write the same day (and the Merge would see overlapping changes), and a missed day would need a stored marker.

## Decision

- A Habit is a Note in `Habits/` with `habit: true`, `target: n`, `per: 1|3|5|7`, `start: <date>` and optional `archived: true` in its frontmatter. There is no time of day.
- Under `## Log` it holds only what the person did and when: `- [x] @done(2026-10-17T07:42) comment` per time done (a backdated one has a date and no time), and plain bullets `- 2026-10-16: reason` for a day's remark. A due day with nothing done has no line.
- Misses, streaks, rates and the heat map are computed over a window of the last `per` days when shown (see *Habit day* in CONTEXT.md). Nothing computed is written.
- The Tasks a Habit offers for today are virtual, drawn from the Target and the count so far ("2/3"); ticking one appends a line. The Task parser also reads `@done(...)`, so the Calendar and the Tasks page count those lines on their `@done` day.
- A mention is a standard Markdown Link to the Habit's file, typed with `@`, so it is also a Backlink; the editor draws a link to a Habit as a chip with its streak and today's state.
- Nudges are fixed sentences, not AI output, shown on Home, on the Habit and as one toast at start-up.

## Consequences

- Two Devices that both log within the same minute add two lines; that is what happened, and the Merge keeps both. A line is never rewritten by the app except to edit its remark.
- Opening the Habit in VS Code or Obsidian shows a readable log; changing `target` or `per` changes how the past is judged, because nothing about it was stored.
- A Habit with no `start:` is treated as starting on its first Check-in.
