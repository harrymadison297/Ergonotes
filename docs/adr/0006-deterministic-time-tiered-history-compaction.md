# History is amended before push and compacted by deterministic time tiers

A person editing one note for an hour must not leave hundreds of Commits. A Commit is a local draft until pushed; further edits amend the draft instead of chaining new Commits, and only pushed Commits are immutable. Pushed linear chains are later squashed by age: everything for 0–7 days, one per day to 90 days, one per week after that, one per month after a year. Squashing never touches Heads, branch points or merges, is deterministic (same inputs yield the same Commit, so two Devices compacting at once agree), and only runs on ranges every Device has seen or that are older than 30 days.

## Consequences

- A Stale Device (offline longer than the window) whose base Commit was squashed cannot be auto-merged; it gets a two-way diff and the person chooses. No data is lost.
- Deltas are line diffs of the Markdown file, with a full checkpoint roughly every 20 Commits to bound replay cost.
