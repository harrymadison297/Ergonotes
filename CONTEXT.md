# Ergonotes

A personal, offline-first note system for one person across several devices. Notes follow PARA + Inbox + Zettelkasten, sync between devices without any always-on server, and can be linked with drawings and (later) sheets and decks.

## Language

### Content

**Vault**:
A folder on a device that holds one person's notes as Markdown files, in the folders they are in, plus a hidden `.ergonotes/` with what Markdown cannot hold (history, assistant conversations, AI settings, sync state), sealed by one password. Putting Markdown files in the folder is enough for them to be notes.
_Avoid_: Workspace, notebook, library, database

**Item**:
Anything a Vault holds that has its own identity and can be linked to: a Note, a Folder, an Attachment, and later a Sheet or Deck.
_Avoid_: Object, entry, document

**Note**:
A Markdown file of the Vault. Its title is its file name, its Folder is the directory it is in, its properties (tags, pinned, private...) are frontmatter. Blocks the app does not understand are kept exactly as written.
_Avoid_: Page, doc, memo

**Private note**:
A Note the person has marked as not to be shown to AI. It is never part of an assistant prompt and does not exist for MCP agents; everything else treats it like any Note.
_Avoid_: Hidden, locked, secret

**Assistant**:
The AI chat in the right sidebar. It answers, and proposes changes to Notes that the person accepts or rejects. Past conversations are kept in its History.
_Avoid_: Bot, copilot, agent (an agent is something outside the app that uses the MCP endpoint)

**Suggestion**:
The grey next-words text shown after the cursor while typing; accepted with Tab, dismissed with Esc.
_Avoid_: Autocomplete, ghost text

**Insert menu**:
The searchable list of every Block and inline element that can be put into a Note, also reached by typing "/". Items can be pinned to its top.
_Avoid_: Slash menu (that is only the way to open it from the keyboard)

**Contents**:
The list of a Note's headings, computed when the person opens it; it is not written into the Note.
_Avoid_: TOC marker, outline block

**Event**:
A dated entry written inside a Note (`@event(...)`), with or without a time; it appears in the Calendar. Not the same as a Task, which can be done.
_Avoid_: Appointment, meeting

**Record**:
A folder of the Vault, under `attachments/`, that holds one recording: its audio, the frames taken from a shared screen and a transcript. A note links to it with `[label](attachments/record_…  "type_record")` and shows it as a player with the frames marked on the timeline. A *Recording* has audio and transcript; a *Meeting* needs a shared screen and also keeps frames.
_Avoid_: Recording file, clip (a clip is the older single audio file), session

**Frame**:
A picture taken from the shared screen during a Meeting, named by the second it was taken at. Dropped while recording when it is practically the last one; the person's own are always kept; a person-started Filter proposes which of the rest to cut.
_Avoid_: Screenshot, capture (that is the Inbox word), snapshot. The button that takes one is **Take frame**; in running text the UI may say "a picture of the shared screen".

**Voice note**:
A short audio clip made in the app and kept in the Note as an audio clip. The older form of a Recording; clips already in notes keep playing.
_Avoid_: Audio file (that is something attached from outside), memo

**Folder**:
A directory of the Vault; the tree a person navigates. Created, renamed and moved in the app or in any file manager. An empty folder exists only on the device where it was made.
_Avoid_: Directory (in the UI), notebook, category

**Block**:
One unit of content inside a Note (paragraph, heading, checklist, table, drawing, callout, toggle, formula, diagram, audio clip...).
_Avoid_: Element, node, widget

**Ergonote block**:
A Block with no standard Markdown form, stored as a fenced block tagged `ergonote-<kind>`. Unknown kinds must survive a save unchanged.
_Avoid_: Custom block, plugin block

**Version history**:
The list of a Note's earlier Commits shown to the person, from which one can be restored as a new Commit.
_Avoid_: Revision list, snapshots

**Drawing**:
An Excalidraw sketch. By default it is a Block owned by one Note and can be promoted to its own Item.
_Avoid_: Diagram, canvas, whiteboard

**Attachment**:
A binary file (image, PDF, spreadsheet, recording...) in the Vault, normally under `attachments/`, embedded or linked from a Note with a standard Markdown reference.
_Avoid_: Upload, asset, media (the "Media" filter on the Files page is only a view label)

### Organisation

**PARA folders**:
The Folders Projects, Areas, Resources and Archive, created by default when a Vault is created. They can be renamed or deleted like any Folder.
_Avoid_: Root folders, system folders

**Inbox**:
The Folder where new captures land until they are triaged. An ordinary Folder; if it is missing it is created on the next capture, and the capture target can be pointed at another Folder in Settings.
_Avoid_: Unsorted, drafts

**Capture**:
Creating a Note quickly (quick note, share from another app, import) without choosing where it belongs.
_Avoid_: Quick add, clip

**Tag**:
A hierarchical label (`work/acme`) attached to a Note. A Note has any number of Tags and exactly one Folder.
_Avoid_: Label, category, keyword

**Link**:
A standard Markdown link to another note's file, `[Title](path/Note.md)`; `[[Title]]` written by other tools is read too. Renaming or moving a note rewrites the links that point at it. The reverse view of a Link is a **Backlink**.
_Avoid_: Reference, relation, mention

**Template**:
A Note marked as a Template that seeds new Notes with content, default Folder and default Tags.
_Avoid_: Boilerplate, snippet

**Daily note**:
A Note named for a calendar date, created from a Template when that day is opened.
_Avoid_: Journal entry, diary

**Task**:
A checkbox Block inside a Note, optionally with a due date and reminder. A Task does not exist outside its Note.
_Avoid_: Todo, reminder, action item

**Command**:
A named action of the app ("Toggle sidebar", "New note", "Open Settings") that the search palette lists and runs. A Command is not a menu entry of one Item; those are *item actions* (Open, Rename, Move, Duplicate…).
_Avoid_: Macro, menu item

**Shortcut**:
The keys bound to a Command: one chord ("Ctrl+K") or two plain keys in turn ("g then h"). A Command may have several. The person's own are kept on the Device and win over the ones a Command came with; a key can belong to only one Command.
_Avoid_: Hotkey, keybinding

**Search palette**:
The Ctrl+K popup: one box that finds Notes, Folders, Tags, Tasks, Commands and Pages. Typing `>` shows only Commands, `#` only Tags, `-` only Tasks.
_Avoid_: Quick open, command bar, spotlight

**Item clipboard**:
What Copy and Cut put aside inside the app: Notes and Folders (never text). Pasting a copy makes a duplicate; pasting a cut moves it. Separate from the text clipboard of the editor.
_Avoid_: Buffer

**Trash**:
The `.trash/` folder of the Vault: where deleted Notes stay, recoverable, for 30 days. A file deleted by another program is treated the same way and can be restored from its history.
_Avoid_: Recycle bin, deleted items

**Purge**:
Permanent removal of an Item and its history from every Device.
_Avoid_: Hard delete, empty

### Devices and sync

**Device**:
One installation of the app that holds a copy of the Vault folder and has a friendly name. Acts as the author of its Commits. Its own settings (identity, remembered key, Store credentials) stay on the device, never in the Vault folder.
_Avoid_: Client, node, machine

**Server peer**:
An optional Device that runs headless on a Linux machine, serves the web UI and the agent endpoint, and takes part in sync like any other Device. No Device depends on it.
_Avoid_: Backend, hub, master

**Store**:
The passive storage location (S3-compatible, WebDAV) that Devices exchange encrypted data through. It has no logic and is never trusted with plaintext.
_Avoid_: Cloud, server, remote

**Commit**:
One recorded change to a Note, made by one Device, pointing at the Commit(s) it was made on top of. A change made to the file by another program becomes a Commit the next time the app looks at the folder.
_Avoid_: Version, revision, save, snapshot

**Head**:
The latest Commit of a line of changes on a Note. A Note with one Head is settled.
_Avoid_: Tip, latest

**Conflicted revision**:
The state of a Note with more than one Head, where the same Note was changed on two Devices without seeing each other's change. Each Device keeps showing its own Head until a person resolves it.
_Avoid_: Conflict copy, duplicate, sync error

**Merge**:
A Commit that joins several Heads into one. Done automatically when changes do not overlap, otherwise by a person choosing a whole version, individual hunks, or editing by hand.
_Avoid_: Resolve, reconcile

**Stale Device**:
A Device that has not synced for longer than the history window, so its changes can no longer be merged against their original base.
_Avoid_: Old device, dormant device

**Sync**:
Exchanging Commits and Attachments between a Device and the Store so every Device ends up with the same set. A person can trigger it by hand to switch devices.
_Avoid_: Backup, replicate, upload
