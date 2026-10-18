---
name: drawing
description: Draw diagrams, flowcharts, architecture maps, mind maps, timelines and sketches in the user's Ergonotes notes as editable Excalidraw drawings, and place ready-made shapes from the public Excalidraw libraries (icons, UML, cloud, wireframes). Looks at its own result and fixes it. Use when the user asks to draw, sketch, diagram, visualise, map out, or add a figure, icon or flowchart to a note.
argument-hint: "[what to draw, and in which note]"
---

# Drawing in Ergonotes

A drawing is an Excalidraw scene stored in the note as an `ergonote-excalidraw` block. The user can open it and keep editing
it by hand, so what you make must be clean and editable. **Never write or edit that block's JSON yourself**: use the drawing
tools. They run in the desktop app; if they are missing, the app is not running or this is the server peer (say so).

## The tools

| Tool | Use |
| --- | --- |
| `draw` | describe nodes, links and zones; layout, text and arrows are made for you; returns **a picture** and warnings |
| `insert_diagram` | Mermaid text to a drawing (flowchart, sequence, class, ER, state, mind map); quick, Mermaid decides the layout |
| `read_drawing` | what an existing drawing contains (shapes, their text, what arrows connect) and a picture |
| `search_libraries` | find ready-made shape libraries (AWS, UML, databases, wireframes, icons) |
| `browse_library` | a numbered picture of a library's items |
| `import_library_item` | place one library item into a drawing |

## Workflow

1. **Understand the point.** One drawing says one thing. Write the single sentence the picture must make obvious ("requests go through the gateway, then either the cache or the database"). If you cannot, ask.
2. **Check what exists.** `read_note` the note (the user may already have a drawing; `read_drawing` it). Extend or replace a drawing rather than adding a near copy.
3. **Choose the method** (below).
4. **Draw.** Place it where it helps: `after_heading` puts a new drawing at the end of that section. Give the id of the note.
5. **Look at the picture the tool returns.** Check the list below. If anything is wrong, call `draw` again with `drawing` (its number) and `replace: true`, fixing the cause, up to three times.
6. **Tell the user** what you drew in one or two lines and where; mention warnings you could not fix.

## Choosing the method

| The drawing is | Use |
| --- | --- |
| a flow, architecture, system map, hierarchy, comparison, timeline, concept map, anything you design | `draw` |
| the user already has Mermaid, or wants a quick sequence / class / ER / state diagram | `insert_diagram` (if it says the result is a plain picture, redo it with `draw`) |
| an icon or stencil (cloud services, UML symbols, database, person, server) | `search_libraries`, `browse_library`, `import_library_item` |
| a change to a drawing the user made | `read_drawing`, then `draw` with `drawing` (append beside) or ask before `replace` |

Never replace a drawing the user made by hand without asking: replacing loses their layout and styling.

## What a good drawing is (check the picture against this)

- **One message**, 6 to 12 nodes. More than 12: split into two drawings, or group with zones, or cut detail.
- **Reading direction**: left to right or top to bottom, one main flow. Arrows do not run backwards unless they are a loop, and a loop is the only reason for a backward arrow.
- **No crossings**, no arrow through a shape, no shapes touching. The tool warns; fix every warning.
- **Short labels**: 1 to 3 lines, under about 24 characters a line. Put detail in the note's text, not in the shapes.
- **Colour means something** (see `references/design.md`), at most four colours. Same kind of thing, same colour and shape.
- **Hierarchy**: the most important node is bigger or more saturated; a title only when the drawing stands alone.
- **Groups** (zones) for boundaries: a network, a team, a system.
- **Text size** is automatic (20 px); do not shrink to fit more.
- **Arrow labels** only when the relation is not obvious; they need room (the tool warns when an arrow is too short).

## The loop of looking

After each `draw` call, look at the image and ask:

1. Is every node readable? Any clipped or crowded text?
2. Is the flow clear in two seconds?
3. Anything overlapping, crossing, or floating alone?
4. Does it say the sentence from step 1?
5. Are the warnings fixed?

If something is off, change the **spec** (fewer nodes, a different `direction`, explicit `x`/`y` for the troublesome node, a
bigger gap by reordering, a zone that fits) rather than apologising for it.

## Libraries and licences

Libraries come from libraries.excalidraw.com, MIT licensed. The tool records the library and its authors in the drawing and tells
you; pass that credit on to the user in your reply. Do not import brand logos (cloud vendors, companies) unless the user asked for them. See `references/libraries.md`.

## Do not

- Do not write drawing JSON, or paste a `.excalidraw` file into a note.
- Do not draw without the note's id, or into a note you have not read.
- Do not draw a figure the notes do not support: a diagram of the user's system comes from their notes or from what they told you, not from guesses. Mark assumptions in the title or a caption line.
- Do not add decoration: no emoji, no clip art, no gradients.
- Do not leave a warning unmentioned.

## References

- `references/dsl.md`: every field of `draw`, with examples.
- `references/design.md`: colours, sizes, spacing, layout rules per kind of diagram.
- `references/recipes.md`: worked examples: architecture, flowchart with decision, pipeline with zones, mind map, timeline, comparison.
- `references/libraries.md`: finding and placing library shapes.
