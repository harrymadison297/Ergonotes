# Implementation notes

Where the code differs from the ADRs / issues, and what is not done. Keep this list honest; remove a line when it is fixed.

## Deviations from the ADRs

| Topic | Decision / issue | What the code does | Why |
|---|---|---|---|
| Local index | ADR 0010: the folder is truth, the database is derived | The Markdown files are the notes; the commit graph (history, merging, sync), conversations and AI settings are items in `.ergonotes/` (sealed with the vault key); the search index (MiniSearch), backlinks and task lists are built **in memory** at unlock from the files | Works identically in the webview and on the server; a few thousand notes index in well under a second. |
| Vault folder on every platform | "Windows: a folder the user chooses, openable in other editors" | Server peer: `$ERGONOTES_VAULT_DIR`. Windows and Linux apps: the folder chosen on the first screen (default `Documents/Ergonotes`), reached through the shell's `vault_*` commands. Android: the folder is chosen with the system's folder chooser (Storage Access Framework, `SafVault.kt`, reached from the webview as `window.ErgoVault`); until one is chosen the app uses its own folder on shared storage (`Android/data/<package>/files/Ergonotes`). The browser build without a server keeps the vault in IndexedDB with an in-memory folder | The Tauri fs plugin needs per-path permissions; the shell's own commands are confined to one folder. |
| Attachments (Q24) | Content-addressed blobs, lazy download on Android, 50 MB soft limit | A file under the vault (normally `attachments/`) is real on disk and is also kept as an immutable `file` item (base64 body) so it syncs like any commit; identical content is stored once (sha-256); **no lazy download**, hard limit 100 MB (a bigger file stays on its disk, is opened from it, is named in a warning, and is not synced), orphans are listed on the Files page | Simplest thing that keeps every device complete. |
| Web client | ADR 0007: one TS core everywhere | The web build is a thin client: it calls the server peer's Vault over HTTP RPC (`/api/rpc/<method>`); the core runs in the webview only in the Tauri apps | Matches "web needs the server, no offline". |
| Push debounce | ADR 0006 | `Vault` pushes 5 minutes after the last local change while the app runs; `flush()` runs on close/hide/Sync | As decided; the pull timer is 45 s. |
| Merge granularity | ADR 0001 (line/hunk) | A Markdown paragraph is one line, so two edits inside one paragraph conflict; edits in different paragraphs merge. Hard-wrapped imported text is re-flowed by the editor on first edit | Inherent to line-based merging of Markdown. |
| Delete vs edit | Always ask | The Trash is a reserved key in the stored text (and the file is under `.trash/`), so trash-vs-edit is detected in the merge and surfaces as a conflict; *purge*-vs-edit also conflicts | See `packages/core/src/merge.ts`. |
| Reminders | Local notifications | Fire while the app is running (web Notification API / Tauri notification plugin); **no background scheduling** when the app is closed | Android background work is out of v1 (Q12). |
| Android share intent | "Share → Inbox capture" (issue 07) | Implemented for `text/plain`: `MainActivity.kt` keeps the shared text and the UI files it with `Vault.capture()` | Images/files shared into the app are not handled. |
| Tag colours | Brand guidelines: tags are coloured | A tag's colour is a hash of its top-level name into the 8-colour tag palette (`state/tags.ts`); nothing is stored or synced | Same colour on every device without a setting. A person cannot pick a colour yet. |
| Folder pane | "Folders are the tree a person navigates" | Opening a folder with no note selected shows its contents as large icons or a details list (`views/Explorer.tsx`); tag and search results use the same pane | Replaces the empty "Select a note" half of the screen. |
| Search popup | Search by title, text, tag | `searchHits` (core) returns folders by name and notes with the folder path and the passage that matched (at most 40); `Ctrl/Cmd+K` or the round search button opens it. "Show all results" still goes to the filtered list | Needed passages, not just summaries. |
| Pane widths, table of contents | Brand guidelines §6 | Per-device preferences in `localStorage` (`state/prefs.ts`), not synced. Widths are CSS variables on the root, clamped to 50 % of the window by the grid. The contents panel is on by default and hidden below 900 px. There is no interface scale: browser/webview zoom does that | A phone and a desktop want different layouts. |
| AI settings | ADR 0008 | Provider, key, models and the two scope switches are one encrypted `config` item (fixed id) in the Vault, so they sync like a note but are never listed or exported. Suggestion on/off and its delay are per-device preferences. Two Devices saving at once: the newest wins (no conflict screen) | A key typed once works on every Device; a conflict screen about a key would be absurd. |
| Conversations | ADR 0008 | One `chat` item per conversation (id chosen by the app, JSON in the body, long tool results cut). Two Devices extending one at once: newest wins. A conversation is capped at 4 MB | History on every Device without a new sync mechanism. |
| Assistant edits | ADR 0008 | The chat proposes a whole new body for a note; the diff is computed for display and the accepted text goes through the editor (so it autosaves like typing). If the note changed meanwhile the proposal is three-way merged, and refused when the same place changed | Keeps a single writer for an open note. |
| Diagrams | "draw for me" | The model writes Mermaid; the app converts it with `@excalidraw/mermaid-to-excalidraw` and stores an ordinary drawing block. Only diagrams, no free illustration; the chat tool exists only in the app. The desktop app's MCP endpoint answers from the webview, so it offers drawing tools too (ADR 0015) | Mermaid is far more reliable from a model than raw Excalidraw JSON. |
| Argon2id cost | 64 MiB, 3 passes | Implemented with `hash-wasm` (WASM). Not measured on a real phone | Measure on a mid-range device and adjust `DEFAULT_KDF`. |

## The vault folder (ADR 0010)

- `packages/core/src/folder.ts` holds the pure parts (file text <-> stored text, surgical frontmatter edits, safe file
  names, links, block preservation); `vaultfs.ts` the `VaultFs` seam (memory, Node, the Tauri shell) and `FsPersist`;
  `vault.ts` the engine. Tests: `folder.test.ts`, `folder-vault.test.ts`; end to end: `e2e/folder.mjs`.
- A note's stored text is its file with reserved `_ergo_*` keys added (path, trashed, line ending, byte order mark).
  Those never reach the file. A file without an `id` keeps none until the app writes *content* into it; moving,
  trashing and rewriting a link for another note's sake do not touch the file's text.
- The folder is looked at every 3 s on the server and desktop (size and modification time first, then a hash), and
  before every sync. A file modified less than 0.6 s ago is read on the next look. There is no OS file watcher yet.
- A move or rename made by another program is recognised by the `id` in the file, or, for a file without one, by an
  unchanged content hash. A copy of a note gets a new identity. A folder that suddenly has no files at all is treated as
  an unplugged drive, not as a deletion.
- Two devices that give two notes the same path: the note with the smaller id keeps the name, the other gets `Name 2`,
  decided the same way on both.
- The editor writes back only what changed: blocks (paragraphs, lists, fences...) that equal what the editor made from the
  file on load are replaced by the file's own text (`preserveBlocks`). Syntax it does not know is a raw atom
  (`editor/raw.tsx`): `![[x]]`, `%%c%%`, `[^1]`, `^id`, inline HTML, a `#tag` opening a paragraph; HTML blocks, comments
  and anything else in angle brackets are a raw block.
- Not done: a file watcher (events instead of the 3 s look), syncing empty folders, a warning before a vault folder is
  opened inside a cloud-synced directory. On Android a provider that reports no modification time (some cloud
  providers behind the chooser) makes a same-size edit invisible until the size changes; a local folder is fine.

## Insert menu, recording and speech-to-text

- Element forms are in docs/adr/0009. `packages/app/src/editor/insertItems.tsx` is the one list behind the Insert menu
  and the "/" menu; `editor/blocks.tsx` holds the Markdown rules and node views of the elements Markdown has no syntax
  for. A new element is: a node with a `markdown` storage, an entry in that list, a line in ADR 0009 and in the skill.
- `<details>`, the page-break `<div>` and `$$` are block rules added to markdown-it by the node's `parse.setup`; `☐`/`☑`
  and voice notes are recognised after rendering (`updateDOM`) because the inline text rule would swallow them.
- A string passed to `insertContent` is read as Markdown by tiptap-markdown, which is how a summary lands as text under
  a record in one call. An editor always keeps one empty paragraph after a block (TrailingParagraph), so the
  caret has somewhere to go after a table, a diagram or a formula.
- Recording uses MediaRecorder (mono Opus, 24 kbit/s) and needs a secure context; the microphone is not available on a plain
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

- A block the person edits is written by the editor's Markdown serializer, so its text can be normalised (`*` bullets become `-`, a hard-wrapped paragraph is one line, `*`/`_` and `[`/`]` in text are backslash-escaped); blocks nobody edited are kept as they were (see the vault folder section). Notes written by agents through MCP are plain text and are read the same way.
- A stale device (offline for more than the history window) is not detected on purpose: it shows up as a `no-base` conflict that a person resolves, and the first push after compaction is sent as a snapshot.
- `{{cursor}}` in a template is removed, not turned into the caret position; HTML export shows drawings as a text placeholder (SVG/PNG export is in the drawing dialog).
- The web build sends no `Content-Security-Policy` header yet. Drawings are rendered as images, so note content never injects HTML into the page.
- S3 requests are signed with the device clock; a clock more than 15 minutes off fails every request until corrected.

- Reminders are checked every 20 s while the app is open; one that came due while the app was closed shows once on the next start (within a week). Which reminders have fired is remembered per device in `localStorage`.
- Two devices that are offline and both open the same day's daily note each create one; they appear as two notes with the same title.
- `probe/<device>` objects on the Store hold the clock value used to learn the Store's time offset and are never deleted.
- The simulation test runs four random seeds (the issue asked for forty) to keep the suite fast; run it with more seeds before a release that changes the merge or compaction code.
- S3 and WebDAV stores are only exercised by the browser/device end-to-end run against MinIO, not by unit tests.

- The first `Join` of a very large vault downloads every commit; there is no progressive/lazy sync.
- `overlays/` and `gc/` are announced through the inbox, but a full reconcile lists them (on "Sync now (full check)" and when this device was offline for 25+ days).
- Two devices compacting the same note at the same instant is covered by reasoning and by the simulation only sequentially.

## Records (ADR 0011)

- `core/src/record.ts` is the pure part: folder and frame names, `record.json`, the `[m:ss]` transcript text, the frame
  difference, and the WebM reader/writer. MediaRecorder writes a WebM with no size on the Segment or the Clusters and no
  Duration; `parseWebm` reads that (and a file cut off at the end), `joinWebm` re-emits the same packets with a Duration and
  sized elements, `sliceWebm` cuts a playable piece that starts at zero (what a transcription request is sent).
- One MediaRecorder runs for the whole recording, so there is no gap; `record/run.ts` only writes the bytes it has
  produced as `audio-00N.webm` every 10 minutes, and joins them on stop. Frames are drawn from a hidden `<video>` of the
  share, compared as 160x90 gray pictures and dropped when under 0.3 % of the pixels differ from the last kept one.
- A record's files are file items like any attachment. `Vault.addFile({ dir })` writes one under an exact name (and
  replaces it when written again); `getRecord` / `listRecords` read a folder; the link index contains the folders so that
  moving a note rewrites its `type_record` links. The Trash follows `followRecords`.
- The player is an editor node view, outside the React providers: it reaches the api through `state/appRef` and the models
  through `record/host.ts` (set by `AppProvider`). Players look again when `notifyRecord` fires.
- The running recording is `record/recorder.ts`, a store outside React (`useRecorder`), so it survives navigation. Its
  panel is `RecorderPanel`; every view's list pane is a `PaneList`, which shows the panel in the list's place. `Shell`'s
  `RecordingDock` looks at whether the panel or the list's bar is really visible (the layout may hide the list) and
  shows a floating bar when not.
- `FrameImg` (the player) keeps the picture with the path it was loaded for: the big frame is one instance whose path changes
  with the playback. The Filter dialog works on the record it was opened with (the player reloads the record behind it,
  and each reload is a new object); `distinctFlags` and `recommendCuts` both walk from the latest frame to the earliest so
  that of frames that look alike the latest stays. The person's own frames are not sent to the model.
- `RecordRun` (`record/run.ts`) keeps a meeting going when only its microphone ends (a notice, `heard` becomes `shared`);
  when the share ends, or a recording's microphone ends, it stops and keeps what it has. If the WebM pieces cannot be
  joined they stay as `audio-00N.webm` and the player and the transcript read them in order. `record.json` is written
  at the start, with each kept frame, with each part and at the end.
- A folder whose `record.json` says `recording` is live only while `recorder` is recording into that folder; otherwise the
  player says it is incomplete. The note's privacy is read again when a recording stops, before anything is transcribed.
- The desktop app answers its own close request (`onCloseRequested`, capability `core:window:allow-destroy`) while a
  recording runs; a browser tab uses `beforeunload`.
- Test: `packages/app/e2e/audio.mjs` (fake microphone, a canvas as the shared screen whose slide changes every 2.5 s; it ends
  the microphone track on purpose, makes a note private mid-recording, and reloads the record behind the Filter dialog).

## Start at once, tabs, Open with, Scratchpad, Habits, Word, VS Code (2026-10-17)

- **No password** (ADR 0012): `vault.json` with `kdf: { alg: 'none' }` holds the master key; `Vault.open` opens such a vault by itself
  and `Vault.createVault('', { noPassword: true })` makes one, only when the host says `passwordOptional` (the installed apps do, the server
  peer and the browser build do not). `changePassword('', pw)` sets a first password and keeps the key on the device as the sign-in's
  "keep unlocked" does; `removePassword` and `leaveVault` (a password-less vault with no Store, to join another one) are the ways back.
  `App.tsx` makes the vault on the first launch unless `ergo.join` says the person chose to join one. Argon2 runs in a worker
  (`backend/argon2.ts`, `setArgon2Runner` in the core).
- **Reading the folder after opening**: with `backgroundScan` the first `scanNow` runs after `activate`, and `status().scan` carries
  `{ done, total }` for the pill in `Shell`. Without it (tests, the server) opening waits for the scan as before.
- **Loader**: `components/curves.ts` has the five formulas (tested to stay in the box and close), `CurveLoader` draws the trail on a
  canvas, `public/splash.js` is the same rose before the bundle arrives (a separate file: the installed app's CSP allows scripts from itself only).
- **Tabs**: `state/tabs.ts` is a store (localStorage `ergo.tabs`) that follows the address; only `#/notes/<id>` and `#/external?path=` are tabs.
  Commands `tab.close`, `tab.reopen`, `tab.next`, `tab.prev` carry the keys; the web build also has the Alt ones because the browser keeps Ctrl+W/T/Tab.
- **Open with**: the installer registers `.md`, `.markdown`, `.mdown` and `.txt`; `tauri-plugin-single-instance` hands a second start's file to the
  window. `views/External.tsx` runs the note editor on an api of its own (`state/externalApi.ts`, a `Proxy` over the vault api): the head
  (frontmatter), line ends and BOM are put back as read, and a write is refused when the file changed since it was read (`ext_write`
  compares modification times). Links inside an External file are not followed yet (`[[x]]` finds nothing, relative links are plain text).
- **Scratchpad**: `components/ScratchPad.tsx` is `NoteEditor` with `scratch` set and an api of its own (`state/scratchApi.ts`); the draft and the
  files dropped on it are in IndexedDB (`state/scratch.ts`) and only reach the Vault when it is sent.
- **Habits** (ADR 0013, 0014; see the next section for where they live): `core/src/habit.ts` is pure (the day rules, the words, the log lines); `Vault.habits/habit/createHabit/updateHabit/
  checkInHabit/undoCheckIn/setHabitRemark`; the Task parser reads `@done`. `app.habits` is read with the rest at each refresh and again when
  the day changes. The `@` picker (`MentionSuggest`) and the chip for a link to a Habit are in `NoteEditor` and `editor/extensions.tsx`.
- **Word**: `state/exportDocx.ts` walks the clean copy of the note that the PDF uses (`paperBody`) and builds the file with `docx`; SVG and
  `<img>` become PNGs through a canvas. Checked by opening a generated file with pandoc and python-docx.
- **VS Code**: `apps/vscode` (see its README); `render.ts` and `notes.ts` are plain TypeScript with unit tests, the rest is thin VS Code glue,
  exercised by `tools/e2e-vscode.sh`.

## The dashboard, habits in `.habits/`, mood pictures (2026-10-17)

- **A Habit is its own kind of item** (ADR 0014): `_ergo_kind: habit` in the replica, held by the Vault in `habitFiles`, never in `views`, so
  no list, search, tag, task, calendar or backlink of the Notes sees it. The scan reads one hidden folder, `.habits/` at the top, only `*.md` in
  it, and adds no Folder for it. `Vault.habits/habit/habitDays/createHabit/renameHabit/deleteHabit/updateHabit/checkInHabit/undoCheckIn`.
  Two Devices that checked in at once leave two heads; `combineHabitConflicts` (run with the housekeeping after a pull) joins them with
  `unionText`, so nobody is asked. A delete against an edit is still left to the person.
- **A mention** is `[Run](.habits/Run.md "type_habit")`: `TitledLink` (editor/extensions.tsx) keeps the title of a link; the chip, and the click
  that opens `#/habits/<id>`, are found by the path in `NoteEditor`. A rename of a habit follows the links with `followMoves`.
- **The page of a habit** (`HabitPage` in components/Habit.tsx, route `habits` with `habit`): the figures, 12 weeks, rename, delete, the notes that
  mention it. Not a Tab. No place to write a remark: existing remarks are shown read-only.
- **Dashboard** (`state/dashboard.ts`, pure and tested; stored in localStorage `ergo.dashboard`, never in the Vault): widgets with `layouts[n]`
  for 1, 2 and 3 columns, so the order on a phone and in three columns can differ; `columnsFor(width)` picks the layout from the width of
  Home. `views/Home.tsx` draws columns, the edit mode (arrows, drag, S/M/L, remove) and the gallery; `components/widgets.tsx` has the 18
  bodies; `components/charts.tsx` the SVG charts (rings, columns, bars, line, year grid); `state/habitStats.ts` the figures, with tests.
  The habit widgets read `Vault.habitDays(from, to, today)` again when `app.habits` changes.
- **Mood pictures**: `assets/mood/*.svg` (ten of the person's own drawings, colour `currentColor`), `components/Mood.tsx` inlines them,
  `state/mood.ts` says which goes with which nudge.
- **Paste**: the editor's paste and drop listeners are put on once, in the capture phase (`NoteEditor`), because ProseMirror moves the focus to a
  hidden box while it handles a paste, the re-render took the listener off and on again, and the paste that caused it was lost.
  `state/paste.ts` decides what to attach: pictures always, other files only when no text comes with them.
