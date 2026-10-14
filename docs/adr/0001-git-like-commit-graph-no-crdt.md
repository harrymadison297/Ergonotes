# Each note has a git-like commit graph; no CRDT

Ergonotes is single-user, so two devices editing the same note while both offline is rare but real. We record every note's changes as immutable Commits that point at their parents, detect divergence as multiple Heads, merge three-way when edits do not overlap, and otherwise show a git-style diff for the person to resolve. We rejected CRDTs (Yjs/Loro/Automerge): they solve real-time multi-writer editing we do not need, force a non-Markdown source of truth, and add a heavy dependency for a problem the user explicitly called unnecessary.

## Consequences

- Sync becomes a union of immutable Commits, so it is idempotent and needs no coordination.
- Each device keeps showing its own Head until a person resolves a conflicted revision.
- Character-level auto-merge is not available; text merging is line/hunk based, and `ergonote-*` blocks are atomic.
