# The desktop app serves an MCP endpoint on localhost, and agents may draw

ADR 0008 gave agents the note tools through the Server peer's MCP endpoint. Almost everyone who wants an agent (Claude Code)
on their notes has the Windows or Linux app, not a Server peer: the vault is a folder on that computer and the app already
holds it unlocked. Asking those people to run a Linux server for it was the wrong cost. This ADR puts the endpoint in the
desktop app, adds a Claude Code plugin that finds it by itself, and lets agents draw.

## Decision

- **The desktop apps (Windows, Linux) listen, the phone does not.** While the app runs it serves MCP at
  `http://127.0.0.1:7424/mcp` by default. It is on by default; Settings → Agents (MCP) turns it off and changes the port and
  the path. A port that is taken shows as a red dot on the Settings gear and in the tray menu, not as silence.
  "Also allow other devices on my network" (off by default) listens on every interface, with a warning that the traffic is
  plain HTTP.
- **The shell listens, the webview answers.** The note logic, the unlocked vault and its private-note rule live in the
  TypeScript core in the webview (ADR 0007). The Rust shell (`apps/desktop/src-tauri/src/mcp.rs`) does only what must not
  depend on it: accept the connection, check Host, Origin and the token, and pass the JSON-RPC message to the webview, which
  runs the same `handleRpc` as the Server peer (`packages/core/src/ai/mcp.ts`) and answers. One process writes to the vault,
  so there is no second writer to reconcile with the app. A vault with a password answers "locked" until it is unlocked in
  the window.
- **Tokens.** A request needs `Authorization: Bearer <token>` even on localhost, because a web page in the person's browser
  can reach `127.0.0.1` (the Host and Origin checks refuse it too, as the MCP transport rules require). The app makes a
  default token the first time (the one the plugin uses; revoking it makes a new one); the person adds tokens, types in one of their own, regenerates or revokes them in Settings.
  They are kept beside the app's settings (`desktop.json`, created readable only by the user on Linux; on Windows it relies on the profile folder's own permissions), never in the vault folder, and are
  not synced. The same folder holds `mcp-endpoint.json` (the url and the default token, user-only) which the Claude Code
  plugin reads, so nothing has to be copied by hand.
- **Tray and start with the system.** Closing the window hides it to the tray and the endpoint keeps running (a setting, on
  by default; off when the system has no tray, so the window can never be lost). "Start Ergonotes when I sign in" is a
  separate switch, off by default, and starts hidden. Quit is in the tray menu.
- **The plugin and its skills** are in `plugins/ergonotes/`: the MCP address, skills for writing, capturing, planning,
  triage, meetings, questions, review, upkeep, elements, tags, attachments and drawing, and two hooks. The skills'
  conventions are also the endpoint's `instructions` and the resource `ergonotes://guide`, so an agent without the plugin
  still gets them. The plugin guards `.ergonotes/`, `.trash/` and `.habits/` against direct file writes; the vault stays a
  folder that any tool may edit (ADR 0010).
- **Agents may draw (amends ADR 0009's "Diagram: a mermaid fence" and the note in docs/implementation-notes.md that the assistant draws Mermaid only, and only in the app).** The desktop endpoint adds tools that need a browser:
  `draw` (nodes, links and zones in; layout, bound text and arrows out, with a picture of the result), `insert_diagram`
  (Mermaid), `read_drawing`, `search_libraries`, `browse_library` and `import_library_item` (a shape of a public
  Excalidraw library, `libraries.excalidraw.com`, MIT). A drawing is still an `ergonote-excalidraw` block that the person
  edits like any other. The scene's `source` records the library and its authors when one is used. Fetching a library is the
  only request these tools make; no note text is sent.
- **Drawings stay offline.** Excalidraw's fonts are copied into the app (`excalidraw-assets/`; the 13 MB CJK fallback is
  left out) instead of being loaded from a CDN, and Mermaid is pinned to 11.12.1, the newest version found to convert
  class, ER and state diagrams into editable shapes (11.17.2 turned them into a picture).

## Consequences

- The endpoint exists only while the app runs. With the tray that is "while logged in"; without it, while the window is open.
- A token is stored in plain text in a user-only file: anyone who can read the user's files can already read the notes
  (ADR 0010), so nothing new is exposed, but the file must not be put in a backup that is shared.
- Private notes and Habits (`.habits/`, private to AI by default) do not exist for the endpoint, as for the Server peer. A
  hook cannot make an agent that has file access ignore the files; the guarantee is complete only for what goes through MCP.
- The Server peer keeps its own HTTP endpoint and tokens; both share the protocol code.
- A starting app that was started hidden shows its window for an instant before hiding it.
- A Private note is hidden from every tool, but its file name still takes part in naming: `create_note` with the title of a
  private note gets "Title 2", and `daily_note` for a day whose daily note is private answers "Note not found" where other days
  answer with a note. An agent could infer that a private note exists, not what it says. Closing that would need titles that do
  not collide with hidden notes, which ADR 0010 (title = file name) does not allow.
- The Server peer's endpoint has no Host allowlist (it is meant to be reached by any name); the token is what protects it. The
  desktop endpoint has one unless "other devices on my network" is on.
- The guard hook is a rail, not a lock: it stops a tool or a shell command that names a hidden folder or the file of a private
  note, but `Grep` over the whole vault, or a shell that builds the path with a wildcard, gets through. Only what goes through MCP
  is guaranteed.
- `read_note` used to list a private note's title among a note's backlinks, and the tag list counted tags of private notes;
  both were fixed with this change.
