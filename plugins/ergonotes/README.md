# Ergonotes for Claude Code

Open Claude Code and it can read and write your Ergonotes notes: search them, extend them, tag them, plan your day from them,
and draw diagrams in them, in your language, following the conventions of your vault.

## Install

You need the **Ergonotes desktop app** (Windows or Linux) and **Node.js 18 or newer** (the plugin's small connector runs on it).

```
claude plugin marketplace add harrymadison297/Ergonotes
claude plugin install ergonotes@ergonotes
```

Start Ergonotes, then Claude Code. Nothing else to configure: the app writes the address and a token to a file only you can
read, and the plugin reads it. If Ergonotes is started after Claude Code, the tools appear by themselves a few seconds later.

## What you get

| | |
| --- | --- |
| **MCP tools** | `search_notes`, `read_note`, `create_note`, `append_to_note`, `replace_text`, `insert_after_heading`, `add_tags`, `move_note`, `list_tags`, `get_links`, `list_tasks`, `daily_note`, and on the desktop `draw`, `browse_library`, `import_library_item`… |
| **Skills** | `using-ergonotes`, `writing`, `capture`, `daily`, `tasks`, `ask`, `review`, `meeting`, `elements`, `tagging`, `attachments`, `drawing`; and `triage` and `maintain`, which you start yourself (`/ergonotes:triage`) because they change many notes |
| **Session hook** | tells Claude whether Ergonotes is reachable, how many notes wait in the Inbox and which tags exist |
| **Guard hook** | stops Claude writing into `.ergonotes/`, `.trash/` and `.habits/`, and reading `.habits/` or notes marked private, when it works on the vault's files directly |

Slash commands: `/ergonotes:writing`, `/ergonotes:capture`, `/ergonotes:daily`, `/ergonotes:tasks`, `/ergonotes:ask`,
`/ergonotes:review`, `/ergonotes:meeting`, `/ergonotes:triage`, `/ergonotes:maintain`, `/ergonotes:drawing`, and so on.

## What Claude will not do

- Delete a note (there is no delete tool).
- See notes you marked **private**, or your Habits.
- Change anything in a bulk job (`triage`, `maintain`) before you approve a plan.

## How it finds Ergonotes

The app keeps `mcp-endpoint.json` next to its settings:

| System | Folder |
| --- | --- |
| Linux | `$XDG_CONFIG_HOME/app.ergonotes.notes/` (usually `~/.config/app.ergonotes.notes/`) |
| Windows | `%APPDATA%\app.ergonotes.notes\` |
| macOS | `~/Library/Application Support/app.ergonotes.notes/` |

To point at something else, set `ERGONOTES_MCP_URL` and `ERGONOTES_MCP_TOKEN` (or `ERGONOTES_MCP_FILE` to another endpoint file) before
starting Claude Code. A port or token you change in *Settings → Agents (MCP)* is picked up without restarting Claude Code.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| no Ergonotes tools, or "Ergonotes is not running" | open the desktop app; check *Settings → Agents (MCP)* is switched on and shows a green dot |
| a red dot on the Settings gear | the port is used by another program: choose another port in *Settings → Agents (MCP)* |
| "the vault is locked" | the vault has a password: unlock it in the Ergonotes window |
| "refused the token" | the token was changed or revoked: the plugin re-reads the file on the next call; if it persists restart Claude Code |
| `node: command not found` | install Node.js 18 or newer |

## Privacy

Everything goes between Claude Code and the Ergonotes app on your computer. The model that Claude Code uses sees what you ask it
to read. Library shapes for drawings are the only thing fetched from the internet (libraries.excalidraw.com); no note text is sent
there.

Licence: Apache-2.0.
