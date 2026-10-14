# Ergonotes Brand Guidelines v1.0

> Source of truth for the look and voice of Ergonotes. The CSS tokens in
> `packages/app/src/styles/tokens.css` implement this document; change both together.
> Last updated: 2026-10-14

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

The palette is deliberately small: one accent and a cool grey scale. Everything else
is derived from these nine values.

### Core palette

| Token | Hex | Role |
|---|---|---|
| `--green` | `#2dbe60` | Brand accent: primary buttons, selected-row marker, checkmarks |
| `--ink` | `#000000` | Titles, primary button label |
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
| `--danger` | `#c8283a` | Errors, destructive actions, conflicts. The only non-palette hue in the chrome |

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

Use: a 8 px dot in compact views (note lists, cards, sidebar), a tinted pill
(12 % colour background, `--ink`-level text) in roomy views (editor footer, tag cloud).
Red is excluded: it means "danger".

### Dark theme

| Token | Hex |
|---|---|
| Paper | `#1b2022` |
| Sidebar | `#161a1c` |
| Hover / active | `#252c2f` / `#2e3639` |
| Text | `#eff2f3`, secondary `#aeb6b8`, tertiary `#7b868a` |
| Borders | `#3b4446` hairline, `#525e61` strong |
| Accent | `#2dbe60` (green text on dark may use the brand green directly: 6.8 : 1) |

## 3. Typography

- **Family**: Inter Variable. Fallback `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- **Mono** (code, diff): `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- Body 14 px in chrome, 16 px / 1.65 in the editor. Minimum 12 px.

| Role | Size | Weight |
|---|---|---|
| Page title | 26 px | 700 |
| Dialog title | 18 px | 600 |
| Section heading | 16–18 px | 600 |
| Body (chrome) | 14 px | 400 / 500 |
| Meta, captions | 12.5 px | 400 |
| Editor title | 32 px | 700 |

Sentence case everywhere ("New note", not "New Note"). No all-caps except 11 px menu group titles.

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
| Controls (buttons, inputs, rows) | radius 6 px, min height 36 px (44 px touch) |
| Cards | radius 8 px, 1 px `--slate-200` border (not a shadow ring, so scrollers never clip it) |
| Dialogs | radius 10 px, soft pop shadow |
| Icon buttons | **fully round**, 36 px (compact 32 px, touch 44 px) |
| Icons | Lucide, 1.75 stroke, 18 px in chrome, 22 px in the collapsed sidebar |

Borders are always full 1 px lines on all intended sides. Elevation is used only for
things that float: menus, dialogs, toasts, the search popup.

## 6. Components

### Buttons

| Type | Fill | Label | Use |
|---|---|---|---|
| Primary | `--green-fill` | white | The one main action in a view |
| Secondary | `--white` + `--slate-300` border | `--slate-900` | Other actions |
| Ghost | none | `--slate-700` | Toolbars, rows |
| Danger | none + `--danger` border | `--danger` | Delete, purge |
| **Round icon** | none / `--slate-100` / `--green` | icon only | Most commands. Always has a tooltip and an `aria-label` |

Prefer a round icon button to a text button when the icon is a convention (search, new
note, new folder, sort, save, template, settings, sync, more). Keep a text label when the action is
rare, destructive or needs a sentence ("Empty trash", "Delete forever").

Every button's **whole box** is its hit target: padding belongs to the button, not to
the text inside it.

### Focus

- Mouse and touch: **no outline** on buttons, links or text fields. A text field shows its
  state with a border colour change only.
- Keyboard (after a Tab or arrow key): a 2 px `--green-ink` ring with a 2 px paper gap.
- The editing surface itself never shows a ring.

### Quick row

Top of the sidebar: a green **New note** pill (icon + label), then round outlined buttons for
**Search** and **New from template**, in that order. Their icons carry the two secondary
accents (indigo, orange). Folders are created from the Folders views, not from this row.
When the sidebar is collapsed the pill becomes a round green button.

### Panes and size

- The sidebar, the note list and the table of contents can be resized by dragging their edge
  (arrow keys nudge, double-click resets). Widths are per device.
- The table of contents sits to the right of an open note and is on by default; it is toggled from
  the note toolbar or Settings.
- Interface size defaults to **90 %** and can be set from 50 % to 200 % in Settings. It is per device.

### Search popup

`Ctrl/Cmd + K` or the round search button opens a centred popup (560 px). Results appear as
you type, grouped as Folders and Notes. A note row shows `Folder / Sub-folder` above the
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

| Context | Example |
|---|---|
| Success toast | "Moved to Projects" |
| Error | "Couldn't move the note. Try again." |
| Empty list | "No notes here yet" |
| Destructive confirm | "Delete this note forever? This can't be undone." |

## 8. Accessibility checklist

- All text ≥ 4.5 : 1, non-text UI ≥ 3 : 1 (field borders use `--slate-500`).
- Icon-only buttons carry `aria-label` and a tooltip.
- Hit targets ≥ 36 px on desktop, ≥ 44 px on touch.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`.
- Drag and drop always has a keyboard equivalent (menu → "Move to…").

## Changelog

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-10-14 | Initial guidelines; palette fixed to green + cool-grey scale |
