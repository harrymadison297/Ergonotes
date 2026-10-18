# The `draw` tool

## Arguments

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string, required | the note's id |
| `nodes` | array, required | the things in the drawing (below) |
| `links` | array | arrows between nodes |
| `zones` | array | boxes drawn around groups of nodes |
| `title` | string | a heading above the drawing |
| `direction` | `"LR"` or `"TB"` | flow left to right (default) or top to bottom |
| `sketchy` | boolean | hand-drawn look (default: clean lines) |
| `after_heading` | string | put a new drawing at the end of this section (default: end of the note) |
| `drawing` | number | which drawing of the note (1 = first); without `replace`, the new elements are added **beside** it |
| `replace` | boolean | with `drawing`: replace that drawing entirely |

## Nodes

```json
{ "id": "api", "label": "API gateway", "shape": "rectangle", "color": "blue" }
```

| Field | Meaning |
| --- | --- |
| `id` | short, unique, no spaces; used by links and zones |
| `label` | the text in the shape; `\n` for a line break; long text wraps by itself |
| `shape` | `rectangle` (default, rounded), `ellipse` (start, end, people), `diamond` (a decision), `text` (free text, no shape) |
| `color` | `red`, `pink`, `grape`, `violet`, `blue`, `cyan`, `teal`, `green`, `yellow`, `orange`, `gray`, or `#rrggbb` for the fill |
| `x`, `y` | place it yourself, in pixels. Give **both** or neither. Nodes without them are laid out by the tool |
| `w`, `h` | size; the default fits the text (120 to 340 wide, at least 60 high) |

Size defaults are right most of the time. Fixed `x`/`y` are for composing around a node you want in a particular place; the
others are placed to the right of fixed ones.

## Links

```json
{ "from": "api", "to": "db", "label": "SQL", "style": "dashed", "arrow": "end" }
```

| Field | Meaning |
| --- | --- |
| `from`, `to` | node ids |
| `label` | text on the arrow (short; the arrow needs room, otherwise the tool warns) |
| `style` | `solid`, `dashed` (optional or async), `dotted` (weak relation) |
| `arrow` | `end` (default), `both`, `none` (a plain line) |
| `color` | arrow colour |

An arrow that would run through another shape bends around it by itself. Arrows start and end on the edge of their shapes
and stay attached when the user moves a shape.

## Zones

```json
{ "id": "backend", "label": "Backend (private network)", "nodes": ["api", "db"], "color": "gray" }
```

A zone is a dashed, tinted box around its nodes with its label at the top-left. List **every** node that is inside; the tool
warns when another node ends up inside the box without being listed. Zones may not overlap.

## Layout

- Without `x`/`y`, the tool ranks nodes by the links (sources first), orders each column to reduce crossings, centres columns, and snaps to a 10 px grid.
- Cycles are laid out along the main flow; the way back bends around.
- Nodes with no links at all are put on a grid.
- `direction: "TB"` is better for hierarchies and org charts, `LR` for processes and pipelines.
- Labels on arrows widen the gaps automatically.

## Result

The tool answers with the drawing's number, how many elements it has, `warnings`, and a **PNG of the drawing**.

| Warning | Fix |
| --- | --- |
| `"x" and "y" overlap` | you gave positions that collide: change `x`/`y`, or drop them |
| `passes through another shape` | reorder the nodes, move one with `x`/`y`, or add an intermediate node |
| `is too short for its label` | shorten the label, or give the nodes more distance with `x`/`y` |
| `lies inside zone … but is not listed` | add it to the zone's `nodes`, or move it out |
| `The text of "x" is wider than its shape` | widen it with `w`, or shorten the label |

## Reading and editing existing drawings

`read_drawing` returns `shapes` (id, type, label, position, size), `arrows` (from, to, label), free `texts`, counts of other
elements, the `bounds`, and any `problems`. To add to a drawing: `draw` with `drawing: N` (without `replace`): the new nodes go
to its right. Ids in your new spec are separate from the existing ones; they do not connect to the old shapes. To change
something in a drawing you can rebuild (you made it, or the user agreed), rebuild it with `replace: true`.
