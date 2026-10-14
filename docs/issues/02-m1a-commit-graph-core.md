---
title: "M1a: Commit graph core (commits, heads, deterministic merge, amend)"
labels: [milestone:m1, type:feature, risk:high]
blocked_by: [01]
---

## Goal
Implement the per-note commit graph from ADR 0001 as a pure library with no I/O, so it can be tested exhaustively.

## Requirements (from the spike)
- Commit id is a content hash that does **not** include wall-clock "now" for merge commits: author `auto`, ts = max(parent ts), parents sorted. Two devices merging the same heads concurrently MUST produce the same commit.
  Spike result: with non-deterministic merge commits two devices keep creating merges forever (+4 objects/round, never settles).
- Merge base: when there are several maximal common ancestors, build a virtual base by merging them (git "recursive"). Spike: picking one LCA produced duplicated lines; the virtual base removed them.
- Block-level rules: `ergonote-*` blocks are atomic; frontmatter merges per key; `tags` merge as a set.
- Amend: an unpushed draft authored by this device is rewritten in place; never amend a merge commit or a pushed commit.
- `edit()` must refuse (never treat "cannot read" as "empty") when the head's text cannot be materialised.
- Snapshot every N deltas (checkpoint). N = 20 is fine; spike showed it matters little once compaction runs.

## Acceptance
- Property test: N devices, random edits/sync order/offline spells; after settling, every device has the same heads and text, and no inserted line is lost unless a person deleted or discarded it.
- Concurrent-merge test: two devices merge the same divergence in the same round and converge in one round.
- Criss-cross test: no duplicated or dropped lines.
