---
title: "Later: features the Evernote web reference has that Ergonotes does not yet"
labels: [type:backlog, area:ui]
blocked_by: []
---

## Why
The UI was brought to the look and sizes of the Evernote web client (screenshots of Home, Notes,
a note with its toolbar, a notebook, Files). Everything that is visible there and **not**
implemented is listed here, so it is a deliberate "later" and not a silent gap.
Sizes and styling for the parts we do have are in `docs/brand-guidelines.md`.

## Not built (each is its own issue when picked up)

### Create menu (the "…" circle under New note)
- Meeting recording, Event, Voice note, File and Image as entries here (all exist inside a note: Insert menu and the toolbar; ADR 0009)
- AI Prompts
- Space (a second workspace)
- Meeting recording: speaker names (the transcript has no speakers)

### Note editor
- Font family and font size pickers, text colour, highlight colour
- Underline, text alignment, indent / outdent, a "More" overflow for the rest
- AI Edit on a selection (select text, then Rewrite / Shorten / Fix grammar). The right-hand assistant panel exists (ADR 0008); sending a selection to it is the next step
- Insert menu items that need a service of ours or an account: **Mention an entity**, **Mention a person** (there is no
  directory of people or entities in a personal vault) and **Google Drive** (an OAuth flow and a server of ours, ADR 0004)
- Voice: recording on **Android** needs the RECORD_AUDIO permission wired into the WebView (not done, not tested); on the
  web it works on https and localhost only
- Reminder and "Add to…" actions in the note footer (task reminders exist inside the text)
- Share button: share a note by link or with collaborators (needs accounts, so a product decision)

### Navigation and pages
- Notebooks as their own page with stacks (today: Folders view and the folder explorer)
- Tags page; Templates gallery page; Spaces switcher; account and notification entries
- Notebook header "Share" link and a "…" menu with notebook actions
- Home widgets that can be added, removed and rearranged (the pencil button), and the Web clips widget
- Files: upload from the page, sort, audio waveform preview, in-page rename and delete

### Capture
- Web clipper (browser extension) and the "Clip web content" button
- Email-in, meeting transcripts, audio notes

## Notes for whoever picks this up
- Anything that needs an account or a server of ours conflicts with ADR 0004 and the offline-first principle; write
  the ADR first. AI that uses the person's own key is covered by ADR 0008.
- Editor formatting beyond Markdown (font, colour, alignment) has no Markdown form: it needs an
  `ergonote-*` representation or HTML spans, and must survive the three-way merge (ADR 0001).
