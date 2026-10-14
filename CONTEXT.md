# Ergonotes

A personal, offline-first note system for one person across several devices. Notes follow PARA + Inbox + Zettelkasten, sync between devices without any always-on server, and can be linked with drawings and (later) sheets and decks.

## Language

### Content

**Vault**:
The complete set of one person's Items, protected by one password.
_Avoid_: Workspace, notebook, library

**Item**:
Anything a Vault holds that has its own identity and can be linked to: a Note, a Folder, and later a Drawing, Sheet or Deck.
_Avoid_: Object, entry, document

**Note**:
An Item of written content, made of Blocks, that lives in exactly one Folder.
_Avoid_: Page, doc, memo

**Private note**:
A Note the person has marked as not to be shown to AI. It is never part of an assistant prompt and does not exist for MCP agents; everything else treats it like any Note.
_Avoid_: Hidden, locked, secret

**Assistant**:
The AI chat beside an open Note. It answers, and proposes changes to Notes that the person accepts or rejects.
_Avoid_: Bot, copilot, agent (an agent is something outside the app that uses the MCP endpoint)

**Suggestion**:
The grey next-words text shown after the cursor while typing; accepted with Tab, dismissed with Esc.
_Avoid_: Autocomplete, ghost text

**Folder**:
An Item that holds other Items and forms the tree a person navigates. A Folder is an ordinary Item, including the ones created by default.
_Avoid_: Directory, notebook, category

**Block**:
One unit of content inside a Note (paragraph, heading, checklist, table, drawing, callout...).
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
A binary file (image, PDF, spreadsheet...) referenced from a Note, stored once per distinct content.
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
A reference from one Item to another by identity, written `[[...]]`. It survives renaming and moving. The reverse view of a Link is a **Backlink**.
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

**Trash**:
The place deleted Items stay, recoverable, until they are purged.
_Avoid_: Recycle bin, deleted items

**Purge**:
Permanent removal of an Item and its history from every Device.
_Avoid_: Hard delete, empty

### Devices and sync

**Device**:
One installation of the app that holds a full copy of the Vault and has a friendly name. Acts as the author of its Commits.
_Avoid_: Client, node, machine

**Server peer**:
An optional Device that runs headless on a Linux machine, serves the web UI and the agent endpoint, and takes part in sync like any other Device. No Device depends on it.
_Avoid_: Backend, hub, master

**Store**:
The passive storage location (S3-compatible, WebDAV) that Devices exchange encrypted data through. It has no logic and is never trusted with plaintext.
_Avoid_: Cloud, server, remote

**Commit**:
One recorded change to a Note, made by one Device, pointing at the Commit(s) it was made on top of.
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
