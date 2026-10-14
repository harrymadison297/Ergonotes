# Ergonotes Brand Guidelines v1.3

> Source of truth for the look and voice of Ergonotes. The CSS tokens in
> `packages/app/src/styles/tokens.css` implement this document; change both together.
> Last updated: 2026-10-14 (v1.3)

## Quick reference

| Element | Value |
|---|---|
| Brand colour | Leaf green `#2dbe60` |
| Ink | Black `#000000` (titles), Slate `#3b4446` (body) |
| Neutrals | `#525e61` · `#7b868a` · `#aeb6b8` · `#d7dcdd` · `#eff2f3` |
| Typeface | Inter (variable), system fallback |
| Shape | 6 px controls, 10 px dialogs, fully round icon buttons |
| Voice | Calm, plain, brief. Never nags, never jokes at a person's expense |

## 1. Positioning

Ergonotes is a personal note system that belongs to one person, works without a
connection, and is encrypted with one password.

- **Promise**: "Your notes, on every device, readable by nobody else."
- **Personality**: quiet, dependable, tidy. A well-made paper notebook with a green ribbon.
- **Not**: a team workspace, a social product, a "second brain" with gamification.

## 2. Colour

The palette is deliberately small: one accent and a cool grey scale. Chrome colours are these
nine values and tints mixed from them. Three groups sit outside it on purpose: the danger
red, the two quick-row accents and the tag colours (listed below).

### Core palette

| Token | Hex | Role |
|---|---|---|
| `--green` | `#2dbe60` | Brand accent for thin marks only: selected-row marker, tab underline, drop target, sync dot |
| `--ink` | `#000000` | Titles and strong text |
| `--slate-900` | `#3b4446` | Body text |
| `--slate-700` | `#525e61` | Secondary text, icons, timestamps |
| `--slate-500` | `#7b868a` | Placeholders, disabled, decorative icons, field borders |
| `--slate-300` | `#aeb6b8` | Strong dividers, scrollbar |
| `--slate-200` | `#d7dcdd` | Hairlines, borders, hover fills |
| `--slate-100` | `#eff2f3` | Sidebar and soft surfaces |
| `--white` | `#ffffff` | Paper (editor, cards) |

### Derived

| Token | Value | Use |
|---|---|---|
| `--green-fill` | `#2dbe60` mixed 30 % with black (`#1f8543`) | Filled controls with white text: primary buttons, New note pill, today marker |
| `--green-fill-hover` | `#2dbe60` mixed 38 % with black | Hover/pressed for filled controls |
| `--green-ink` | `#196935` (`#2dbe60` 55 % + black) | Green **text** and icons on light surfaces |
| `--green-tint` | `#e6f7ec` | Soft green backgrounds (reminders, "new" states) |
| `--danger` | `#c8283a` (dark theme `#ff7b8a`) | Errors, destructive actions, conflicts. Text on it is `--on-danger`: white in light, `#1b2022` in dark |
| `--accent-indigo` | `#5a60c8` (dark `#9aa0f2`) | Search icon in the quick row. 5.5 : 1 on white |
| `--accent-orange` | `#c9650f` (dark `#f0a04d`) | New-from-template icon in the quick row. 4.3 : 1 on white |

### Contrast rules (WCAG 2.2 AA)

| Pair | Ratio | Verdict |
|---|---|---|
| `#000000` on `#ffffff` | 21.0 : 1 | AAA, any size |
| `#3b4446` on `#ffffff` | 10.0 : 1 | AAA, body text |
| `#525e61` on `#ffffff` | 6.7 : 1 | AA, secondary text |
| `#7b868a` on `#ffffff` | 3.7 : 1 | Large text and non-text UI only |
| `#ffffff` on `#1f8543` | 4.7 : 1 | AA, **primary button label and icon** |
| `#000000` on `#2dbe60` | 8.7 : 1 | AAA, only if the bright brand green is used as a fill |
| `#ffffff` on `#2dbe60` | 2.4 : 1 | **Never** put white on the brand green |
| `#2dbe60` on `#ffffff` | 2.4 : 1 | **Never** use the brand green for text; use `--green-ink` |

Consequences:

1. Filled green controls use `--green-fill` with a **white** label or icon. The bright `#2dbe60` stays for thin accents (selection marker, tab underline, drop target) where no text sits on it.
2. Green text, links and outline icons use `--green-ink`, not `--green`.
3. Timestamps and counts use `--slate-700`. `--slate-500` is never the only carrier of meaning.
4. Colour never stands alone: a coloured tag dot always has the tag name beside it, in text or as a tooltip.

### Tag colours

Tags need to be told apart at a glance, so they get a small secondary palette. A tag's
colour is derived from its **top-level name** (`work/acme` and `work/beta` share one),
so every device shows the same colour with no setting to sync.

| Name | Hex |
|---|---|
| Leaf | `#2dbe60` |
| Teal | `#1fa59a` |
| Sky | `#3d8bd9` |
| Indigo | `#6a70d6` |
| Violet | `#a063d1` |
| Rose | `#d9667f` |
| Amber | `#e8892f` |
| Gold | `#c9a21f` |

Use: an 8 px dot in compact views (note lists, cards, sidebar, search results), a tinted pill
(14 % colour in light, 22 % in dark, as the background; `--text-strong` text) in roomy views
(editor footer, tag cloud).
Red is excluded: it means "danger".

### Dark theme

| Token | Hex |
|---|---|
| Paper | `#1b2022` |
| Sidebar | `#161a1c` |
| Hover / active | `#252c2f` / `#2e3639` |
| Text | `#eff2f3`, secondary `#aeb6b8`, tertiary `#7b868a` |
| Borders | `#3b4446` hairline, `#525e61` strong |
| Accent | `--green-ink` becomes `#2dbe60` (6.8 : 1 on `#1b2022`); filled controls keep `--green-fill` with white text |
| Tints | `--green-tint` `#17301f`, `--danger-bg` `#3d1f25` |

## 3. Typography

- **Family**: Inter Variable. Fallback `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- **Mono** (code, diff): `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- **Every size is an even number of px**: 12, 14, 16, 18, 20, 22, 24, 30 (tokens `--fs-xs/s/m/lg/l/h/xl/title`). 12 px is
  the minimum and is used for meta text. No fractional or odd sizes.
- The editor body uses `--fs-editor` (14 px). Set it to `var(--fs-m)` for 16 px reading text.

| Role | Size | Weight |
|---|---|---|
| Editor title and Heading 1 | 30 px (title 20 px on phones) | 600 |
| Page title, Home greeting, editor Heading 2 | 24 px | 700 |
| Note list heading ("Inbox" + count) | 22 px | 600 |
| Section heading (widgets), dialog title, search field | 16 px | 600 |
| Editor Heading 3 | 18 px | 600 |
| Body, buttons, menus, list rows, editor text | 14 px | 400 / 500 |
| Meta, captions, timestamps, counts, tags in dots | 12 px | 400 |

Sentence case everywhere ("New note", not "New Note"). No all-caps except the small menu group titles (12 px).

## 4. Logo

The mark is a white page with a folded top-right corner and three slate text lines, on a
rounded square in brand green. File: `packages/app/public/icon.svg`. (The raster icons in
`apps/desktop/src-tauri/icons` still carry the previous green and are regenerated with
`tauri icon` on the next desktop build.)

- Clear space: half the mark's width on all sides.
- Minimum size: 20 px (UI), 16 px (favicon).
- Only on `--white`, `--slate-100`, `--slate-900` or `--ink` backgrounds.
- Don't recolour, outline, add shadows, rotate, or set the wordmark in another typeface.
- Wordmark: "Ergonotes", Inter 700, `--ink` (or `--slate-100` on dark), never green.

## 5. Shape, space, depth

| Element | Value |
|---|---|
| Spacing scale | 4 · 8 · 12 · 16 · 24 · 32 · 48 |
| Controls (buttons, inputs, rows) | radius 6 px, min height 34 px (40 px touch) |
| Inline breadcrumbs and path segments | min height 32 px (they sit in a 38 px bar) |
| Note top bar and formatting toolbar | 38 px bar; toolbar buttons 34 px; icon buttons 36 px on phones (dense, always-visible chrome) |
| Cards | radius 8 px, 1 px `--slate-200` border (not a shadow ring, so scrollers never clip it) |
| Dialogs, search popup, empty drop areas | radius 10 px; the first two have a soft pop shadow |
| Icon buttons | **fully round**, 34 px (40 px on touch, 38 px in the quick row, 44 px for Home actions) |
| Icons | Lucide, 1.5 px stroke (set once in CSS), 18 px in chrome, 22 px in the collapsed sidebar; 1.25 px stroke for the large folder icons |

Borders are always full 1 px lines on all intended sides. Elevation is used only for
things that float: menus, dialogs, toasts, the search popup. Cards and the sign-in card use a border only.

## 6. Components

### Buttons

| Type | Fill | Label | Use |
|---|---|---|---|
| Primary | `--green-fill` | white | The one main action in a view |
| Secondary | `--white` + `--slate-300` border | `--slate-900` | Other actions |
| Ghost | none | `--slate-700` | Toolbars, rows |
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
- Keyboard (after a Tab or arrow key, until the next pointer press): a 2 px `--green-ink`
  outline offset by 2 px. Text fields, the editing surface and the title keep the border change
  instead of a ring; checkboxes, sliders, buttons, links and rows get the ring.

### Quick row

Top of the sidebar: a green **New note** pill (icon + label), then round outlined buttons for
**Search** and **New from template**, in that order. Their icons carry the two secondary
accents (indigo, orange). Folders are created from the Folders views, not from this row.
When the sidebar is collapsed the pill becomes a round green button.

### Panes

- The sidebar, the note list and the table of contents can be resized by dragging their edge
  (arrow keys nudge by 16 px, Shift 48 px; double-click or Home resets). Widths are per device
  and never exceed half the window.
- Defaults are 264 / 352 / 240 px and shrink with the window (240 / 320 / 210 below 1280 px,
  224 / 296 / 190 below 1024 px). The collapsed sidebar is 68 px.
- The table of contents sits to the right of an open note, is on by default, and is toggled from
  the note toolbar or Settings. It is hidden below 900 px (and on phones), together with its toggle.
- There is no interface scale setting: use the browser or webview zoom (Ctrl + / Ctrl −).

### Home

A greeting and four large round actions (New note, Daily note, From template, Import), then
Quick capture, Notes (Recent or Inbox), Pinned and Tags. Tasks and a compact calendar (max 320 px)
sit in a right column on wide windows. On a phone everything is one column: capture, tasks, notes,
pinned, calendar, tags; Home is the first tab of the bottom bar.

### Note list and note page

Modelled on the reference (Evernote web), measured at 1919 × 1079:

- The window behind the note list is the soft grey (`--bg-sidebar`); the open note is a **white
  rounded panel** (10 px radius, 1 px border, 8 px gap) sitting on it.
- List heading: the folder name at 22 px with its note count beside it in 12 px grey; under it a
  right-aligned row of three plain icons: New note, Sort, View options.
- View options switch the list between **Cards** (default; two columns in a 352 px list; 10 px radius,
  12 px padding, bold title, opening text over up to four lines, date and chips at the bottom, the open
  card has a 2 px green border) and **List** (single-line rows). The choice is per device.
- Note page: breadcrumb at 14 px, an "Edited Oct 13" line at 12 px, a 30 px title, content column
  780 px wide, footer with the tag field on the left and the save state on the right.
- Sizes use the nearest even step to the reference (its 13 px text becomes 14 px; its 12 px stays).

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
shortcuts** only for keys; **Quick capture** for the Home box; **New from template** for the
template action; **Move to trash**, **Empty trash** (the place itself is "Trash").

| Context | Example |
|---|---|
| Success toast | "Moved to Projects" |
| Error | "Couldn't move the note. Try again." |
| Empty list | "No notes here yet" |
| Destructive confirm | "Delete this note forever? This can't be undone." |

## 8. Accessibility checklist

- All text ≥ 4.5 : 1, non-text UI ≥ 3 : 1 (field borders use `--slate-500`). Placeholders are hints, never the only label.
- Icon-only buttons carry `aria-label` and a tooltip.
- Hit targets ≥ 34 px on desktop (32 px for inline breadcrumbs and contents entries), ≥ 40 px on touch (36 px in the note's top bar).
- Respect `prefers-reduced-motion` and `prefers-color-scheme`.
- Drag and drop always has a keyboard equivalent (menu → "Move to…", "Pin to sidebar", "Move to trash").

## Changelog

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-10-14 | Initial guidelines; palette fixed to green + cool-grey scale |
| 1.3 | 2026-10-14 | Matched to the Evernote web reference: note list as cards with a View options switch, rounded white note panel on the grey frame, 22/30 px headings, "Edited" line, thinner icon strokes |
| 1.2 | 2026-10-14 | Type scale on even sizes 12/14/16/20/24 with a 14 px body (a multiple-of-4 trial at 12 px was reverted as too small); tighter paddings and 34 px controls |
| 1.1 | 2026-10-14 | Filled green controls use `--green-fill` with white text; quick row (New note pill, search, template); Home and mobile Home; resizable panes and table of contents; interface scale added and then removed in favour of browser zoom; Pinned wording; documented drag and drop, compact views and focus rules |
