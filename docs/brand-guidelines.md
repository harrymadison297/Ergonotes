# Ergonotes Brand Guidelines v1.6

> Source of truth for the look and voice of Ergonotes. The CSS tokens in
> `packages/app/src/styles/tokens.css` implement this document; change both together.
> Last updated: 2026-10-16 (v1.6)

## Quick reference

| Element | Value |
|---|---|
| Brand colour | Leaf green `#2dbe60` (logo and large areas); primary fill `#008629` with a white label |
| Selection, today, share | Indigo `#4d64ff`; tasks purple `#7d3ebe`; events orange |
| Ink | Black `#000000` (titles), stone `#343332` (body) |
| Neutrals | `#4e4d4c` · `#696564` · `#dad9d8` · `#e7e6e5` · canvas `#f6f5f4` · paper `#ffffff` |
| Typeface | Inter (variable), system fallback |
| Shape | 8 px controls, 12 px cards, 16 px dialogs, fully round icon buttons |
| Motion | 120–280 ms, ease-out, transform and opacity only (panes and tree branches may animate their size, 200 ms); a press squeezes to 96 % |
| Voice | Calm, plain, brief. Never nags, never jokes at a person's expense |

## 1. Positioning

Ergonotes is a personal note system that belongs to one person, works without a
connection, and is encrypted with one password.

- **Promise**: "Your notes, on every device, readable by nobody else."
- **Personality**: quiet, dependable, tidy. A well-made paper notebook with a green ribbon.
- **Not**: a team workspace, a social product, a "second brain" with gamification.

## 2. Colour

The palette is one warm-grey scale, one brand green and three reserved meanings: **indigo = selected or acted on, purple = tasks, orange = events**. Danger red and the tag colours sit outside it. Reserved hues are never used for tags (see Tag colours).

### Neutrals: the stone scale (replaces the cool slate scale)

| Token | Hex | Provenance | Role |
|---|---|---|---|
| `--ink` | `#000000` | unchanged | Titles. Evernote's title colour was not identified (`#000000`, `#141414`, `#212121` are all on its page) |
| `--stone-900` | `#343332` | measured | Body text |
| `--stone-700` | `#4e4d4c` | measured | Secondary text, icons |
| `--stone-600` | `#696564` | measured | Meta text, timestamps, placeholders |
| `--stone-500` | `#9c9897` | measured | Disabled and decorative icons **only**; never text, never a field border |
| `--stone-300` | `#dad9d8` | measured | Card border, strong dividers |
| `--stone-200` | `#e7e6e5` | measured | Hairlines, active row fill |
| `--bg-hover` | `#eeeeee` | measured | Hover fill |
| `--bg-canvas` | `#f6f5f4` | measured | App background and sidebar, one colour, no divider line |
| `--white` | `#ffffff` | measured | Paper: editor, cards |
| `--border-field` | `#878382` | derived | Input and checkbox borders (3:1 or more on white and canvas) |

Not adopted: `#767676` (4.17 : 1 on canvas), `#333333`, `#212121`, `#141414` (roles unknown; keep for the dark-theme work).

### Brand green and its derivatives

| Token | Hex | Provenance | Use |
|---|---|---|---|
| `--green` | `#2dbe60` | unchanged | Logo, illustration, large decorative areas |
| `--green-fill` | `#008629` | derived | Filled controls with a white label: primary button, New note pill |
| `--green-fill-hover` | `#007a25` | derived | Hover and pressed |
| `--green-ink` | `#00701f` | derived | Green text and icons; keyboard focus ring |
| `--green-mark` | `#009b29` | derived | Thin status marks: sync dot, success tick |
| `--green-tint` | `#e6f7ec` | unchanged | Soft green backgrounds |

Evernote's own green, `#00a82d` (corroborated), is **not** used: white on it is 3.16 : 1.
`--green-fill` keeps its hue (138°, Evernote 136°) and lowers the lightness until a white label passes.

### Semantic accents

| Meaning | Token | Hex | Provenance | Use |
|---|---|---|---|---|
| Selection | `--indigo` (= `--sel`) | `#4d64ff` | measured | Open card border, selected-row marker, tab underline, drop target, today marker, share button |
| | `--indigo-hover` | `#3445d6` | derived | Hover and pressed |
| | `--indigo-ink` | `#3d52e8` | derived | Indigo text and icons on light surfaces |
| | `--indigo-tint` | `#ebeeff` | measured | Soft indigo background |
| | `--indigo-soft` | `#7c8eff` | measured | Dark-theme candidate; **not** for text on light |
| Tasks | `--task` | `#7d3ebe` | measured | Task fill, text and chip label |
| | `--task-strong` | `#581caa` | measured | Hover and pressed |
| | `--task-icon` | `#a158eb` | measured | Icons on white only |
| | `--task-tint` | `#fde9ff` | measured | Task chip background (the "0/1" chip) |
| Events | `--event-icon` | `#ee6631` | measured | Icon on a white ring button **only** (2.93 on canvas) |
| | `--event-ink` | `#bf4a1c` | derived | Orange text |
| Danger | `--danger` | `#c8283a` | unchanged | Errors, destructive actions. Evernote's red `#e54e40` is not adopted (3.82 : 1 as text) |

Evernote's yellow `#fcb100` is an upgrade call-to-action. Ergonotes has none, so it is not adopted. If it is ever used, the label must be black (11.43 : 1; white is 1.84 : 1).

### Contrast rules (WCAG 2.2 AA)

| Pair | Ratio | Verdict |
|---|---|---|
| `#343332` on `#ffffff` | 12.61 : 1 | AAA, body |
| `#343332` on `#f6f5f4` | 11.58 : 1 | AAA, body on canvas |
| `#4e4d4c` on `#f6f5f4` | 7.75 : 1 | AAA, secondary text |
| `#696564` on `#f6f5f4` | 5.29 : 1 | AA, meta text and placeholders |
| `#696564` on `#eeeeee` | 4.96 : 1 | AA, placeholder in a filled search field |
| `#696564` on `#e7e6e5` | 4.62 : 1 | AA, meta text on the active row (thin margin) |
| `#9c9897` on `#ffffff` | 2.86 : 1 | **Never text**; disabled and decorative icons only |
| `#767676` on `#f6f5f4` | 4.17 : 1 | **Fails** on canvas; not adopted |
| `#878382` on `#ffffff` | 3.75 : 1 | AA non-text, field border |
| `#878382` on `#f6f5f4` | 3.44 : 1 | AA non-text, field border on canvas |
| `#ffffff` on `#008629` | 4.73 : 1 | AA, **primary button label and icon** |
| `#ffffff` on `#007a25` | 5.51 : 1 | AA, hover |
| `#00701f` on `#f6f5f4` | 5.78 : 1 | AA, green text on canvas |
| `#009b29` on `#ffffff` | 3.67 : 1 | AA non-text, thin marks |
| `#009b29` on `#f6f5f4` | 3.37 : 1 | AA non-text, thin marks on canvas |
| `#ffffff` on `#00a82d` | 3.16 : 1 | **Never** (Evernote's green) |
| `#000000` on `#00a82d` | 6.64 : 1 | AA, only if that bright green were used as a fill |
| `#2dbe60` on `#ffffff` | 2.43 : 1 | **Never** for text or thin marks |
| `#2dbe60` on `#f6f5f4` | 2.23 : 1 | **Never** for text or thin marks |
| `#ffffff` on `#4d64ff` | 4.58 : 1 | AA, indigo fill (thin margin) |
| `#4d64ff` on `#f6f5f4` | 4.21 : 1 | **Fails as text** on canvas; use `--indigo-ink` |
| `#3d52e8` on `#f6f5f4` | 5.40 : 1 | AA, indigo text on canvas |
| `#3d52e8` on `#ebeeff` | 5.10 : 1 | AA, indigo text on its tint |
| `#4d64ff` on `#ebeeff` | 3.97 : 1 | **Fails as text** on its tint |
| `#ffffff` on `#7d3ebe` | 6.35 : 1 | AA, purple fill |
| `#7d3ebe` on `#fde9ff` | 5.53 : 1 | AA, task chip |
| `#a158eb` on `#ffffff` | 4.11 : 1 | AA non-text, task icon on white only |
| `#ee6631` on `#ffffff` | 3.19 : 1 | AA non-text, event icon on white only |
| `#ee6631` on `#f6f5f4` | 2.93 : 1 | **Fails** on canvas |
| `#bf4a1c` on `#ffffff` | 4.99 : 1 | AA, orange text |
| `#bf4a1c` on `#f6f5f4` | 4.58 : 1 | AA, orange text on canvas (thin margin) |
| `#c8283a` on `#f6f5f4` | 5.05 : 1 | AA, danger text on canvas |
| `#000000` on `#fcb100` | 11.43 : 1 | AAA, only if the yellow is ever used |
| `#ffffff` on `#fcb100` | 1.84 : 1 | **Never** |
| `#ffffff` on `#f6f5f4` | 1.09 : 1 | Card on canvas: the 1 px `--stone-300` border carries the edge |
| `#dad9d8` on `#ffffff` | 1.41 : 1 | Decorative border only; matches the v1.4 card edge (1.38 : 1) |

Consequences:

1. Filled green controls use `--green-fill` with a **white** label. `--green` (`#2dbe60`) never carries text or a thin mark.
2. Green text and icons use `--green-ink`. Thin status marks use `--green-mark`.
3. Indigo as text uses `--indigo-ink` on canvas and on its tint. Indigo as a fill or a 2 px mark may use `--indigo`.
4. Timestamps, counts and placeholders use `--stone-600` or darker. `--stone-500` is never the only carrier of meaning.
5. Orange and light purple are icon colours on white. They never carry text and never sit on canvas.
6. A white card on canvas is 1.09 : 1, so a card always keeps its 1 px border.
7. Colour never stands alone: a coloured tag dot always has the tag name beside it.

### Tag colours

Tags keep the v1.4 rule: colour derives from the **top-level name** and is never set by the user.
Two tag hues sat on top of reserved UI hues, so they are replaced **in the same slot** (the slot index is unchanged, so no slot reassignment is needed; only the two colours change).

| Slot | v1.4 | v1.5 | Why |
|---|---|---|---|
| 1 | Leaf `#2dbe60` | unchanged | |
| 2 | Teal `#1fa59a` | unchanged | |
| 3 | Sky `#3d8bd9` | unchanged | Hue 210°, 22° from selection indigo (232°); kept, watch it |
| 4 | Indigo `#6a70d6` (237°) | **Magenta `#c04f9c`** (319°), derived | 5° from selection indigo |
| 5 | Violet `#a063d1` (273°) | **Lime `#7ea320`** (77°), derived | 3° from task purple |
| 6 | Rose `#d9667f` | unchanged | 6° from danger red (pre-existing, not changed here) |
| 7 | Amber `#e8892f` | unchanged | |
| 8 | Gold `#c9a21f` | unchanged | |

Pill rule unchanged: 14 % colour in light, 22 % in dark, as the background, with `--text-strong` text.
Dots carry no text, so they are not held to 4.5 : 1; the label beside them is (Magenta is 4.34 : 1 and Lime 2.94 : 1 on white, so neither may be used as text).

### Dark theme

A warm counterpart of the light theme, derived (not measured). Every pair below was checked with the WCAG formula.

| Token | Hex | Note |
|---|---|---|
| `--bg` (paper) | `#1f1e1d` | |
| `--bg-sidebar` (canvas) | `#171615` | one colour with the sidebar, no divider |
| `--bg-soft` / `--bg-hover` / `--bg-active` | `#252423` / `#2c2b2a` / `#353433` | |
| `--text-strong` / `--text` / `--text-2` / `--text-3` | `#ffffff` / `#ece9e8` / `#b5b1b0` / `#8f8b8a` | 13.8 / 7.8 / 4.9 : 1 on paper |
| `--border` / `--border-card` / `--border-field` | `#302f2e` / `#3d3b3a` / `#8a8685` | field border 4.6 : 1 |
| `--green-ink`, `--green-mark` | `#2dbe60` | 6.9 : 1 on paper |
| `--sel`, `--indigo-ink`, `--indigo-tint` | `#7c8eff`, `#9aa8ff`, `#262b4a` | 5.7 and 7.5 : 1 |
| `--task`, `--task-tint` | `#b98af0`, `#3a2748` | 6.3 : 1; 5.1 : 1 on its tint |
| `--event-ink` | `#f08a5d` | 6.7 : 1 |
| `--danger`, `--danger-bg` | `#ff7b8a`, `#3d1f25` | 6.7 : 1 |

Filled controls keep `--green-fill` with a white label (4.73 : 1).

## 3. Typography

- **Family**: Inter Variable. Fallback `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- **Mono** (code, diff): `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- Sizes are **measured from the reference** (Evernote web at 100 %) and used as they are; there is
  no even-number or multiple-of-4 rule any more. Tokens `--fs-2xs … --fs-title` in `tokens.css`.
- Body text and controls are 13 px; the editor body is 15 px (its default in the reference).

| Role | Size | Weight |
|---|---|---|
| Note title and editor Heading 1 | 30 px (22 px on phones) | 600 |
| Page and list headings ("Home", "Inbox" + count), editor Heading 2 | 22 px | 600 |
| Editor Heading 3 | 18 px | 600 |
| Dialog title | 16 px | 600 |
| Menu items, Create menu | 14 px | 400 |
| Editor body | 15 px | 400 |
| Body, buttons, toolbar, breadcrumb, card title (bold), card text, section labels (semi-bold) | 13 px | 400 / 600 |
| Meta: counts, list dates, "Edited", Total size | 12 px | 400 |
| Dates on Home cards, file sizes and note names on file cards | 11 px | 400 |

Sentence case everywhere ("New note", not "New Note"). No all-caps except the small menu group titles (12 px).

## 4. Logo

The mark is a white page with a folded top-right corner and three slate text lines, on a
rounded square in brand green. File: `packages/app/public/icon.svg`. (The raster icons in
`apps/desktop/src-tauri/icons` still carry the previous green and are regenerated with
`tauri icon` on the next desktop build.)

- Clear space: half the mark's width on all sides.
- Minimum size: 20 px (UI), 16 px (favicon).
- Only on `--white`, `--bg-sidebar` (canvas), `--stone-900` or `--ink` backgrounds.
- Don't recolour, outline, add shadows, rotate, or set the wordmark in another typeface.
- Wordmark: "Ergonotes", Inter 700, `--ink` (or `--bg-sidebar` on dark), never green.

## 5. Shape, space, depth

| Element | Value |
|---|---|
| Spacing scale | 4 · 8 · 12 · 16 · 24 · 32 · 48 |
| Controls (buttons, inputs, rows) | radius 8 px, min height 34 px (44 px on a coarse pointer); 40 px circles in the rail |
| Inline breadcrumbs and path segments | min height 32 px (they sit in a 38 px bar) |
| Note top bar and formatting toolbar | top bar 44 px; toolbar buttons 34 px; icon buttons 36 px on phones (dense, always-visible chrome) |
| Cards | radius 12 px, 1 px `--border-card` (`--stone-300`) border (not a shadow ring, so scrollers never clip it). A white card on the canvas is 1.09 : 1, so the border is what separates them |
| Menus, popovers, search popup, empty drop areas | radius 12 px; the first three have a soft pop shadow |
| Dialogs | radius 16 px (bottom sheets on phones: 16 px on the top corners) |
| Icon buttons | **fully round**, 34 px (40 px on touch, 38 px in the quick row, 44 px for Home actions) |
| Icons | Lucide, 1.5 px stroke (set once in CSS), 18 px in chrome, 22 px in the collapsed sidebar; 1.25 px stroke for the large folder icons |

Borders are always full 1 px lines on all intended sides. Elevation is used only for
things that float: menus, dialogs, toasts, the search popup. Cards and the sign-in card use a border only.

## 6. Components

### Buttons

| Type | Fill | Label | Use |
|---|---|---|---|
| Primary | `--green-fill` | white | The one main action in a view |
| Secondary | `--white` + `--stone-300` border | `--stone-900` | Other actions |
| Ghost | none | `--stone-700` | Toolbars, rows |
| Danger | none + `--danger` border | `--danger` | Delete, purge |
| **Round icon** | none (default), `--bg-active` (soft), `--green-fill` with white icon (primary), `--white` + 1 px border with a coloured icon (ring) | icon only | Most commands. Always has a tooltip and an `aria-label` |

Prefer a round icon button to a text button when the icon is a convention (search, new
note, new folder, sort, save, template, settings, sync, more). Keep a text label when the action is
rare, destructive or needs a sentence ("Empty trash", "Delete forever"). The one exception to
icon-only is the **New note** pill, which carries its label.

Every button's **whole box** is its hit target: padding belongs to the button, not to
the text inside it.

### Focus

- Mouse and touch: **no outline** on buttons, links or text fields. A text field shows its
  state with a border colour change only (inputs, the quick-capture box and the tag field
  too).
- Keyboard (after a Tab or arrow key, until the next pointer press): a 2 px `--focus` (`--green-ink`)
  outline offset by 2 px. Text fields, the editing surface and the title keep the border change
  instead of a ring; checkboxes, sliders, buttons, links and rows get the ring.

### Quick actions

Top of the rail (or sidebar): search, **New note** (green) and the **Create** "…" menu, in that
order from the top in the rail; in the labelled sidebar the New note pill comes first.

### Panes

- The sidebar, the note list and the table of contents can be resized by dragging their edge
  (arrow keys nudge by 16 px, Shift 48 px; double-click or Home resets). Widths are per device
  and never exceed half the window.
- Defaults are 264 / 370 / 240 px (sidebar / note list / contents) and shrink with the window
  (240 / 340 / 210 below 1280 px, 224 / 296 / 190 below 1024 px). The icon rail is 94 px.
- The table of contents sits to the right of an open note, is on by default, and is toggled from
  the note toolbar or Settings. It is hidden below 900 px (and on phones), together with its toggle.
- There is no interface scale setting: use the browser or webview zoom (Ctrl + / Ctrl −).

### Home

The Notes row (Recent or Inbox) with a "Create new note" card at its end and the yellow
Scratch pad beside it, then Pinned and Tags. Tasks and a compact calendar (max 320 px) sit in a right
column on wide windows. On a phone everything is one column: scratch pad, tasks, notes, pinned,
calendar, tags; Home is the first tab of the bottom bar. The daily note, template and import entries
live in the Create menu.

### Note list and note page

Modelled on the reference (Evernote web), measured at 1919 × 1079:

- The window behind the note list is the canvas (`--bg-sidebar`, the same colour as the sidebar, with no divider line); the open note is a **white
  rounded panel** (12 px radius, 1 px `--border-card`, 8 px gap) sitting on it.
- **Icon rail**: 94 px wide and the default. A 40 px search circle (grey), a 40 px green New note
  circle and a 40 px outlined "…" circle (the Create menu), then the destinations one under the
  other, 30 px apart, each a 52 × 30 px pill with an 18 px icon; the open one has a grey fill.
  The footer icon expands the rail into the labelled sidebar with the folder tree.
- **Create menu** (the "…" circle): 210 px wide, 40 px rows, 16 px icon + 14 px label, 12 px radius.
  It holds Task, Folder, Sketch, Note from template, Template, Today's daily note, Import.
- **Home**: grey page, "Home" at 22 px; the Notes row of 170 × 256 px cards ending with a
  "Create new note" card, the yellow 420 × 256 px Scratch pad at its right, then tags, tasks and
  the calendar.
- **List**: heading with note count, 370 px wide by default. View options switch between **Cards**
  (default; two 172 px columns, 8 px gap, 256 px tall, 16 px padding, bold title, opening text, tasks
  chip and date at the bottom; the open card has a 1 px indigo `--sel` border) and **List** (single-line rows).
- **Files page**: heading "Files" + count and "Total size", pills Files / Media / Docs (the open one
  has a 2 px outline), a search field, two-column cards with a preview, name, note and size; the
  preview opens beside the list with a "Go to note" button.
- Note page: top bar with collapse-list and full-screen buttons, breadcrumb at 13 px, the
  formatting toolbar with an Insert button (green dot), an "Edited Oct 13" line, a 30 px title with
  the placeholder "Title", and the body placeholder `Press "/" to insert an element`.

### Compact views

"Compact" means list rows, cards and task rows: every line is cut with an ellipsis instead of
wrapping, and the preview is the note's first sentence. A row may still have several lines
(title, preview, meta), each one a single line.

### Drag and drop

Notes and folders can be dragged onto: a folder (move), the top-level "Folders" row (move to the
top), a tag (add that tag), "Pinned" (pin), or Trash (move to trash, with Undo in the toast).
Files dropped on a note's body are attached. Every drop has a menu equivalent.

### Search popup

`Ctrl/Cmd + K` or the round search button opens a popup (560 px wide, near the top of the window).
With nothing typed it lists the most recent notes. Results appear as you type, grouped as Folders and Notes. A note row shows `Folder / Sub-folder` above the
title, then the matching passage with the query in bold. Up/Down move, Enter opens,
Esc closes.

### Empty states

One quiet line plus the single most useful action. No illustrations.

### Folder view

A folder opened with no note selected is shown like a file manager: large icons
(folders first, then notes), details list as the alternative, drag items onto a folder to
move them, double-click or Enter to open.

## 7. Voice

| We are | We are not |
|---|---|
| Plain: "Saved to Inbox" | Cute: "Yay, captured!" |
| Specific: "3 notes updated" | Vague: "Done" |
| Calm about problems: "Couldn't reach the storage. Your notes are safe on this device." | Alarmist: "Sync failed!!" |
| Honest about limits: "A lost password can't be recovered." | Reassuring without basis |

Rules: sentence case, no exclamation marks, no emoji in UI, say "device" not "client",
use the glossary terms in `CONTEXT.md` (Vault, Note, Folder, Tag, Commit…).

Fixed wording: **Pinned** for notes kept in the sidebar ("Pin to sidebar", "Unpin"); **Keyboard
shortcuts** only for keys; **Scratch pad** for the Home box; **New from template** for the
template action; **Move to trash**, **Empty trash** (the place itself is "Trash").

| Context | Example |
|---|---|
| Success toast | "Moved to Projects" |
| Error | "Couldn't move the note. Try again." |
| Empty list | "No notes here yet" |
| Destructive confirm | "Delete this note forever? This can't be undone." |

## 8. Accessibility checklist

- All text ≥ 4.5 : 1, non-text UI ≥ 3 : 1 (field borders use `--border-field`). Placeholders are hints, never the only label.
- Icon-only buttons carry `aria-label` and a tooltip.
- Hit targets ≥ 34 px on desktop (32 px for inline breadcrumbs and contents entries); on a coarse pointer buttons, menu rows and list rows are ≥ 44 px, icon buttons ≥ 40 px (36 px in the note's top bar). Checkboxes keep a 44 px hit area through an invisible margin.
- Respect `prefers-reduced-motion` (every transition and animation is switched off) and `prefers-color-scheme`.
- Drag and drop always has a keyboard equivalent (menu → "Move to…", "Pin to sidebar", "Move to trash").

## 9. Motion and touch

Motion explains what changed; it never decorates. Only `transform` and `opacity` move (colours fade),
so nothing re-lays out. The one exception is a pane or a tree branch opening or closing: a sidebar, the note
list or the right sidebar changing width (the column is animated, the pane's content keeps its own width and is
clipped, so nothing inside reflows), and a folder's branch changing height, both in `--t-pane`. Dragging a pane's
edge is never eased: it follows the pointer. `prefers-reduced-motion: reduce` turns all of it off.

| Token | Value | Use |
|---|---|---|
| `--t-fast` | 120 ms | Hover, press, colour changes |
| `--t-base` | 180 ms | Menus, popovers, the search popup, shadows |
| `--t-slow` | 280 ms | Dialogs, bottom sheets, toasts |
| `--t-pane` | 200 ms | A pane or a tree branch opening or closing (width or height) |
| `--ease` | `cubic-bezier(.2,.7,.2,1)` | Everything that enters or changes |
| `--ease-spring` | `cubic-bezier(.34,1.45,.64,1)` | Toasts and the floating action button only |

| Thing | Motion |
|---|---|
| Buttons, icon buttons, tabs, rows | Colour fades in 120 ms; a press squeezes to 96 % (checkboxes 86 %, cards 98.5 %); a pressed row fills with `--bg-active` |
| Cards and file cards | On a pointer device, hover lifts 1 px with `--shadow-lift` |
| Menus, popovers, model picker | Fade and scale from .97, 180 ms, from the corner they hang from |
| Dialogs | Fade, rise 10 px and scale from .98, 280 ms; bottom sheet on phones |
| Search popup | As a menu, from the top centre |
| Sidebar, note list, right sidebar (Contents / Assistant), full screen | The column slides to its new width; the sidebar's labels fade in or out as it widens or narrows |
| Folder, Pinned, Tags in the sidebar | The branch grows or shrinks; its arrow turns a quarter |
| Tags that do not fit the note's footer | Pills become dots; pointing at the dots opens a panel above them (fade, 4 px rise) |
| Open note on a phone | Slides up from the bottom |
| Toasts | Rise 12 px with a light spring |
| Selected note row | The indigo marker grows from the top |

Touch: every control has `touch-action: manipulation` (no 300 ms delay or double-tap zoom); hover
styles apply only where hover exists (`@media (hover: hover)`), so nothing stays "hovered" after a tap;
scrollers use `overscroll-behavior: contain`; inputs are 16 px on phones so the page never zooms on focus;
safe-area insets are honoured at the top (search bar), bottom (tab bar, sheets, composer) and sides.

Phone layout: the search bar and settings sit at the top; a bottom tab bar (Home, Notes, Folders, Tasks,
More) marks the open tab with a green-tint pill; the New note button floats above it; dialogs and the
Assistant open as bottom sheets; a note opens full screen.

## Changelog

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-10-14 | Initial guidelines; palette fixed to green + cool-grey scale |
| 1.6 | 2026-10-16 | Panes and tree branches animate their size (`--t-pane`, 200 ms), the one exception to transform-and-opacity; collapsed sidebar 60 px with 36 px controls on a 4 / 20 px rhythm; tags become dots with a panel when they do not fit |
| 1.5 | 2026-10-15 | Warm stone neutrals and canvas `#f6f5f4` (replaces the cool slate scale); primary fill `#008629`; indigo for selection, purple for tasks, orange for events; tag slots 4–5 become magenta and lime; field border `#878382`; warm dark theme; radii 8/12/16; canvas-and-cards (no sidebar divider); motion and touch rules; phone bottom sheets |
| 1.4 | 2026-10-14 | Even-size rule removed; sizes taken from the reference as measured (13 px body, 15 px editor, 22 px headings, 30 px title); icon rail as default, Create menu, new Home, Files page, collapse-list and full-screen; features not yet built listed in docs/issues/11 |
| 1.3 | 2026-10-14 | Matched to the Evernote web reference: note list as cards with a View options switch, rounded white note panel on the grey frame, 22/30 px headings, "Edited" line, thinner icon strokes |
| 1.2 | 2026-10-14 | Type scale on even sizes 12/14/16/20/24 with a 14 px body (a multiple-of-4 trial at 12 px was reverted as too small); tighter paddings and 34 px controls |
| 1.1 | 2026-10-14 | Filled green controls use `--green-fill` with white text; quick row (New note pill, search, template); Home and mobile Home; resizable panes and table of contents; interface scale added and then removed in favour of browser zoom; Pinned wording; documented drag and drop, compact views and focus rules |
