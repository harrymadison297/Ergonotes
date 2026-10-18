---
name: triage
description: Sort the Inbox of the user's Ergonotes vault into PARA folders with tags and links, after showing a plan and getting approval. Only on request: "triage my inbox", "sort my notes", "file these". Never deletes.
disable-model-invocation: true
argument-hint: "[optional: how many notes, or a folder instead of the Inbox]"
---

# Triage the Inbox

Triage turns captures into a organised vault: the right folder, the right tags, links to what they relate to. It changes
many notes, so it has two phases and **nothing is changed before the user approves the plan**.

## Phase 1: read and plan

1. `list_folders`. Find the Inbox and the PARA folders (Projects, Areas, Resources, Archive) with their subfolders. Note the folder ids.
2. `search_notes` with `folder` = the Inbox id (no query) to list the captures; add `limit: 50` and page by `until`/`since` when there are more. Work in batches of at most 20.
3. For each note `read_note`. Understand it: what it is, what it is about, whether it holds tasks.
4. `list_tags` once. Prefer existing tags.
5. For each note, find 1 to 3 related notes (`search_notes` on its key terms, then `read_note`/`get_links` on the best match) and any near-duplicate.

Decide per note, using PARA:

| It is | Folder |
| --- | --- |
| part of something with an end and a next action | **Projects** (a subfolder per project when one exists) |
| an ongoing responsibility (health, finances, a team) | **Areas** |
| a topic of interest, reference material, a how-to | **Resources** |
| finished, inactive, or no longer relevant | **Archive** |
| unclear, personal journal, half-formed | **stays in the Inbox** (do not force it) |

## The plan

Show one table, and nothing else is done yet:

| # | Note (title) | Move to | Add tags | Link to | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Meeting with Acme | Projects / Acme | work/acme, meeting | [Acme brief] | has 2 tasks |
| 2 | Idea: weekly review | Resources | productivity | | possible duplicate of [Weekly review] |

Under it: counts (to move, staying in the Inbox), and every case where you are unsure, as a question. Then **stop and wait**.
The user can approve all, edit rows, or skip some.

## Phase 2: apply (only what was approved)

For each approved row, in this order, and read each note again just before changing it:

1. `add_tags` (tags that exist, or ones the user approved).
2. Links: `append_to_note` a short line `Related: [Title](relative/path/Note.md)`, or put the link where it fits using `replace_text`. Link both ways only if the user asked.
3. `move_note` with the folder id last, so relative links you wrote are computed from the final place (the app rewrites links when notes move, but check).
4. A duplicate: do not delete or merge. Add a link between the two notes and report it for the user to decide.

## Report

- What moved where (count and a short list), what was tagged, what stays and why, open questions.
- Anything you could not do.

## Do not

- Never delete, and never overwrite a note's content. Triage changes place, tags and links.
- Do not create folders or rename notes unless the user asked in the plan stage.
- Do not touch notes outside the batch.
- Do not tag with a new tag without showing it in the plan.
