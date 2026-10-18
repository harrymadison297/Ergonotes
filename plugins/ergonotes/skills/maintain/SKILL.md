---
name: maintain
description: Check the user's Ergonotes vault for problems and propose fixes: notes with no links, no tags, duplicate or near-duplicate titles, near-identical tags, broken links, notes sitting in the Inbox for long, empty notes. Only on request: "check my vault", "tidy up", "find orphan notes", "clean my tags". Proposes first, changes only what is approved, never deletes.
disable-model-invocation: true
argument-hint: "[what to check, or everything]"
---

# Vault upkeep

Two phases: **report** (read-only), then **fix** what the user approves. Never delete.

## Checks

Run what the user asked for, or all of them in this order. Work through the vault in slices (by folder), not in one go.

| Check | How | Fix to propose |
| --- | --- | --- |
| **Untagged notes** | `search_notes` by folder, look at `tags: []` | tags that exist and fit (`list_tags`) |
| **Near-identical tags** | `list_tags`: same words with different case, singular/plural, spelling, `work/acme` vs `acme` | pick one, then `add_tags` the chosen tag to the notes that have the other (see `tagging`; the old tag stays until the user removes it in the app) |
| **Orphans** (no links in or out) | `get_links` on each note of a folder (or the ones `list_recent` shows) | link to one or two related notes, or a hub |
| **Duplicate titles / near-duplicates** | same or very similar titles across folders; `read_note` both | a link between them, and ask which is the one to keep |
| **Broken links** | read notes and look for `[text](path.md)` whose target `search_notes` cannot find | correct the path with `replace_text` |
| **Long-waiting Inbox** | notes in the Inbox with an old `updated` date | suggest running `triage` |
| **Empty or tiny notes** | notes with almost no body | ask whether to extend; tell the user they can trash them |
| **Dangling tasks** | `list_tasks` where the due date is long past | ask: reschedule, tick or drop |
| **Recordings without minutes** | notes whose body links a `type_record` but has no Minutes heading | offer the `meeting` skill |

## Report

A table per check: the notes (linked), what is wrong, the proposed fix. Counts at the top. Say what you did **not** check
(too many notes, private notes you cannot see). Then **stop and wait** for approval, per group.

## Fix

Only approved items. For each: `read_note`, make the smallest change (`add_tags`, `replace_text`, `append_to_note`, `move_note`,
`rename_note`), read it back. At the end list what changed.

## Do not

- Never delete, merge by deleting, or empty a note.
- Do not rename notes or tags on your own: titles are file names and other tools link to them.
- Do not "improve" the writing in a note during upkeep.
- Do not touch `.ergonotes/`, `.trash/`, `.habits/`, or private notes (you cannot see them anyway).
