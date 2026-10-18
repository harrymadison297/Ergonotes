# Errors and what to do

| Message | Meaning | Do |
| --- | --- | --- |
| `The vault is locked. Unlock it in Ergonotes first.` | the vault has a password and nobody has unlocked it in the window | ask the user to unlock; try again after |
| `Note not found` | wrong id, deleted, in the Trash, or **private** | search again; do not try to get around it |
| `That text was not found in the note` | `replace_text` `find` does not appear | `read_note` again and copy the passage exactly, whitespace included |
| `That text appears N times` | `find` is not unique | include more surrounding text |
| `No heading "X". Headings in this note: …` | `insert_after_heading` or `read_note` heading is wrong | use one of the listed headings |
| `Missing argument "x"` / `Unknown argument "x"` / `Argument "x" must be …` | a call with the wrong shape | fix the call; the message lists what is accepted |
| `Unknown tool …` | the tool does not exist (for example a delete tool) | there is no such tool; do not look for another way |
| Ergonotes is not running / no tools at all | the desktop app is closed or the endpoint is off | ask the user to open the app (Settings → Agents (MCP)) |
| `Ergonotes refused the token` | the token was changed or revoked | ask the user to check Settings → Agents (MCP) |
