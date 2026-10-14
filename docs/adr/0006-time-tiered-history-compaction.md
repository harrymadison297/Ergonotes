# History is amended before push and compacted by time tiers

A person editing one note for an hour must not leave hundreds of Commits. A Commit is a local draft until pushed; further edits amend the draft instead of chaining new Commits, and only pushed Commits are immutable. While a note is being edited, pushes are debounced to one every few minutes (default 5, the value measured in the spike); closing the note, switching note, or pressing Sync pushes at once. Pulls keep their own faster cycle.

Pushed linear chains are later reduced by age: everything for 7 days, one Commit per day to 90 days, one per week after that, one per month after a year. Compaction never touches Heads, branch points, merges or tombstones, and only runs on ranges every live Device has seen.

## How compaction works

Commit ids never change. A retained Commit whose parent was dropped is replaced by an overlay: a full snapshot with re-pointed parents. There is one overlay per Commit id; the one that subsumes the most Commits wins. The overlay of a dropped Commit is deleted with it.

Dropped ids are listed in a `gc/` manifest so every Device forgets them once no local Commit builds on them. Without it, Devices keep dead Commits indefinitely.

## Self-containment

A Commit pushed while its first parent is no longer on the Store is pushed as a full snapshot, never as a delta. A Device must refuse to edit a note whose Head cannot be materialised; it must never treat "unreadable" as "empty".

## Stale Devices

A Device offline longer than the history window (30 days) cannot be auto-merged against a base that was compacted away. On return it gets a two-way diff and the person chooses. No data is lost.

## Consequences

- Amend alone barely helps: with pushes every 45 s a year of heavy editing left 10 624 Commits against 19 259 without amend, while pushes every 5 minutes left 2 377. The push debounce is the main lever, compaction handles what remains.
- Other Devices see an edit up to a few minutes late unless Sync is pressed.
- Deltas are line diffs of the Markdown file, with a full checkpoint roughly every 20 Commits.
- Two Devices compacting at the same moment is expected to be safe because ids are stable and the highest overlay wins, but this was not exercised concurrently in the spike and needs a test.
