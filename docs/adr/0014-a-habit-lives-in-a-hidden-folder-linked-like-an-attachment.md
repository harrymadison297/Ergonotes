# A habit lives in the hidden `.habits/` folder, is linked like an attachment and syncs like a note

ADR 0013 stands except where it says a Habit is a Note in `Habits/`. ADR 0010 (the vault is a folder of Markdown) and ADR 0002 (Markdown with frontmatter) stand.

A Habit shown as a Note leaked into the Notes list, the Folder tree, Tags, Search, the Tasks page and the Calendar, where it is not wanted: a Habit is a thing with its own figures, and everything about it is to be read in one place. The two obvious ways out were both worse. A real attachment is synced as a blob, so two Devices that check in on the same day overwrite each other and one Check-in is lost. Keeping a visible Note and hiding it with filters would put a filter in every list, and the next list would forget it.

## Decision

- A Habit is a Markdown file in `.habits/` at the root of the Vault, with the frontmatter and `## Log` of ADR 0013. The folder is hidden by its dot; the person never has to open it.
- The Vault scan skips dot-folders; `.habits/` is the one exception and is read, committed, merged and synced like the Notes. Nothing else under a dot-folder changes.
- A Habit is not a Note: no Notes list, Folder tree, Tags, Search, Tasks or Calendar entry. Only the Habits page opens it, at `#/habits/<id>`, as a page of its own and not a Tab.
- A Note mentions a Habit with a typed link, `[Run](.habits/Run.md "type_habit")`, as a Record is linked with `type_record`. It is still a Backlink, and the editor draws it as a chip.
- A Habit is private to AI by default: it is not in an Assistant prompt and does not exist for MCP agents.
- There is no step that moves `Habits/` to `.habits/`: the code is unreleased and the person updates every Device together.

## Consequences

- Two Devices that check in on the same day still add two lines and the Merge keeps both; this is why a Habit is not a real attachment.
- A tool that reads the Vault folder must look in `.habits/`; the VS Code extension and its end-to-end workspace move with it.
- A Habit opened in VS Code or Obsidian is still a readable Markdown file; text outside `## Log` is kept exactly as written.
- Anything that lists Notes needs no change, because a Habit is not one.
