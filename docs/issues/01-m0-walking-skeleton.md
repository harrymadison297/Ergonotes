---
title: "M0: Walking skeleton (Windows app, notes and folders, no sync)"
labels: [milestone:m0, type:feature]
blocked_by: []
---

## Goal
A Windows app a person can use to create, edit and organise Markdown notes locally. Nothing syncs yet, but the data model is the final one so M1 does not migrate.

## Scope
- Tauri 2 shell + React UI, desktop shell layout (sidebar tree, editor pane).
- `Item` model with `type`, UUID, `parent`; Note = Markdown + frontmatter (ADR 0002, 0005).
- Default folders: Inbox, Projects, Areas, Resources, Archive, Templates; all ordinary, deletable.
- Capture target setting (default Inbox, recreated on capture if missing).
- Local storage: files are the truth, SQLite is a rebuildable index (FTS5 for search).
- Trash with 30-day retention.

## Acceptance
- Create / rename / move / delete notes and folders; restart keeps everything.
- Deleting the SQLite file and restarting rebuilds the index from files with no data loss.
- A note opened in another editor and saved is picked up by the app.
- Unknown `ergonote-*` fenced blocks round-trip byte-for-byte.
