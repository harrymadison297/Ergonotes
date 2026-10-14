---
title: "M1e: History retention and compaction (ADR 0006)"
labels: [milestone:m1, type:feature, risk:high]
blocked_by: [04]
---

## Requirements (from the spike)
- Commit ids are **stable**; compaction does not rewrite ids. A retained commit whose parent was dropped is replaced by an *overlay* (snapshot + re-pointed parents). ADR 0006 should be amended: "same inputs yield the same commit id" is not how it works.
- One overlay per commit id (highest `subsumed` count wins); an overlay for a dropped commit is deleted with it.
- Publish a small `gc/` manifest of dropped ids so every device forgets them; without it devices keep dead commits locally.
- Gate compaction on `devices/<id>` seen heads: drop a commit only if it is a strict ancestor of every live device's seen heads, and never a head, merge, branch point or tombstone.
- A device stale for more than 30 days gets a two-way diff (no auto-merge) when it returns; its first push of any commit must be a snapshot.
- Compaction itself must be safe to run on any device, repeatedly, concurrently.

- Amend-before-push plus the push debounce (see M1c) is the main lever on commit count; compaction only handles what remains. Do not rely on compaction for the first 7 days.

## Acceptance
- Concurrency test, not done in the spike: two devices compact the same note at the same moment; heads, text and the set of retained commits must agree after both sync.
- Simulation: 40 seeds x (compaction, tombstones, one device offline 70 days): zero lost lines, zero texts that cannot be read, all devices end on the same text.
- Size check on a year of heavy editing (see the spike report for the numbers to beat).
