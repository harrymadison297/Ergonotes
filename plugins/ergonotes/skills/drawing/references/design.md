# Design rules

## Colour

Fill and stroke come in pairs (pastel fill, darker stroke of the same hue). Choose colours by **meaning** and keep it
consistent inside a drawing; at most four in one drawing, and a legend line in the note if they are not obvious.

| Colour | Use for |
| --- | --- |
| `blue` | the main system, our own components, neutral default |
| `green` | success, data stores, "go", healthy state |
| `yellow` | external systems, third parties, notes and assumptions |
| `orange` | warnings, in-between states, things to watch |
| `red` | errors, risks, blockers, "stop" |
| `violet` | people, roles, users, agents |
| `teal`, `cyan` | a second system or layer when blue is taken |
| `pink`, `grape` | highlight one thing; categories beyond the above |
| `gray` | background structure, zones, optional parts |

Colour is never the only carrier of meaning: label the shape too. Text is always dark.

## Shapes

| Shape | Means |
| --- | --- |
| rounded rectangle | a step, component, thing |
| ellipse | start or end, an actor, a state |
| diamond | a decision (label it as a question; arrows out are labelled "yes" / "no") |
| free text | a title, a caption, a legend |

## Size and spacing

- Default node: 120 to 340 wide by 60 or more high, sized from the text; important nodes bigger by setting `w`/`h` (for example 240 by 100).
- Gaps: about 120 px between columns (170 with arrow labels), 50 to 60 px between nodes in a column. Do not crowd them.
- Coordinates are on a 10 px grid; Excalidraw's own grid is 20 px, so multiples of 20 stay tidy when the user edits.
- Text: 20 px in shapes, 16 px on arrows, 28 px for the title; the tool sets these.
- Whitespace around the key element guides the eye; do not fill the canvas.

## Layout by kind

| Kind | Direction | Notes |
| --- | --- | --- |
| process / pipeline | `LR` | one main row; branches below; diamonds for decisions |
| architecture / system | `LR` or `TB` | layers as zones (clients, services, data); external systems outside the zones, yellow |
| hierarchy / org chart / tree | `TB` | one root at the top |
| mind map | `LR` | a central ellipse; branches by `x`/`y` to fan out, or use the Mermaid mindmap |
| timeline | `LR` | one row of nodes joined by plain lines (`arrow: "none"`); dates in the labels |
| comparison | grid | two zones side by side with the same structure inside |
| cycle | `LR` | a loop; the way back bends around |
| sequence of calls | use `insert_diagram` (Mermaid `sequenceDiagram`) | lifelines are not a node-and-link layout |

## Count

6 to 12 labelled nodes per drawing. If you have more, ask what the picture is for and cut to that, or split ("overview" then
one drawing per part). A drawing nobody can take in at a glance has failed.

## Labels

- Nouns for things ("Auth service"), verbs for steps ("Validate input"), questions for decisions ("Paid?").
- No sentences. No emoji. No ALL CAPS.
- The same thing has the same name everywhere in the drawing and in the note's text.

## After drawing

State in the note's text what the drawing shows, in a line above or below it, so the note still makes sense to someone who
cannot see images (or to a search). A drawing has no text for search: the sentence is what finds it later.
