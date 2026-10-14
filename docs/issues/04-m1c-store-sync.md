---
title: "M1c: Sync through a passive Store (S3-compatible first), inbox cursor"
labels: [milestone:m1, type:feature, risk:high]
blocked_by: [02, 03]
---

## Goal
Push and pull encrypted commits through an S3-compatible Store (ADR 0003). WebDAV second.

## Requirements (from the spike)
- Layout: `vault.json`, `commits/<note>/<id>`, `inbox/<serverTime>-<device>-<id>` markers, `overlays/`, `gc/`, `devices/<id>`.
- **Do not poll with a full LIST.** With 20 000 commits a full list-and-diff is 21 LIST requests per poll (about 0.9 s on loopback); an inbox cursor is 1-2.
- Inbox keys use **server time**, not the client clock: learn the offset from the Store (own PUT then LIST `LastModified`, or the `Date` header). Spike: with +-3 h skew and a 30 min cursor margin, client-clock keys silently missed commits; server-corrected keys missed none.
- Keep a manual full reconcile (the Sync button, and daily) as the safety net for any missed marker.
- A commit whose first parent is no longer on the Store MUST be pushed as a snapshot (self-contained), never as a delta.
- Push is debounced to one per few minutes (default 5) while a note is being edited; closing the note, switching note or pressing Sync pushes at once (ADR 0006). Pull keeps its own 30-60 s cycle.
- Announce `overlays/` and `gc/` objects through the same inbox markers; the spike listed them in full on every pull, which is unproven at scale.
- Consider bundling several commits per PUT (a push is usually many small commits).

## Acceptance
- Two Windows installs converge through MinIO in CI.
- Simulated skew of +-3 h with the corrected keys loses nothing.
- Interrupted push / pull is safe to retry (objects are immutable and idempotent).
