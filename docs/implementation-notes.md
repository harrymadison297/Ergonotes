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
| Search popup | Search by title, text, tag | `searchHits` (core) returns folders by name and notes with the folder path and the passage that matched (at most 40); `Ctrl/Cmd+K` or the round search button opens it. "Show all results" still goes to the filtered list | Needed passages, not just summaries. |
| Pane widths, table of contents | Brand guidelines §6 | Per-device preferences in `localStorage` (`state/prefs.ts`), not synced. Widths are CSS variables on the root, clamped to 50 % of the window by the grid. The contents panel is on by default and hidden below 900 px. There is no interface scale: browser/webview zoom does that | A phone and a desktop want different layouts. |
| AI settings | ADR 0008 | Provider, key, models and the two scope switches are one encrypted `config` item (fixed id) in the Vault, so they sync like a note but are never listed or exported. Suggestion on/off and its delay are per-device preferences. Two Devices saving at once: the newest wins (no conflict screen) | A key typed once works on every Device; a conflict screen about a key would be absurd. |
| Conversations | ADR 0008 | One `chat` item per conversation (id chosen by the app, JSON in the body, long tool results cut). Two Devices extending one at once: newest wins. A conversation is capped at 4 MB | History on every Device without a new sync mechanism. |
| Assistant edits | ADR 0008 | The chat proposes a whole new body for a note; the diff is computed for display and the accepted text goes through the editor (so it autosaves like typing). If the note changed meanwhile the proposal is three-way merged, and refused when the same place changed | Keeps a single writer for an open note. |
| Diagrams | "draw for me" | The model writes Mermaid; the app converts it with `@excalidraw/mermaid-to-excalidraw` and stores an ordinary drawing block. Only diagrams, no free illustration; the tool exists only in the app (not on MCP, which has no browser to convert with) | Mermaid is far more reliable from a model than raw Excalidraw JSON. |
| Argon2id cost | 64 MiB, 3 passes | Implemented with `hash-wasm` (WASM). Not measured on a real phone | Measure on a mid-range device and adjust `DEFAULT_KDF`. |

## Insert menu, recording and speech-to-text

- Element forms are in docs/adr/0009. `packages/app/src/editor/insertItems.tsx` is the one list behind the Insert menu
  and the "/" menu; `editor/blocks.tsx` holds the Markdown rules and node views of the elements Markdown has no syntax
  for. A new element is: a node with a `markdown` storage, an entry in that list, a line in ADR 0009 and in the skill.
- `\newpage`, `[TOC]`, `:::toggle`, `$$` are block rules added to markdown-it by the node's `parse.setup`; `☐`/`☑` and
  voice notes are recognised after rendering (`updateDOM`) because the inline text rule would swallow them.
- A string passed to `insertContent` is read as Markdown by tiptap-markdown, which is how a recording lands as clip +
  summary + toggle in one call. An editor always keeps one empty paragraph after a block (TrailingParagraph), so the
  caret has somewhere to go after a table, a diagram or a formula.
- Recording uses MediaRecorder (Opus, 32 kbit/s) and needs a secure context; the microphone is not available on a plain
  http address other than localhost. Speech-to-text posts the file as multipart to `<custom server>/v1/audio/transcriptions`
  from the device, or from the server peer in the web build (`/api/ai/transcribe`, 40 MB body limit).

## AI limits

- Settings are a list of connections plus a model per job. The first version stored one provider with a key per
  provider; `normalizeAiConfig` turns that into connections (ids `openrouter`, `anthropic`, `custom`) when it is read, so
  nothing is lost. The chat model chosen in the chat is the same setting as in Settings → AI (not per conversation).

- The model picker lists what the provider's `/models` returns (OpenRouter: name, context, free, tools and reasoning
  flags; Anthropic: names; Ollama and OpenAI-style servers: ids). It is fetched when the AI tab opens and can be reloaded;
  a name that is not in the list can still be typed. The list goes through the server peer in the web build.

- Thinking levels map to what each provider accepts: OpenRouter `reasoning.effort` / `reasoning.enabled=false`,
  OpenAI-style servers `reasoning_effort` (`none` for Off), Anthropic `thinking.budget_tokens` 1024 / 4096 / 10000 on top
  of the answer's tokens (and no temperature). A model or server that does not think ignores it. `<think>` tags in the
  text are split off and shown as thinking. Thoughts are stored in the saved conversation.

- *Custom server* means the OpenAI chat API (`/v1/chat/completions`, `/v1/models`). A model without tool support can
  chat but cannot edit. Reasoning is not switched off for it (an OpenRouter-only option), so a thinking model may be
  slow for suggestions. Some servers refuse browser requests from another origin: the Tauri apps and the server peer are
  not affected, a plain browser build without a server is (Ollama: set `OLLAMA_ORIGINS`).

- A free OpenRouter model can be rate limited for minutes (`429 … temporarily rate-limited upstream`); the chat shows the
  provider's message. The optional live test (`ai-live.test.ts`) skips instead of failing in that case.
- A reasoning model spends tokens thinking first: suggestions turn reasoning off on OpenRouter, the chat does not.
- A conversation is saved as a `chat` item after each turn (title = first message). The assistant has no memory across conversations; opening one from History continues it with the text it was sent.
- Free models often fail on the first try (429 / "JSON error injected into SSE stream"): the provider layer retries twice before anything was produced, and says so in the panel.
- Streaming goes through the Tauri HTTP plugin on devices; it was not exercised on Android/Windows in this change.
- There is no cost cap or step limit: the loop stops by itself after 50 tool rounds in one request.

## Decisions to confirm

- **"Keep this device unlocked" is on by default** in the native apps: it stores the master key in the app's own storage so the password is not asked at every launch. It is not in ADR 0004; untick it (or default it off) if you prefer asking every time. The web build never stores the key in the browser.
- **`ERGONOTES_PASSWORD`** unlocks the server at start-up (ADR 0004 now says so). Without it the server stays locked after a restart until someone signs in.
- UI wording says "Version history" for a note's earlier Commits (glossary: Commit).

## Not implemented

- Tag colour picker and custom folder colours.
- Folder view (icon/details) on phones: a folder opens its note list there.
- Keyboard-only drag and drop is covered by the "Move to…" menu entry, not by arrow-key dragging.
- Editing spreadsheets/decks natively (xlsx/csv/pptx are stored, previewed read-only, and downloadable).
- Drawing "promote to item", PDF export other than the system print dialog, template default-folder picker (the `folder` frontmatter key is honoured but nothing in the UI sets it).
- Graph view, Evernote `.enex` import, background sync on Android, key rotation / device revocation, recovery phrase.
- Chat UI inside the app (the MCP endpoint is there for external assistants).
- iOS.

## Known limits

- The editor rewrites the whole body through its Markdown serializer on every change, so Markdown that has no editor node (raw HTML, footnotes) can be normalised. Notes written by agents through MCP are affected the same way once a person edits them.
- A stale device (offline for more than the history window) is not detected on purpose: it shows up as a `no-base` conflict that a person resolves, and the first push after compaction is sent as a snapshot.
- `{{cursor}}` in a template is removed, not turned into the caret position; HTML export shows drawings as a text placeholder (SVG/PNG export is in the drawing dialog).
- The web build sends no `Content-Security-Policy` header yet. Drawings are rendered as images, so note content never injects HTML into the page.
- S3 requests are signed with the device clock; a clock more than 15 minutes off fails every request until corrected.

- The Markdown mirror is one way: it is rebuilt in a temporary folder and swapped in when a note changes, so edits made to those files outside the app are replaced. It inlines attachments as base64 `data:` URIs (the same export a person gets from the Export menu).
- Reminders are checked every 20 s while the app is open; one that came due while the app was closed shows once on the next start (within a week). Which reminders have fired is remembered per device in `localStorage`.
- Two devices that are offline and both open the same day's daily note each create one; they appear as two notes with the same title.
- `probe/<device>` objects on the Store hold the clock value used to learn the Store's time offset and are never deleted.
- The simulation test runs four random seeds (the issue asked for forty) to keep the suite fast; run it with more seeds before a release that changes the merge or compaction code.
- S3 and WebDAV stores are only exercised by the browser/device end-to-end run against MinIO, not by unit tests.

- The first `Join` of a very large vault downloads every commit; there is no progressive/lazy sync.
- `overlays/` and `gc/` are announced through the inbox, but a full reconcile lists them (on "Sync now (full check)" and when this device was offline for 25+ days).
- Two devices compacting the same note at the same instant is covered by reasoning and by the simulation only sequentially.
