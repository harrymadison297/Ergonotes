# Ergonotes

Offline-first personal notes that sync between your devices through storage you own, with no always-on server.
PARA folders + Inbox + Zettelkasten links, Evernote-style editor, tasks and calendar, Excalidraw drawings,
Markdown/HTML/PDF export, and an MCP endpoint for AI agents. **Your notes are plain Markdown files in a folder you
choose**, like an Obsidian vault: put a pile of `.md` files there and they are notes; edit them with any other program
and Ergonotes follows; what it does not understand is never rewritten (docs/adr/0010). The Insert menu puts toggles,
page breaks, dates, events, formulas, Mermaid diagrams, recordings and meetings into a note, and every one of
them is stored as standard Markdown (docs/adr/0009). A meeting is the audio of a call, pictures of the shared screen
and a transcript, kept in one folder and played with the pictures marked on the timeline (docs/adr/0011).

![Ergonotes on Windows and Android](docs/media/hero.png)

## What is in it

| | |
|---|---|
| **Start at once** | A new install on Windows, Linux or Android makes a vault in your Documents folder and shows Home straight away, with no set-up screen and no password until you want one (docs/adr/0012). A running curve shows while the app starts and while a big folder is read. |
| **Scratchpad** | A very pale blue note on Home that is not a note yet: it uses the note editor with only an Insert button, keeps its draft on the device, takes dropped or pasted pictures and files, and becomes a note in the Inbox when you send it. |
| **Habits** | A habit is a file in the hidden `.habits/` folder with a target such as twice in three days; it is not a note and has a page of its own (docs/adr/0014). Check in when you do it; the streak, the misses, the 7, 30 and 90 day rates, a 12 week heat map and the messages, each with a hand-drawn face, are worked out, never stored (docs/adr/0013). Mention a habit in any note with `@`. |
| **Home** | A dashboard of widgets you arrange on each device (never synced): notes, scratch pad, tasks due, reminders, events, files, tags, and habit widgets with a ring on each day, the month's rate against last month, check-ins per habit, streaks and a year heat map, plus charts of notes edited and tasks done. |
| **Calendar** | Each day shows counts: tasks done and open, reminders, notes, events. |
| **Tabs and Open with** | Notes open in tabs (Ctrl+click, Ctrl+W, Ctrl+Shift+T). Right click a Markdown file anywhere, *Open with Ergonotes*: it is edited in place and nothing is added to it. |
| **Export** | Markdown, HTML, PDF and Word (`.docx`, made in the app). |
| **VS Code** | `apps/vscode` is an extension to read and edit the same files in VS Code: syntax, a preview, links, snippets and habit check-ins. |

<table>
<tr><td><img src="docs/media/habits.png" alt="Habits"></td><td><img src="docs/media/calendar.png" alt="Calendar"></td></tr>
<tr><td><img src="docs/media/scratchpad.png" alt="Scratchpad"></td><td><img src="docs/media/export.png" alt="Export to Word"></td></tr>
<tr><td><img src="docs/media/vscode.png" alt="VS Code"></td><td><img src="docs/media/tabs.png" alt="Tabs and Open with"></td></tr>
<tr><td colspan="2"><img src="docs/media/start.png" alt="Start at once, with a curve loader"></td></tr>
</table>

The raw screenshots (real Windows and Android apps, light and dark) are in [docs/media/screens](docs/media/screens).

![Habit check-ins](docs/media/habit-flow.gif)

| | |
|---|---|
| **Android, Windows, Linux** | Tauri 2 apps. Notes are files in a folder on the device (default `Documents/Ergonotes`, changed in Settings or from the first-run note); sync is optional. |
| **Web** | The same UI served by the optional Linux *server peer* (no offline mode). |
| **Sync** | End-to-end encrypted objects in an S3-compatible bucket, WebDAV share, or plain folder. |
| **Agents** | MCP over HTTP on the server peer, with revocable API tokens. |
| **Assistant** | Optional chat that answers, writes, edits and draws in your notes, and a next-words suggestion. Bring your own OpenRouter or Anthropic key; off until you add one; notes marked private are never sent. |

## Quick start

```sh
# one machine, web UI on http://localhost:8080
npm install
npm -w @ergonotes/app run build
ERGONOTES_DATA=./data node apps/server/src/main.ts
```

No Node on the host? `tools/n <command>` runs any command in a Node container.

Open the page, choose a password (12+ characters, **it cannot be recovered**) and write. (The desktop and Android apps need no password to start; *Settings → Security* adds one.) The notes are Markdown files in
`./data/vault` (set `ERGONOTES_VAULT_DIR` to use a folder you already have).
To sync devices: *Settings → Sync & storage*, enter an S3/WebDAV location, then on the other device choose
*Join existing* with the same location and password.

## Server peer (Linux)

```sh
tools/bundle-server.sh                 # dist/server/server.mjs + web build
node dist/server/server.mjs            # PORT, HOST, ERGONOTES_DATA, ERGONOTES_VAULT_DIR, ERGONOTES_WEB
```

* Serves HTTPS-only (or localhost: a connection from this machine). Put it behind Caddy/nginx for TLS and set
  `ERGONOTES_TRUST_PROXY=1` so the secure cookie and the sign-in rate limit use the proxy's view of the client; or set
  `ERGONOTES_ALLOW_INSECURE=1` on a trusted LAN (plain HTTP: the password crosses the network in clear).
* On a server reachable by strangers set `ERGONOTES_SETUP_TOKEN` before first run, or the first visitor can claim it.
* Folder storage chosen in the web UI has to be inside the data directory unless `ERGONOTES_FOLDER_STORE_ROOT` says otherwise.
* The vault is unlocked at the first sign-in and the key stays in memory. `ERGONOTES_PASSWORD` unlocks at start-up
  (unattended restarts) at the cost of keeping the password in the environment.
* The vault is a folder of Markdown files, `$ERGONOTES_VAULT_DIR` (default `$ERGONOTES_DATA/vault`): put files there and they are notes; edit them with any other program and the app picks the change up within seconds.
* Agents: *Settings → Agents (MCP)* creates a token and shows the command for Claude Code; point any MCP client at
  `https://your-host/mcp` with `Authorization: Bearer <token>`. Tools: `search_notes`, `list_recent`, `read_note`,
  `create_note`, `append_to_note`, `replace_text`, `insert_after_heading`, `update_note`, `rename_note`, `add_tags`,
  `move_note`, `list_folders`, `list_tasks`, `complete_task`, `daily_note`. Notes marked private are invisible to agents.
  The skill that teaches Claude Code to use them is `docs/agents/ergonotes-skill/SKILL.md` (also a download button).
* Assistant: *Settings → AI* holds any number of connections: OpenRouter or Anthropic keys, or the address of your own
  OpenAI-compatible server such as Ollama (`http://localhost:11434`; key optional). Pick the chat model (also from the
  chat) and a separate suggestion model, each on any connection. Keys are stored encrypted in the vault. On the server the
  key stays on the server and the browser streams through `/api/ai/stream`. The right sidebar holds the note's contents
  and the assistant (history, `@` to attach notes and files, Ask/Edit mode, its thinking shown, thinking level per job). See ADR 0008.

## Building the apps

The toolchain (Node, Rust + Windows/Android targets, JDK, Android SDK/NDK, NSIS) is a Docker image:

```sh
docker build -t ergonotes-builder tools/builder     # once, ~16 GB
tools/release.sh                                    # Windows installer, Linux .deb, server bundle, VS Code extension -> dist/release
tools/build-android.sh                              # signed release APK -> dist/release
```

Android releases are signed with `KEYSTORE`/`KEYSTORE_PASS`/`KEY_ALIAS` when set, otherwise with a throw-away key.

## Develop & test

```sh
tools/n npm test                      # core (merge, sync simulation, vault, AI) + server + MCP
OPENROUTER_API_KEY=… tools/n npx vitest run packages/core/test/ai-live.test.ts   # optional: the real provider
tools/n npm run typecheck
# end-to-end in real browsers / VMs: packages/app/e2e (smoke.mjs, sync.mjs, device.mjs)
```

`packages/core` has no UI or platform code: graph, merge, replica/sync, crypto and the Vault API.
`packages/app` is the React UI; `apps/server` the server peer; `apps/desktop` the Tauri shell.

## Design

`CONTEXT.md` is the glossary; `docs/adr/` records the decisions (per-note commit graph instead of CRDT, Markdown
source format, passive Store, password-wrapped master key, ...). `docs/issues/` holds the milestone breakdown.
`docs/implementation-notes.md` lists where the implementation deviates from the ADRs and what is not done yet.

## Brand and UI

Colours, type, components and voice are in [docs/brand-guidelines.md](docs/brand-guidelines.md); the CSS tokens that implement them are in `packages/app/src/styles/tokens.css`.
