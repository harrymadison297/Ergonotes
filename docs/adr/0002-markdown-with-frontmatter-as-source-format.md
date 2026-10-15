# Notes are Markdown with frontmatter; extensions are `ergonote-*` fenced blocks

> The flat `id`/`parent` layout it describes was replaced by ADR 0010: the file is named after the note and lives in its folder, `id` stays in the frontmatter, and the `ergonote-*` fence rule still holds.

A Note is stored as a Markdown file with YAML frontmatter (`id`, `tags`, `parent`, `template`...). Anything Markdown cannot express (Excalidraw, future block kinds) is a fenced block tagged `ergonote-<kind>`, and blocks of unknown kind must round-trip unchanged so an older app never damages data written by a newer one. We chose this over a block-JSON document so notes stay readable by any editor and by AI agents, at the cost of limiting v1 to blocks that have a Markdown form (no databases, Kanban, columns, web embeds or formulas).
