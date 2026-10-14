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

* Serves HTTPS-only (or localhost); put it behind Caddy/nginx for TLS, or set `ERGONOTES_ALLOW_INSECURE=1` on a trusted LAN.
* The vault is unlocked at the first sign-in and the key stays in memory. `ERGONOTES_PASSWORD` unlocks at start-up
  (unattended restarts) at the cost of keeping the password in the environment.
* A plain-Markdown mirror of every note is written to `$ERGONOTES_DATA/markdown`.
* Agents: *Settings → AI & agents* creates a token; point an MCP client at `https://your-host/mcp` with
  `Authorization: Bearer <token>`. Tools: `search_notes`, `list_recent`, `read_note`, `create_note`, `append_to_note`,
  `update_note`, `list_folders`, `list_tasks`, `complete_task`, `daily_note`. See `docs/agents/ergonotes-skill/SKILL.md`.

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
tools/n npm test                      # core (merge, sync simulation, vault) + server + MCP
tools/n npm run typecheck
# end-to-end in real browsers / VMs: packages/app/e2e (smoke.mjs, sync.mjs, device.mjs)
```

`packages/core` has no UI or platform code: graph, merge, replica/sync, crypto and the Vault API.
`packages/app` is the React UI; `apps/server` the server peer; `apps/desktop` the Tauri shell.

## Design

`CONTEXT.md` is the glossary; `docs/adr/` records the decisions (per-note commit graph instead of CRDT, Markdown
source format, passive Store, password-wrapped master key, ...). `docs/issues/` holds the milestone breakdown.
`docs/implementation-notes.md` lists where the implementation deviates from the ADRs and what is not done yet.
