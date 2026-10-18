---
name: tagging
description: Choose, add, tidy and design tags for notes in the user's Ergonotes vault: reuse existing tags, hierarchical tags like work/acme, tags versus folders versus links, finding untagged notes, merging near-identical tags. Use when the user asks to tag notes, organise by tags, "what tags do I have", fix or merge tags, or design a tag system.
argument-hint: "[note or tag task]"
---

# Tags

A tag is a hierarchical label (`work/acme`) in a note's frontmatter. A note has any number of tags and exactly one folder.
Tags are not written in the text (`#tag` in the body is not a tag).

## The tools

- `list_tags`: every tag in use and how many notes carry it. Always call it first.
- `add_tags`: adds tags to a note; existing tags stay. There is **no tool to remove or rename a tag**: the user does that in the app (rename a tag from its menu). Say so; do not work around it.
- `create_note` with `tags`: set at creation.
- `search_notes` with `tag`: `work` finds `work` and everything under `work/`; use it to see what a tag holds.

## Choosing tags for a note

1. `list_tags`. Pick from what exists. Prefer the most specific tag that already exists (`work/acme`) over a general one, and add the parent only if the user's scheme uses parents.
2. At most **three** tags on a note. More dilutes them.
3. Match the user's scheme: same case (usually lowercase), same language, same separator (`/` for hierarchy), singular or plural as they do. Look at five existing tags before adding a new one.
4. A new tag only when nothing fits and the subject will come up again; tell the user it is new.
5. Never create a tag that differs from an existing one only by case, plural, accent or spelling.

## Tags, folders, links: which is which

| Question | Use |
| --- | --- |
| Where does this note live? (one place) | **folder** (PARA: Projects, Areas, Resources, Archive) |
| What is it about / what kind of note is it? (many) | **tags** |
| What is it related to, specifically? | **links** between notes |

Tags describe, folders place, links connect. If a tag would hold a single note, make a link or nothing instead.

## A useful scheme (propose; the user decides)

- Subject: `work/acme`, `health/sleep`, `finance/tax`
- Kind: `meeting`, `idea`, `reference`, `how-to`
- Status, sparingly: `waiting`, `someday`

Keep the tree two levels deep.

## Jobs

**Tag these notes.** Read each note, choose per the rules, `add_tags`. Report a table: note, tags added, any new tag.

**Find untagged notes.** `search_notes` by folder and look for notes with `tags: []`; show them, propose tags, apply after approval. For the whole vault use the `maintain` skill.

**Tidy near-identical tags** (`Meeting`, `meeting`, `meetings`). Show them with counts, propose the one to keep (the most used, in the user's scheme). `add_tags` the keeper to the notes that carry the others, then tell the user to remove or rename the old tag in the app, because you cannot.

**Design a system.** Ask what they use notes for; look at `list_tags` and the folders; propose a small scheme with examples drawn from their notes; do not apply it without approval.

## Do not

- Do not mass-tag the vault in one go; work in batches the user has seen.
- Do not tag private notes (you cannot see them) or put tags into the body text.
- Do not use tags as a to-do state; tasks have due dates.
