# The vault is a folder of Markdown files; the database is derived

Supersedes the storage parts of ADR 0002 (flat UUID files, `parent` field) and ADR 0005 (flat UUID layout). ADR 0001 (commit graph) and ADR 0003 (passive Store sync) stand, but the graph is now a derived layer.

A Vault is a directory. The `.md` files in it, in the folders they are in, **are** the notes: a person can drop a pile of Markdown into the folder and it works, edit it with any other editor, and delete the app without losing anything. Everything the app needs that a Markdown file cannot hold lives in `.ergonotes/` inside the same folder: the commit graph (history, merge base, sync), assistant conversations, AI settings with their API keys, sync state and the file index. `.ergonotes/` is sealed with the vault password (ADR 0004) — its `vault.json` is the wrapped key, so the folder alone can be opened on another computer with the password — while the notes are plain text on disk by design. What belongs to one Device (its id, the remembered key, the Store's credentials, the index of the folder) is kept outside the folder, with the app's own settings. Removing `.ergonotes/` loses history and conversations, never a note.

## Rules

- **Identity.** A note carries `id:` in its frontmatter, added the first time the app writes the file. Until then the app knows it by path and content hash. A second file with an id already in use gets a new id.
- **Title is the file name.** Renaming a note renames the file; moving a note moves the file. Names are made safe for Windows and made unique with a number suffix.
- **Properties are frontmatter.** `tags`, `pinned`, `private`, `template`, `daily`, `created`, `updated`. Tags in the body are not a thing. Other keys are kept as written; only the key being changed is edited, so order and YAML comments survive.
- **Links are standard Markdown.** The app writes `[Title](relative/path.md)` and reads `[[Title]]` and `[[path/Title]]` without rewriting them. Renaming or moving a note rewrites the links that point at it, replacing only the destination (and the label when it equalled the old title).
- **Attachments are files** under `attachments/` embedded with `![alt](attachments/x.png)` and `[label](attachments/x.webm "audio")`.
- **Trash is `.trash/`**, remembering the original path in the database; an externally deleted file is treated as deleted and can be restored from its history.
- **What the app does not understand is kept byte for byte.** On save, every top-level block the person did not edit is written back exactly as it was read (`![[x]]`, `%%…%%`, `^id`, HTML, callouts, Dataview and Canvas blocks, odd list markers, hard-wrapped paragraphs). Unknown inline syntax inside an edited block is a raw atom that is written back unchanged. Line endings and a byte order mark are preserved.
- **Ergonotes' own syntax stays standard where it can.** Toggle is `<details><summary>`, page break is `<div style="page-break-after: always;"></div>`, a drawing is a ```` ```ergonote-excalidraw ```` fence, due dates and events are readable `@due(...)` / `@event(...)` text, formulas are `$…$`, tasks are `- [ ]`. The table of contents is not stored: the app computes it from the headings when it is opened.
- **Two directions.** A change on disk (found by an incremental scan: size and mtime first, hash when they differ) becomes a Commit; a Commit that arrives from another Device is merged and written to the file. The app's own writes are recorded in the index so they are not read back as edits.
- **Size.** The design target is thousands of files. A folder with many more is scanned in slices with a visible warning, and attachments over the sync limit are listed but not read into the database.

## Consequences

- Sync across Devices keeps using the encrypted Store; there is no second sync tool and none is supported.
- A note's database text is its file text plus reserved `_ergo_*` keys (path, trashed state, line ending); those are never written to the file.
- Folders are directories. An empty folder exists only on the disk where it was made.
- Every previous vault layout is gone: nothing had been deployed, so there is no migration.
