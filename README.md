# Ergonotes

Offline-first personal notes that sync between your devices through storage you own, with no always-on server.
PARA folders + Inbox + Zettelkasten links, Evernote-style editor, tasks and calendar, Excalidraw drawings,
Markdown/HTML/PDF export, and an MCP endpoint for AI agents.

| | |
|---|---|
| **Android, Windows, Linux** | Tauri 2 apps. Notes live on the device first; sync is optional. |
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

Open the page, choose a password (12+ characters, **it cannot be recovered**) and write.
To sync devices: *Settings → Sync & storage*, enter an S3/WebDAV location, then on the other device choose
*Join existing* with the same location and password.

## Server peer (Linux)

```sh
tools/bundle-server.sh                 # dist/server/server.mjs + web build
node dist/server/server.mjs            # PORT, HOST, ERGONOTES_DATA, ERGONOTES_WEB
```

* Serves HTTPS-only (or localhost: a connection from this machine). Put it behind Caddy/nginx for TLS and set
  `ERGONOTES_TRUST_PROXY=1` so the secure cookie and the sign-in rate limit use the proxy's view of the client; or set
  `ERGONOTES_ALLOW_INSECURE=1` on a trusted LAN (plain HTTP: the password crosses the network in clear).
* On a server reachable by strangers set `ERGONOTES_SETUP_TOKEN` before first run, or the first visitor can claim it.
* Folder storage chosen in the web UI has to be inside the data directory unless `ERGONOTES_FOLDER_STORE_ROOT` says otherwise.
* The vault is unlocked at the first sign-in and the key stays in memory. `ERGONOTES_PASSWORD` unlocks at start-up
  (unattended restarts) at the cost of keeping the password in the environment.
* A plain-Markdown mirror of every note is written to `$ERGONOTES_DATA/markdown`.
* Agents: *Settings → Agents (MCP)* creates a token and shows the command for Claude Code; point any MCP client at
  `https://your-host/mcp` with `Authorization: Bearer <token>`. Tools: `search_notes`, `list_recent`, `read_note`,
  `create_note`, `append_to_note`, `replace_text`, `insert_after_heading`, `update_note`, `rename_note`, `add_tags`,
  `move_note`, `list_folders`, `list_tasks`, `complete_task`, `daily_note`. Notes marked private are invisible to agents.
  The skill that teaches Claude Code to use them is `docs/agents/ergonotes-skill/SKILL.md` (also a download button).
* Assistant: *Settings → AI* takes an OpenRouter or Anthropic API key, or the address of your own OpenAI-compatible
  server such as Ollama (`http://localhost:11434`; key optional). Keys are stored encrypted in the vault. On the server the
  key stays on the server and the browser streams through `/api/ai/stream`. The right sidebar holds the note's contents
  and the assistant (history, `@` to attach notes and files, Ask/Edit mode, its thinking shown, thinking level per job). See ADR 0008.

## Building the apps

The toolchain (Node, Rust + Windows/Android targets, JDK, Android SDK/NDK, NSIS) is a Docker image:

```sh
docker build -t ergonotes-builder tools/builder     # once, ~16 GB
tools/release.sh                                    # Windows installer, Linux .deb, server bundle -> dist/release
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
