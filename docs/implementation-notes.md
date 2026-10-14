# Implementation notes

Where the code differs from the ADRs / issues, and what is not done. Keep this list honest; remove a line when it is fixed.

## Deviations from the ADRs

| Topic | Decision / issue | What the code does | Why |
|---|---|---|---|
| Local index | ADR "files are truth, SQLite derived index" | Commits are stored as JSON (files on the server, IndexedDB on devices); the search index (MiniSearch), backlinks and task lists are built **in memory** at unlock | Works identically in the webview and on the server with no native dependency. Fine for tens of thousands of notes; revisit with SQLite if start-up time hurts. |
| Windows vault folder | "Windows: a folder the user chooses, openable in other editors" | The on-device store is IndexedDB inside the app. The **server peer** writes a Markdown mirror (`$ERGONOTES_DATA/markdown`). No folder mirror on Windows/Android yet | Needs Tauri fs plugin and a folder picker; one-way export exists per note (Export → Markdown). |
| Attachments (Q24) | Content-addressed blobs, lazy download on Android, 50 MB soft limit | A file is an immutable `file` Item (base64 body) that syncs like any commit; identical content is stored once (sha-256); **no lazy download**, hard limit 25 MB, orphans are not collected | Reuses the commit machinery; blob protocol is a later optimisation. |
| Web client | ADR 0007: one TS core everywhere | The web build is a thin client: it calls the server peer's Vault over HTTP RPC (`/api/rpc/<method>`); the core runs in the webview only in the Tauri apps | Matches "web needs the server, no offline". |
| Push debounce | ADR 0006 | `Vault` pushes 5 minutes after the last local change while the app runs; `flush()` runs on close/hide/Sync | As decided; the pull timer is 45 s. |
| Merge granularity | ADR 0001 (line/hunk) | A Markdown paragraph is one line, so two edits inside one paragraph conflict; edits in different paragraphs merge. Hard-wrapped imported text is re-flowed by the editor on first edit | Inherent to line-based merging of Markdown. |
| Delete vs edit | Always ask | Trash is a frontmatter flag, so trash-vs-edit is detected in the frontmatter merge and surfaces as a conflict; *purge*-vs-edit also conflicts | See `packages/core/src/merge.ts`. |
| Reminders | Local notifications | Fire while the app is running (web Notification API / Tauri notification plugin); **no background scheduling** when the app is closed | Android background work is out of v1 (Q12). |
| Android share intent | "Share → Inbox capture" (issue 07) | Implemented for `text/plain`: `MainActivity.kt` keeps the shared text and the UI files it with `Vault.capture()` | Images/files shared into the app are not handled. |
| Tag colours | Brand guidelines: tags are coloured | A tag's colour is a hash of its top-level name into the 8-colour tag palette (`state/tags.ts`); nothing is stored or synced | Same colour on every device without a setting. A person cannot pick a colour yet. |
| Folder pane | "Folders are the tree a person navigates" | Opening a folder with no note selected shows its contents as large icons or a details list (`views/Explorer.tsx`); tag and search results use the same pane | Replaces the empty "Select a note" half of the screen. |
| Search popup | Search by title, text, tag | `searchHits` (core) returns folders by name and notes with the folder path and the passage that matched; `Ctrl/Cmd+K` or the round search button opens it. "Show all results" still goes to the filtered list | Needed passages, not just summaries. |
| Argon2id cost | 64 MiB, 3 passes | Implemented with `hash-wasm` (WASM). Not measured on a real phone | Measure on a mid-range device and adjust `DEFAULT_KDF`. |

## Decisions to confirm

- **"Keep this device unlocked" is on by default** in the native apps: it stores the master key in the app's own storage so the password is not asked at every launch. It is not in ADR 0004; untick it (or default it off) if you prefer asking every time. The web build never stores the key in the browser.
- **`ERGONOTES_PASSWORD`** unlocks the server at start-up (ADR 0004 only mentions a key file). Without it the server stays locked after a restart until someone signs in.
- UI wording says "Version history" for a note's earlier Commits (glossary: Commit).

## Not implemented

- Native app icons (`apps/desktop/src-tauri/icons`) still use the previous green; run `tauri icon packages/app/public/icon.svg` before the next desktop release.
- Tag colour picker and custom folder colours.
- Keyboard-only drag and drop is covered by the "Move to…" menu entry, not by arrow-key dragging.
- Editing spreadsheets/decks natively (xlsx/csv/pptx are stored, previewed read-only, and downloadable).
- Drawing "promote to item", PDF export other than the system print dialog, template default-folder picker (the `folder` frontmatter key is honoured but nothing in the UI sets it).
- Graph view, Evernote `.enex` import, background sync on Android, key rotation / device revocation, recovery phrase.
- Chat UI inside the app (the MCP endpoint is there for external assistants).
- iOS.

## Known limits

- The first `Join` of a very large vault downloads every commit; there is no progressive/lazy sync.
- `overlays/` and `gc/` are announced through the inbox, but a full reconcile lists them (on "Sync now (full check)" and when this device was offline for 25+ days).
- Two devices compacting the same note at the same instant is covered by reasoning and by the simulation only sequentially.
