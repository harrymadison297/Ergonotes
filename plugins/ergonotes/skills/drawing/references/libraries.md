# Excalidraw libraries

A library is a set of ready-made shapes (icons, stencils, UML symbols, wireframe parts, hand-drawn people) published at
libraries.excalidraw.com. The tools fetch them over the internet; nothing from the user's notes is sent.

## Find, look, place

1. `search_libraries` with a plain word ("aws", "uml", "database", "wireframe", "arrows", "people"). It returns up to 8 libraries: `library` (the value to pass on), name, description, authors, and some item names. No match: try a shorter or more general word, or give up on a library and use `draw`.
2. `browse_library` with `library` (and `page` for more): **a picture of the items, each numbered**, 12 to a page, plus their names. Look at it and choose by number. Many libraries have unnamed items: the number is then the only handle.
3. `import_library_item` with `id` (note), `library`, `item` (number or name), and:
   - nothing else: a new drawing with just the item;
   - `drawing: N`: add it into that drawing, `position` `right` (default) or `below` the existing content;
   - `scale`: 1 is the author's size; use 0.5 to 0.8 to match a diagram's text, 1.5 to 2 for a hero.
   - `after_heading` as for `draw`.
4. Look at the returned picture. Move on or fix.

## Combining with a diagram

An item lands next to the existing content, not on a particular node. For an icon that decorates a node, prefer one of:

- Build the diagram with `draw`, then import the icons beside it and tell the user to drag them where they belong; or
- make the library item the whole figure (a stencil of a server rack, a UML class symbol set).

Do not claim an icon is attached to a node.

## Licence and credit

The libraries are published under the MIT licence by their authors. The tool writes the library name, its authors and the URL
into the drawing's `source`, and returns it as `credit`. Repeat it to the user ("Uses the Software Architecture library by Youri Tjang").

Brand logos (Kafka, cloud providers, companies) are trademarks even if the file is free to copy. Do not import them unless the
user asked for that brand.

## Limits

- Some libraries are large (several MB); the first fetch can take a few seconds.
- Library items keep their own fonts and styling, which may look hand-drawn next to a clean `draw` diagram; use `sketchy: true`
  in the diagram when the two must match.
- If the fetch fails, the app is offline: say so and use `draw` with plain shapes.
