---
title: "M1d: Conflicted revision UI (icon, git-style diff, per-hunk resolve)"
labels: [milestone:m1, type:feature, ux]
blocked_by: [02]
---

## Behaviour (as decided)
- The note keeps showing this device's own head; an icon marks "conflicted revision". Non-blocking.
- Opening it shows a git-style diff against each other head (several if needed), with device name and time.
- Resolve by: keep whole version, pick per hunk, edit by hand, or keep both (second becomes a new note).
- Delete vs edit is always presented as a choice, never decided silently.
- Resolving writes a merge commit with all heads as parents; other devices see it as resolved after sync.
- Sidebar "Conflicts" entry with a count; mobile shows the diff in a single column.

## Notes from the spike
- Auto-merge handled most divergence: manual resolutions were roughly 1 per 2-3 auto merges in a deliberately hostile simulation (4 devices, 12 notes, edits every few hours). Real use should be far lower, but the diff UI must still be good, not an afterthought.
- Excluded from search, tasks and export until resolved: the non-displayed heads.
