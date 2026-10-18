# Excalidraw for agents: scene format, libraries, tooling, and what a skill should teach

Researched 2026-10-18 for the `ergonote-excalidraw` block (body = scene JSON) and `@excalidraw/excalidraw ^0.18`.
Every claim cites a primary source. Citation form: `[CODE path#Lx-Ly]`, where CODE is expanded to a base URL in
**Sources** at the end (so URL = base + path). `[RUN]` marks something I executed myself (not read from a source); the
harness is described in section 0. Things I could not verify are listed in "Unverified" at the end.

## Summary

1. **`^0.18` means 0.18.x only; the code to read is tag `v0.18.1`** (npm `latest`, published 2026-04-20; the tag is a
   backport branch with the old `packages/excalidraw/element/` layout). `master` is ahead and differs in ways that matter
   (arrow bindings become `{elementId, fixedPoint, mode}`, new element `created`, new `stickynote` type). Docs on
   docs.excalidraw.com track `master`, not 0.18.1.
2. **A scene is `{type:"excalidraw", version:2, source, elements, appState, files}`.** `restoreElements()` fills every
   missing common field (table in 1.5) but NOT: `points` on arrows/lines (missing `points` throws `TypeError`), text
   `fontSize`/`fontFamily`, a non-zero `width`/`height` for text and shapes, or the two-way arrow/text bindings.
3. **Text in a shape = a separate `text` element with `containerId`, plus `boundElements:[{type:"text",id}]` on the
   container.** `restore` does not position bound text. Verified trick: set text `x = container.x+5`,
   `width = container.width-10`, `textAlign:"center"`, `verticalAlign:"middle"`, `y = container.y + (h - textHeight)/2`;
   it then renders centred without measuring the font `[RUN]`.
4. **Arrows bind both ways**: `arrow.startBinding/endBinding = {elementId, focus, gap}` and
   `shape.boundElements ∋ {type:"arrow", id}`. `restore` repairs text<->container links but not one-sided arrow
   bindings `[RUN]`. Elbow arrows need `fixedPoint` in the binding or restore nulls it.
5. **Libraries**: `.excalidrawlib` is `{type:"excalidrawlib", version:1|2, source, library|libraryItems}`; items are
   `{id,status,created,name?,elements}`. libraries.excalidraw.com is a static Vercel site: `libraries.json` (232 entries,
   200 KB), `stats.json`, `libraries/<author>/<name>.excalidrawlib`, CORS `*`, no documented terms/rate limits. All
   content is MIT (`Copyright (c) 2020 Excalidraw`); there is **no per-library license field**.
6. **Importing an item correctly** = `restoreElements` (migrates legacy fields) -> translate to target -> regenerate
   ids, groupIds, and remap `containerId/boundElements/startBinding/endBinding/frameId` (drop dangling) -> new seeds ->
   `index:null`. Excalidraw's own `duplicateElements` does the remap; it is not exported from the package. A tested
   re-implementation is in 2.5.
7. **`convertToExcalidrawElements` (exported) is the built-in "compact DSL"**: `label:{text}` on shapes/arrows and
   `start/end:{id}` on arrows. It measures text with a canvas (browser only) and centres labels, but it does **not**
   move or stretch arrows to the shapes (default arrow is 100 px wide) `[RUN]`.
8. **Mermaid conversion depends on the mermaid version.** With the mermaid in this repo's lockfile (11.17.2) only
   flowcharts and sequence diagrams became native shapes; class, ER, state and flowchart-subgraph fell back to a
   non-editable SVG image. With `mermaid@11.12.1` all of them converted natively `[RUN]`.
9. **Existing tooling agrees on the verification loop**: render to PNG/SVG with `exportToSvg`/`exportToBlob`, look at
   it, fix, repeat (excalidraw-mcp sends a 512 px PNG back to the model; the coleam00 skill mandates 2-4 render
   iterations).
10. **Recommendation**: teach (c), a helper that takes a compact DSL and runs `convertToExcalidrawElements` +
    `restoreElements({refreshDimensions, repairBindings})` in the app; keep (b) Mermaid for quick flowcharts with a pinned
    mermaid, (d) library placement for icons/stencils, and (a) raw JSON only as an escape hatch with the minimum field
    set in section 4.

---

## 0. Versions and how this was verified

| Thing | Version / commit | Note |
|---|---|---|
| `@excalidraw/excalidraw` | npm `latest` = 0.18.1 (2026-04-20), tag `v0.18.1` = `a2ec2889babf7d2295469c6d90ebe77fae57df84` ("backport mermaid xss fix to 0.18.1") | Repo's `node_modules` has 0.18.1 `[RUN]`. npm registry: https://registry.npmjs.org/@excalidraw/excalidraw |
| `excalidraw/excalidraw` master | `4c37956ba5f04ec342a9d9d5891a38f22c5b7b4e` (2026-10-14) | Used only to list differences. Has `packages/element/`, `AGENTS.md`. |
| `@excalidraw/mermaid-to-excalidraw` | 2.2.2 (npm latest, 2026-03-24) | Installed in repo; source read from `master`. |
| `excalidraw/excalidraw-mcp` | `157aa23ceb1976008aadc89eb05e3444060f09d6` (2026-03-24), MIT | |
| `coleam00/excalidraw-diagram-skill` | `8646fcc9f74f38539c6cdb4c969723336a96ddcd` (2026-03-01) | No LICENSE file; GitHub API `license: null`. |
| `zsviczian/obsidian-excalidraw-plugin` | release 2.29.0, master `3746c5903a08fb551b6777e0a4236315554e3eda` (2026-10-14), **AGPL-3.0** | |
| `excalidraw/excalidraw-libraries` | `297a349eaff859e678f78d4dbc8e68df5fce42e5` (2026-09-03), MIT | Shallow-cloned and analysed `[RUN]`. |

`[RUN]` harness: esbuild bundle of the repo's installed `@excalidraw/excalidraw@0.18.1` (and, for Mermaid, the repo's
`@excalidraw/mermaid-to-excalidraw@2.2.2` with mermaid 11.17.2, then a scratch install with mermaid 11.12.1), loaded in
headless Chromium (Playwright build 1243) over the DevTools protocol; scenes were passed through `restoreElements` /
`restore` / `exportToSvg` and the SVG was screenshotted and looked at. All output quoted below is from that run.

---

## 1. Scene format

### 1.1 File format (`.excalidraw`)

```json
{ "type": "excalidraw", "version": 2, "source": "https://excalidraw.com",
  "elements": [ ... ], "appState": { "gridSize": 20, "viewBackgroundColor": "#ffffff" }, "files": {} }
```

| Key | Meaning | Source |
|---|---|---|
| `type` | exactly `"excalidraw"`; `isValidExcalidrawData` requires it and an `elements` array (or none) | [EX data/json.ts#L112-L123] |
| `version` | `VERSIONS.excalidraw = 2` | [EX constants.ts#L320-L323], [EX data/json.ts#L43-L69] |
| `source` | `window.EXCALIDRAW_EXPORT_SOURCE \|\| location.origin`; informational | [EX constants.ts#L251-L252] |
| `elements` | non-deleted elements, `lastCommittedPoint` nulled on linear ones | [EX element/index.ts#L103-L122] |
| `appState` | when exporting, only 4 keys survive: `gridSize`, `gridStep`, `gridModeEnabled`, `viewBackgroundColor` (others have `export:false`) | [EX appState.ts#L130-L231] |
| `files` | `{[fileId]: {mimeType, id, dataURL, created, lastRetrieved?}}` for `image` elements, filtered to non-deleted users | [EX types.ts#L90-L120], [EX data/json.ts#L25-L41] |

Docs: https://docs.excalidraw.com/docs/codebase/json-schema (source `dev-docs/docs/codebase/json-schema.mdx` on master [EXM dev-docs/docs/codebase/json-schema.mdx]).
Loading in the editor: `<Excalidraw initialData>` runs `restore(initialData, null, null, {repairBindings:true})`
[EX components/App.tsx#L2316]. `exportToSvg`/`exportToCanvas` call `restore()` internally, so un-restored elements
export fine (no `repairBindings`/`refreshDimensions`) [EXU export.ts#L36-L60, L162-L195]. `[RUN]`: the raw 5-element scene
in 1.8 passed straight to `exportToSvg` (what Ergonotes' inline preview does, `packages/app/src/editor/extensions.tsx`)
rendered correctly.

### 1.2 Fields common to every element

From `_ExcalidrawElementBase` [EX element/types.ts#L38-L80] and the constructor defaults [EX element/newElement.ts#L77-L155]:

| Field | Type | Default (constructor / restore) | Notes |
|---|---|---|---|
| `id` | string | random / random | unique; referenced by bindings. Duplicates are silently re-id'd by restore, bindings NOT remapped [EX data/restore.ts#L513-L515] |
| `type` | see 1.3 | - | unknown types and legacy `selection` are dropped [EX data/restore.ts#L384, L503] `[RUN]` (`stickynote` dropped) |
| `x`, `y` | number | 0 | scene px; top-left of the (unrotated) box; for linear elements the position of point 0 |
| `width`, `height` | number | 0 / 0 | explicit `0` and `0` is dropped as "invisibly small" [EX element/sizeHelpers.ts#L12-L19]; *missing* gives a kept but invisible 0x0 `[RUN]`; negative values are normalised [EX element/sizeHelpers.ts#L203] |
| `angle` | radians | 0 | |
| `strokeColor` | CSS colour | `#1e1e1e` | [EX constants.ts#L381-L399] |
| `backgroundColor` | CSS colour | `transparent` | |
| `fillStyle` | `hachure`\|`cross-hatch`\|`solid`\|`zigzag` | **`solid`** | [EX element/types.ts#L17] |
| `strokeWidth` | number | 2 | UI presets 1 / 2 / 4 [EX constants.ts#L375-L379] |
| `strokeStyle` | `solid`\|`dashed`\|`dotted` | `solid` | |
| `roughness` | 0 architect, 1 artist, 2 cartoonist | **1** | [EX constants.ts#L369-L373] |
| `opacity` | 0-100 | 100 | |
| `roundness` | `null` \| `{type:1\|2\|3, value?}` | null | 3 = adaptive radius (rounded rectangles), 2 = proportional (lines/diamonds), 1 = legacy [EX constants.ts#L350-L367]. Legacy `strokeSharpness:"round"` is migrated [EX data/restore.ts#L190-L200] |
| `seed` | int | random (constructor) / **1 (restore)** | roughjs jitter seed. Restore gives every element seed 1, so all hand-drawn strokes jitter identically; set random seeds when `roughness>0` [EX data/restore.ts#L187] |
| `version`, `versionNonce` | int | 1 / 0 | `[RUN]` elements restored from a scene with no `version` came out as `version: 2` (the index assignment evidently bumps it) |
| `index` | fractional-index string \| null | null | restore -> `syncInvalidIndices` assigns `a0,a1,...` in array order `[RUN]` [EX fractionalIndex.ts#L188]. Array order is z-order (first = back) |
| `isDeleted` | bool | false | |
| `groupIds` | string[] | `[]` | same id on all members; ordered deepest -> shallowest [EX element/types.ts#L69-L71] |
| `frameId` | string \| null | null | id of a `frame`; dangling ids are nulled by `repairBindings` `[RUN]` |
| `boundElements` | `{id,type:"arrow"\|"text"}[] \| null` | `[]` | other elements attached to this one [EX element/types.ts#L33-L36] |
| `updated` | epoch ms | now | |
| `link` | string \| null | null | normalised URL; also used by `embeddable` |
| `locked` | bool | false | |
| `customData` | object? | absent | free-form; preserved |

Unknown extra properties are preserved by restore ("forward-compatibility") [EX data/restore.ts#L214-L222].

### 1.3 Element types and their extra fields

| `type` | Extra fields (0.18.1) | Source |
|---|---|---|
| `rectangle`, `diamond`, `ellipse` | none. Bindable and valid text containers | [EX element/types.ts#L86-L96, L256-L271] |
| `text` | `text`, `originalText`, `fontSize`, `fontFamily` (number id), `textAlign` (`left\|center\|right`), `verticalAlign` (`top\|middle\|bottom`), `containerId`, `autoResize` (default true), `lineHeight` (unitless) | [EX element/types.ts#L232-L254] |
| `line` | `points`, `lastCommittedPoint`, `startBinding`, `endBinding`, `startArrowhead`, `endArrowhead` | [EX element/types.ts#L311-L320] |
| `arrow` | line fields + `elbowed: boolean`. Elbow arrows additionally `fixedSegments`, `startIsSpecial`, `endIsSpecial`, and **fixed-point** bindings | [EX element/types.ts#L328-L358] |
| `freedraw` | `points`, `pressures`, `simulatePressure`, `lastCommittedPoint` | [EX element/types.ts#L360-L367] |
| `image` | `fileId`, `status` (`pending\|saved\|error`), `scale:[1,1]` (flip), `crop` | [EX element/types.ts#L144-L154] |
| `frame`, `magicframe` | `name: string\|null` (magicframe is the AI "diagram to code" frame; not an active tool in restore) | [EX element/types.ts#L161-L169], [EX data/restore.ts#L74-L94] |
| `embeddable`, `iframe` | none extra; embeddable's URL is `link`; iframe may carry `customData.generationData` | [EX element/types.ts#L98-L119] |

Arrowheads: `arrow, bar, dot(legacy), circle, circle_outline, triangle, triangle_outline, diamond, diamond_outline,
crowfoot_one, crowfoot_many, crowfoot_one_or_many` [EX element/types.ts#L297-L309]. Restore defaults: arrow
`endArrowhead:"arrow"`, `startArrowhead:null`; line both `null` [EX data/restore.ts#L299, L327].

**Fonts** (`FONT_FAMILY` ids [EX constants.ts#L130-L140]; line heights [EX fonts/FontMetadata.ts#L36-L130]):

| id | Name | lineHeight | Status in 0.18.1 | Used by library items `[RUN]` |
|---|---|---|---|---|
| 5 | Excalifont (default `DEFAULT_FONT_FAMILY`) | 1.25 | current | 779 text elements |
| 6 | Nunito | 1.35 | current | 349 |
| 7 | Lilita One | 1.15 | current | 5 |
| 8 | Comic Shanns | 1.25 | current | 39 |
| 1 | Virgil | 1.25 | deprecated, still renders | 5037 |
| 2 | Helvetica | 1.15 | deprecated, local font | 465 |
| 3 | Cascadia (monospace) | 1.2 | deprecated, still renders | 641 |
| 9 | Liberation Sans | 1.15 | server-side only | 0 |

Default `fontSize` is 20 [EX constants.ts#L180]. Text height = `fontSize * lineHeight * lineCount`; width needs a canvas
measurement [EX element/textMeasurements.ts#L9-L23, L170-L175]. `[RUN]` Excalifont at 20 px: "Client" 57.9, "Server"
65.6, "Markdown file" 140.1, "The quick brown fox" 202.0 -> about **0.5-0.55 x fontSize per character** for prose, 0.64 for
digits, 0.97 for "m". (Widths for font ids other than 5 measured identically in my harness, i.e. the font was not
registered yet; do not trust cold measurements for non-default fonts. The MCP waits for the font first, see 3.1.)

### 1.4 Text inside a shape, arrows, groups, frames

**Bound text.** Two elements:

```jsonc
{ "id":"a",   "type":"rectangle", ..., "boundElements":[{"id":"a_t","type":"text"}] }
{ "id":"a_t", "type":"text", ..., "containerId":"a", "textAlign":"center", "verticalAlign":"middle", "text":"Client", "originalText":"Client" }
```

Container types: rectangle, diamond, ellipse, **arrow** (label on an arrow) [EX element/types.ts#L267-L271].
Geometry Excalidraw uses when it lays bound text out (only on edit, `convertToExcalidrawElements`, or paste/library insert; **not on plain restore**):

| Container | Max text width | Min container for text w x h | Text origin |
|---|---|---|---|
| rectangle | `W - 10` | `w+10`, `h+10` (`BOUND_TEXT_PADDING = 5`) | `x+5`, `y+5` then aligned |
| ellipse | `round(W/2 * sqrt2) - 10` | `round((w+10)/sqrt2*2)` | offset `(W/2)(1 - sqrt2/2)` + 5 |
| diamond | `round(W/2) - 10` | `2(w+10)` | offset `W/4` + 5 |
| arrow | `max(0.7 * W, 11 * fontSize)` | `w + 80` | midpoint of the arrow |

[EX constants.ts#L325-L327], [EX element/textElement.ts#L437-L479, L349-L367, L233-L269, L33-L110].
Centred position: `x = cx - w/2`, `y = cy - h/2` within the container's inner box.
The **no-measure trick** `[RUN]`: give the text `x = container.x+5`, `width = container.width-10`, `textAlign:"center"`,
and `y = container.y + (container.height - textHeight)/2`. Text draws centred inside its own box, so it is centred in the
container without knowing the glyph widths. Wrap manually with `\n` if the string is longer than the box (a too-long
string overflowed both sides in my test).

`repairBindings:true` fixes text<->container links: it adds a missing `{type:"text"}` entry to the container and
nulls a `containerId` that points nowhere [EX data/restore.ts#L394-L470] `[RUN]`.

**Arrow bindings (both directions).**

```jsonc
"startBinding": { "elementId": "a", "focus": 0, "gap": 2 }   // on the arrow
"boundElements": [ { "id": "arr", "type": "arrow" } ]        // on shape a
```

- `focus` in [-1, 1]: where the arrow aims relative to the shape's centre (0 = centre); `gap`: px from the shape edge to the
  arrow tip, at least 1, capped by `maxBindingGap = max(16, min(0.25 * smallerSide, 32), highlight+offset)`
  [EX element/binding.ts#L701-L725, L1573-L1590]. Excalidraw's own `bindLinearElement` writes both sides
  [EX element/binding.ts#L477-L526].
- Arrow geometry is `x,y` = absolute position of point 0, `points` = offsets from `x,y`; `points[0]` must be `[0,0]`
  (restore re-bases it and shifts `x,y` otherwise `[RUN]`); `width/height` are recomputed from `points`
  [EX data/restore.ts#L326-L351]. Bindings are **not** used to move the arrow on load; they only matter once a shape
  moves, so the endpoints you write must already sit on the shapes (edge +/- gap).
- **Elbow arrows**: `elbowed:true`; bindings must carry `fixedPoint:[fx,fy]` (ratios of the target's width/height, e.g. right
  side `[1,0.5]`), else `repairBinding` returns `null` for them [EX data/restore.ts#L111-L143]. Restore nudges `0.5` to
  `0.5001` `[RUN]`. A 4-point elbow `[[0,0],[70,0],[70,140],[140,140]]` with `fixedPoint` bindings rendered correctly `[RUN]`.
- With `repairBindings:true`, restore nulls a binding whose target id is missing, and nulls any binding on a `line` (only `arrow`s keep bindings) [EX data/restore.ts#L553-L568] `[RUN]` (dangling binding -> `null`).
- Restore does **not** add the arrow to the shape's `boundElements` if only the arrow side is present `[RUN]`
  (result `boundElements:[]`): write both sides or the arrow will not follow the shape when the user drags it.

**Groups**: give every member the same string in `groupIds` (innermost first for nested groups).
**Frames**: `frame` element with `name`; children carry `frameId`. Order in the array: children first, then the frame
[EXM dev-docs/docs/codebase/frames.mdx]. `[RUN]` frame + two children + a dangling `frameId:"missing"` -> child
ids kept, dangling one nulled, SVG export contains the frame label and a `clipPath`.

### 1.5 What `restore()` fills in

`restoreElementWithProperties` [EX data/restore.ts#L145-L223] (all `[RUN]`-confirmed on a hand-written minimal scene):

| Missing | Becomes |
|---|---|
| `version`, `versionNonce`, `index`, `isDeleted`, `id` | 1 (then bumped), 0, null (then assigned), false, random |
| `fillStyle`, `strokeWidth`, `strokeStyle`, `roughness`, `opacity` | `solid`, 2, `solid`, **1**, 100 |
| `angle`, `x`, `y`, `width`, `height` | 0, 0, 0, 0, 0 |
| `strokeColor`, `backgroundColor` | `#1e1e1e`, `transparent` |
| `seed`, `groupIds`, `frameId`, `roundness`, `boundElements`, `updated`, `link`, `locked` | **1**, `[]`, null, null, `[]`, now, null, false |
| text `textAlign`, `verticalAlign`, `containerId`, `originalText`, `autoResize`, `lineHeight` | `left`, `top`, null, = `text`, true, detected from height, else the font's metric (Excalifont 1.25) [EX data/restore.ts#L252-L270] |
| image `status`, `scale`, `crop` | `pending`, `[1,1]`, null |
| frame `name` | null |

**Not defaulted** (the sharp edges):

| You omit | Result |
|---|---|
| `points` on `line`/`arrow` | `TypeError: Cannot read properties of undefined (reading 'length')` inside restore (`isInvisiblySmallElement` runs on the raw element first) `[RUN]` [EX element/sizeHelpers.ts#L12-L19]. The "migrate old arrow model" fallback only covers `points.length < 2` |
| text `fontSize` | `NaN` dimensions when refreshed; a text with no `width`/`height` is 0x0 (invisible) unless `restoreElements(..., {refreshDimensions:true})`, and with a missing `fontSize` that gives NaN height `[RUN]` |
| text `fontFamily` | console warning "Couldn't find registered fonts for font-family undefined"; renders with a fallback `[RUN]` |
| text `x`,`y` for bound text | stays where you wrote it; **restore never positions bound text** (the MCP notes the same: "containerId does NOT auto-position text" [MCP CLAUDE.md "Gotchas"]) |
| `width`/`height` on shapes | 0x0 invisible shape |
| both-way arrow binding | one-sided binding kept as is |

`restoreElements(elements, localElements, {refreshDimensions, repairBindings, normalizeIndices?})` [EX data/restore.ts#L490-L495];
`normalizeIndices` is documented for master only [EXM dev-docs/docs/@excalidraw/excalidraw/api/utils/restore.mdx].
`refreshDimensions` re-wraps and re-measures text; for container text it does not re-centre it
[EX element/newElement.ts#L419-L441].

### 1.6 The built-in skeleton API (`convertToExcalidrawElements`)

Exported from the package [EX index.tsx#L287]; docs: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton.
Signature `convertToExcalidrawElements(skeletons, {regenerateIds?: boolean = true})` [EX data/transform.ts#L494-L497].

| Skeleton | Behaviour | Source |
|---|---|---|
| `{type:"rectangle"\|"ellipse"\|"diamond", x, y, width?, height?, label?:{text, fontSize?, fontFamily?, textAlign?, verticalAlign?, strokeColor?...}}` | default 100x100; with a label and no size the container is sized to the label (width/height 0 then `redrawTextBoundingBox`); label text is centred/middle, colour inherits the container's stroke | [EX data/transform.ts#L518-L532, L212-L236] |
| `{type:"text", x, y, text, fontSize?, fontFamily?}` | measured with the canvas (`measureText`), default size 20 / font 5 | [EX data/transform.ts#L564-L584] |
| `{type:"arrow"\|"line", x, y, width?, height?, points?, label?, start?, end?}` | default `width:100,height:0`, points `[[0,0],[w,h]]`, arrow `endArrowhead:"arrow"`; `start/end` = `{id}` of an existing skeleton or `{type, ...}` to create a shape; calls `bindLinearElement` (both sides) and then shifts the end points by 0.5 px | [EX data/transform.ts#L205-L210, L238-L466, L546-L563] |
| `{type:"frame", children:[ids], name?}` | frame bbox = children bbox + 10 px padding; children get `frameId` | [EX data/transform.ts#L720-L788] |
| `image` (needs `fileId`), `freedraw`, `iframe`, `embeddable` | passed through | [EX data/transform.ts#L585-L615] |

`[RUN]` gotcha: `{type:"arrow", x:260, y:135, start:{id:"A"}, end:{id:"B"}}` produced a binding (`gap` 1 and 14) but the
arrow stayed 100 px long and ended 40 px short of B. **Give the arrow explicit `x,y,width,height`/`points` that span the two
shapes**; the skeleton binder only records the binding. Output of a frame skeleton lists the frame *before* its label
text, contrary to the frame ordering rule above `[RUN]`.
It needs a DOM canvas for `measureText` (`setCustomTextMetricsProvider` exists for hosts without one [EX index.tsx#L300]).
`regenerateIds:false` keeps your ids (the MCP widget and Ergonotes' `mermaidToScene` use it).

### 1.7 Clipboard and Obsidian/markdown embedding

**Clipboard**: JSON text on the system clipboard `{"type":"excalidraw/clipboard","elements":[...],"files":{...}}`
[EX clipboard.ts#L24-L28, L129-L175]; docs [EXM dev-docs/docs/codebase/json-schema.mdx "Excalidraw clipboard format"]. On paste
Excalidraw also accepts `type:"excalidraw"` and `"excalidraw-api/clipboard"` (flag `programmaticAPI`)
[EX clipboard.ts#L58-L72, L387-L406; EX constants.ts#L244-L249]. Paste goes through the same pipeline as library insertion
(2.4). Bound text elements are copied with their containers; elements whose frame is not copied get `frameId:null`.

**Obsidian** (zsviczian plugin): a drawing is a markdown file `*.excalidraw.md` with frontmatter `excalidraw-plugin: parsed`,
`tags: [excalidraw]`, then
`# Excalidraw Data` / `## Text Elements` (each text as `text ^blockid`) / optional `## Element Links`, `## Embedded Files`, then
`%%` + `## Drawing` + a fenced block ```` ```json ```` or ```` ```compressed-json ```` holding the scene (`type, version, source,
elements, appState, files`) + `%%`
[OBS src/shared/ExcalidrawData.ts#L1627-L1760; OBS src/shared/excalidrawMarkdownParsing.ts#L103-L125; OBS src/constants/constants.ts#L469-L480].
Embedding in a note: `![[Drawing.excalidraw|width]]`, `![[Drawing.excalidraw|WxH|left]]` [OBS README.md#L208-L215]. The plugin is AGPL-3.0:
read it for format knowledge, do not copy code.
**Ergonotes**: a fence ```` ```ergonote-excalidraw ```` whose body is the scene JSON on one line
(`packages/app/src/editor/diagram.ts` `drawingBlock`, `extensions.tsx`); a literal triple backtick inside a text string would
close the fence, and JSON.stringify does not escape backticks.

### 1.8 Minimal valid scene (two labelled rectangles + bound arrow) `[RUN]`

This exact JSON was passed through `restore(scene, null, null, {repairBindings:true})` (what `initialData` does) and
through `exportToSvg` un-restored. Result: 5 elements kept, geometry unchanged, indices `a0..a4`, bindings intact, appState
filled to 85 keys, SVG 480x90 rendering two rounded boxes ("Client" blue, "Server" green) joined by an arrowhead arrow.

```json
{
  "type": "excalidraw", "version": 2, "source": "ergonotes",
  "elements": [
    { "id": "a", "type": "rectangle", "x": 100, "y": 100, "width": 160, "height": 70, "backgroundColor": "#a5d8ff", "roughness": 0, "roundness": { "type": 3 }, "boundElements": [ { "id": "a_t", "type": "text" }, { "id": "arr", "type": "arrow" } ] },
    { "id": "a_t", "type": "text", "x": 105, "y": 122.5, "width": 150, "height": 25, "text": "Client", "fontSize": 20, "fontFamily": 5, "textAlign": "center", "verticalAlign": "middle", "containerId": "a", "roughness": 0 },
    { "id": "b", "type": "rectangle", "x": 400, "y": 100, "width": 160, "height": 70, "backgroundColor": "#b2f2bb", "roughness": 0, "roundness": { "type": 3 }, "boundElements": [ { "id": "b_t", "type": "text" }, { "id": "arr", "type": "arrow" } ] },
    { "id": "b_t", "type": "text", "x": 405, "y": 122.5, "width": 150, "height": 25, "text": "Server", "fontSize": 20, "fontFamily": 5, "textAlign": "center", "verticalAlign": "middle", "containerId": "b", "roughness": 0 },
    { "id": "arr", "type": "arrow", "x": 262, "y": 135, "width": 136, "height": 0, "points": [ [0, 0], [136, 0] ], "roughness": 0, "startBinding": { "elementId": "a", "focus": 0, "gap": 2 }, "endBinding": { "elementId": "b", "focus": 0, "gap": 2 }, "endArrowhead": "arrow" }
  ],
  "appState": { "viewBackgroundColor": "#ffffff" },
  "files": {}
}
```

Arithmetic used: shape 160x70 at (100,100); text box `x=100+5`, `width=160-10`, `height=25` (20 px x 1.25), `y=100+(70-25)/2`;
arrow from `x=100+160+2` to `400-2`, at `y = 100+35`.

---

## 2. Libraries

### 2.1 `.excalidrawlib` format

```json
{ "type": "excalidrawlib", "version": 2, "source": "https://excalidraw.com",
  "libraryItems": [ { "id": "...", "status": "published", "created": 1700000000000, "name": "Topic Simple", "elements": [ ... ] } ] }
```

| Piece | Detail | Source |
|---|---|---|
| validity | `type === "excalidrawlib"` and `version` 1 or 2 | [EX data/json.ts#L125-L132] |
| writing | `serializeLibraryAsJSON` writes `version: 2` (`VERSIONS.excalidrawLibrary`), key `libraryItems` | [EX data/json.ts#L134-L142; EX constants.ts#L320-L323] |
| v1 (legacy) | key `library`, an array of arrays of elements (no ids/names) | [EX data/types.ts#L49-L59; EX types.ts#L461-L476] |
| item (v2) | `{id, status:"published"\|"unpublished", elements, created (epoch ms), name?, error?}` | [EX types.ts#L466-L475] |
| migration | `restoreLibraryItems(items, defaultStatus)` wraps v1 arrays into items (random id, `created: now`) and runs `restoreElements` on each item's non-deleted elements; exported from the package | [EX data/restore.ts#L771-L815; EX index.tsx#L225-L228] |
| dedupe | `mergeLibraryItems(local, other)` (exported) keeps items whose element ids + versionNonces are not already present | [EX data/library.ts#L113-L148] |
| MIME | `application/vnd.excalidrawlib+json`; drag-drop of a whole library uses `distributeLibraryItemsOnSquareGrid` | [EX constants.ts#L216-L230; EX components/App.tsx#L10297-L10312] |

Measured over all 232 files in the repo `[RUN]`: 162 are v2, 70 are v1; top-level keys are only `type, version, source,
library|libraryItems` (no license/author key); 4187 items in total (median 7 elements, max 542; 85% of items share one
outer `groupId` across all their elements; 45 items `unpublished`); 0 items contain `image` elements (no `files` needed).
Legacy fields are common: `strokeSharpness` on 32,440 elements, `boundElementIds` on 13,305, `baseline` 5,571, `rawText` 548,
type `"draw"` 115, plus 1,175 elements with a `polygon` key (a master-only field, ignored by 0.18.1). Run items through
`restoreLibraryItems`/`restoreElements` before use. Element types present: line 23,640, rectangle 11,752, ellipse 8,200,
text 7,315, freedraw 2,679, arrow 1,032, diamond 366, frame 14.
File size: median 124 KB, max 4.98 MB; the whole `libraries/` tree is 100 MB.

### 2.2 How libraries.excalidraw.com lists and serves them

The site is a static page in the `excalidraw-libraries` repo [LIB script.js, index.html], hosted on Vercel; the repo is
MIT [LIB LICENSE], `homepage` https://libraries.excalidraw.com.

| URL | What | `[RUN]` headers |
|---|---|---|
| `/libraries.json` | array of 232 entries, 200,318 bytes | 200, `access-control-allow-origin: *`, `cache-control: public, max-age=0, must-revalidate`, `etag` |
| `/stats.json` | `{libId: {total, week}}` | same |
| `/libraries/<author>/<name>.excalidrawlib` | the library file, `content-type: application/octet-stream` | same, CORS `*` |
| `/libraries/<author>/<name>.png` | preview | `max-age=2592000` (30 d) [LIB vercel.json] |
| `https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/...` | same files | CORS `*`, `max-age=300` |
| `/robots.txt`, `/sitemap.xml` | 404 | no crawl/terms policy published |

`libraries.json` entry (fields across all 232): `name, description, authors[{name,url}], source, preview, created (YYYY-MM-DD),
updated, version (1\|2)`, optional `id` (176/232) and `itemNames[]` (161/232); the validator requires `name, description,
version, source, preview, created, updated, authors` [LIB scripts/validate-libraries.js]. The site derives the id as
`source.toLowerCase()` with `/` -> `-` and `.excalidrawlib` removed (`jumpingrivers/r.excalidrawlib` -> `jumpingrivers-r`)
and joins `stats.json` by it [LIB script.js "fetchJSONFile"]. **Search** is client-side substring match on
`["name","description","itemNames"]` [LIB script.js "searchKeys"]; sort options: default (downloads total), new, updated,
downloads week, author, name. "Add to Excalidraw" links to `<referrer>?addLibrary=<encoded file URL>[&token=]`
(`#addLibrary=` when `useHash`) [LIB script.js "addToLib"]. Editor-side, `validateLibraryUrl` only allows hosts ending
`excalidraw.com` or `raw.githubusercontent.com/excalidraw/excalidraw-libraries` for that flow
[EX data/library.ts#L46-L50, L483-L513] (irrelevant if you fetch the file yourself).
Submission flow: users publish through the editor; the guidelines (>= 3 related items, English, group multi-element items,
no copies of other libraries) are in [LIB README.md]; repo path layout `libraries/<github-user>/<name>.excalidrawlib` +
`.png`, 193 author folders.

Programmatic search/list/fetch (the HTTP part verified with `curl`; the pick-and-place part is 2.5):

```ts
const base = 'https://libraries.excalidraw.com';
const index = await (await fetch(`${base}/libraries.json`)).json();
const hits = index.filter(l => ['name','description','itemNames'].some(k =>
  [].concat(l[k] ?? '').some(s => String(s).toLowerCase().includes(q))));
const lib = await (await fetch(`${base}/libraries/${hits[0].source}`)).json();   // source = "author/name.excalidrawlib"
const items = restoreLibraryItems(lib.libraryItems ?? lib.library, 'published');  // v1 and v2
const item = items.find(i => i.name === 'Topic Simple');
```

Examples of searches against the index `[RUN]`: "aws" -> 6 libraries, "uml" -> 4, "database" -> 6, "flowchart" -> 0.

### 2.3 License and attribution

- Repo licence: MIT, `Copyright (c) 2020 Excalidraw` [LIB LICENSE]. The publish dialog tells contributors "By submitting, you
  agree the library will be published under the MIT License, which in short means anyone can use them without
  restrictions" [EX locales/en.json "publishDialog.noteLicense"; EX components/PublishLibrary.tsx#L504-L507].
- There is **no per-library `license` field**: not in `libraries.json` (keys listed in 2.2) and not at the top level of any
  `.excalidrawlib` `[RUN]`. Authors are listed (`authors[{name,url}]`) and the site shows them as "@name" links [LIB script.js].
- MIT's condition is that the copyright and permission notice be included "in all copies or substantial portions of the
  Software" [LIB LICENSE]. Practical reading for an app (my interpretation, not legal advice): ship a NOTICE entry for
  excalidraw-libraries (MIT, Copyright (c) 2020 Excalidraw), and when inserting an item show or store the library `name` and
  its authors (e.g. in `customData` on the group, or a caption), so the credit travels with the content. Whether each
  contributor holds copyright separately is not stated in the sources.
- Not covered by the sources: trademarks inside items (for example the Kafka and cloud-provider logos in some libraries);
  the MIT notice is a grant on the files, not a trademark licence. Treat brand icons with the usual care.
- Usage terms for fetching: none published (no ToS page, no robots/sitemap, no rate-limit statement). The files are plain
  static assets with open CORS. Be a good citizen: cache by `etag`, fetch only the library you need, or pin a commit of the
  GitHub repo and bundle the few items you use.

### 2.4 How Excalidraw itself inserts library items (and pastes)

`addElementsFromPasteOrLibrary` [EX components/App.tsx#L3188-L3340] (also used by clipboard paste, `onInsertElements`
[EX components/App.tsx#L1833-L1839], and library drop):

1. `restoreElements(opts.elements, null, undefined)` (migrates legacy fields, fills defaults).
2. `getCommonBounds` -> centre of the item; target point = viewport centre / cursor; snap to grid; `dx = x - centerX`.
3. translate every element by `x + gridX - minX`, `y + gridY - minY` (**the item's top-left lands on the target**).
4. `duplicateElements(..., {randomizeSeed: true})` [EX element/newElement.ts#L686-L799]: new id per element (`randomId`);
   `groupIds` mapped through one fresh-id map; `containerId` remapped (to `null` if its container is not in the set);
   `boundElements` remapped and **entries pointing outside the set are dropped**; `startBinding`/`endBinding` remapped,
   set to `null` if the target is absent; `frameId` remapped; with `randomizeSeed` a new `seed` and `bumpVersion`.
5. append to the scene; `syncMovedIndices` assigns fractional indices to the new elements only.
6. if dropped on a frame, add eligible elements to it (`addElementsToFrame`).
7. for every bound text, `redrawTextBoundingBox` re-wraps and re-centres it in its container.
8. select the new elements (bound text excluded), switch to the selection tool.

Not done by Excalidraw: scaling. Whole-library drop uses `distributeLibraryItemsOnSquareGrid` (square grid of
`ceil(sqrt(n))` columns, 50 px padding, items centred in their cell) [EX data/library.ts#L391-L481].
`duplicateElements`, `distributeLibraryItemsOnSquareGrid` and `addElementsFromPasteOrLibrary` are **not exported** from
`@excalidraw/excalidraw` (exports: `restoreElements`, `restoreLibraryItems`, `mergeLibraryItems`, `getCommonBounds`,
`convertToExcalidrawElements`, `exportTo*`, `serializeAsJSON`, ...) [EX index.tsx#L205-L300].

### 2.5 A tested import helper (option d) `[RUN]`

Verified against four real items from `hartmut-co-uk/kafka-streams-topology-design.excalidrawlib` (a grouped cylinder with
text, a rectangle with bound text plus an arrow, ellipses with text, a nested-group item): 0 duplicate ids, 0 ids shared
with the source, bound text kept its container, bindings stay inside the item, a 0.5-scale copy rendered correctly.

```ts
import { restoreElements, getCommonBounds } from '@excalidraw/excalidraw';
const rid = () => Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
const rint = () => Math.floor(Math.random() * 2 ** 31);

/** Place one library item with its top-left at (ox, oy). `scale` is optional and uniform. */
export function placeLibraryItem(item, ox, oy, scale = 1) {
  const src = restoreElements(item.elements.filter(e => !e.isDeleted), null, { repairBindings: true });
  const [minX, minY] = getCommonBounds(src);
  const idMap = new Map(), gMap = new Map();
  const nid = id => { if (!idMap.has(id)) idMap.set(id, rid()); return idMap.get(id); };
  src.forEach(e => nid(e.id));
  const has = id => idMap.has(id);
  return src.map(e => {
    const c = JSON.parse(JSON.stringify(e));
    c.id = nid(e.id);
    c.x = ox + (e.x - minX) * scale;  c.y = oy + (e.y - minY) * scale;
    c.width = e.width * scale;        c.height = e.height * scale;
    if (e.points) c.points = e.points.map(([px, py]) => [px * scale, py * scale]);
    if (e.type === 'text') c.fontSize = e.fontSize * scale;
    c.seed = rint(); c.version = 1; c.versionNonce = rint(); c.updated = Date.now(); c.index = null;
    c.groupIds = (e.groupIds || []).map(g => { if (!gMap.has(g)) gMap.set(g, rid()); return gMap.get(g); });
    if (c.containerId) c.containerId = has(c.containerId) ? idMap.get(c.containerId) : null;
    if (c.boundElements) c.boundElements = c.boundElements.filter(b => has(b.id)).map(b => ({ ...b, id: idMap.get(b.id) }));
    for (const k of ['startBinding', 'endBinding'])
      if (c[k]) c[k] = has(c[k].elementId) ? { ...c[k], elementId: idMap.get(c[k].elementId), gap: c[k].gap * scale } : null;
    if (c.frameId) c.frameId = has(c.frameId) ? idMap.get(c.frameId) : null;
    return c;
  });
}
// then: scene.elements = restoreElements([...existing, ...placed], null, { repairBindings: true })  // assigns indices
```

Caveats: scaling text changes font size to non-integers; library text is mostly font id 1 (Virgil) or 3 (Cascadia) and
width is not re-measured (use `refreshDimensions:true` after fonts load if you scale). Put placed items on free space
(compute the existing scene's `getCommonBounds` and offset to its right/below).

---

## 3. Existing agent tooling and practices

### 3.1 `excalidraw/excalidraw-mcp` (MCP App server, MIT)

Remote endpoint `https://mcp.excalidraw.com` or local `node dist/index.js --stdio` [MCP README.md]. Architecture and design
notes in [MCP CLAUDE.md]; tools in [MCP src/server.ts#L401-L650].

| Tool | Visibility | What |
|---|---|---|
| `read_me` | model | returns the cheat sheet (palette, element format, camera sizes, examples); "Do NOT call it again" |
| `create_view` | model (UI) | input `{elements: string}` = JSON array string (<= 5 MB); streams elements with draw-on animation; returns `checkpointId` |
| `export_to_excalidraw` | app only | encrypts (AES-GCM) + uploads to `json.excalidraw.com`, returns `https://excalidraw.com/#json=<id>,<key>` |
| `save_checkpoint`, `read_checkpoint` | app only | persist/restore state (file, memory or Redis store; 30-day TTL on Redis) |

The `create_view` response text tells the model to use a `read_widget_context` tool, but I found no registration of such a
tool in `server.ts` at this commit (see Unverified).

Element format taught to the model [MCP src/server.ts#L22-L398]: "standard Excalidraw JSON" plus shorthand the **widget**
expands with `convertToExcalidrawElements(..., {regenerateIds:false})` [MCP src/mcp-app.tsx#L45-L58]: `label:{text,fontSize}` on
rectangle/ellipse/diamond/arrow; arrows with `startBinding:{elementId, fixedPoint:[1,0.5]}` (top `[0.5,0]`, bottom `[0.5,1]`,
left `[0,0.5]`, right `[1,0.5]`); pseudo-elements `cameraUpdate {x,y,width,height}`, `delete {ids:"a,b"}`,
`restoreCheckpoint {id}`. After fonts load the widget runs `restore({elements}, null, null, {refreshDimensions:true})`
[MCP src/mcp-app.tsx#L745-L762] and renders with `exportToSvg` (+ morphdom); the final SVG is sent back to the model as a
512 px PNG so it can see and iterate [MCP CLAUDE.md "Tools"].

Concrete rules in the cheat sheet (numbers are the server's, not Excalidraw's):

| Rule | Value |
|---|---|
| Camera (viewBox) | always 4:3: 400x300 (2-3 elements), 600x450, **800x600 default**, 1200x900 (fonts < 18 unreadable), 1600x1200 (fonts < 21 unreadable); first element is a `cameraUpdate`; leave padding |
| Fonts | body/labels >= 16, titles >= 20, annotations >= 14, never < 14; no emoji ("don't render in Excalidraw's font") |
| Sizes and gaps | labelled shapes >= 120x60; gaps >= 20-30 px; "prefer fewer, larger elements" |
| Drawing order | array = z-order; stream background -> shape -> its label -> its arrows -> next shape (never all shapes, then all texts, then all arrows) |
| Defaults | stroke `#1e1e1e`, fill transparent, `strokeWidth` 2, `roughness` 1, opacity 100; rounded corners `roundness:{type:3}` |
| Palette | strokes: blue `#4a9eed`, amber `#f59e0b`, green `#22c55e`, red `#ef4444`, purple `#8b5cf6`, pink `#ec4899`, cyan `#06b6d4`, lime `#84cc16`; fills: `#a5d8ff` blue, `#b2f2bb` green, `#ffd8a8` orange, `#d0bfff` purple, `#ffc9c9` red, `#fff3bf` yellow, `#c3fae8` teal, `#eebefa` pink; zones (opacity 30): `#dbe4ff`, `#e5dbff`, `#d3f9d8` |
| Contrast | text on white >= `#757575`; on coloured fill use dark variants (`#15803d` not `#22c55e`); dark mode = a huge `#1e1e2e` background rectangle first, text `#e5e5e5` |
| Centring standalone text | `x = cx - estimatedWidth/2`, `estimatedWidth ~ chars x fontSize x 0.5` (my measurement: 0.5-0.55 for prose in Excalifont) |
| Arrow labels | keep short, arrows wide enough; avoid overlapping boxes/labels; draw decorative art last |

### 3.2 `coleam00/excalidraw-diagram-skill`

Method, not a library [SKILL SKILL.md]: "Diagrams should ARGUE, not DISPLAY" [L20-L28]. Pipeline: assess depth -> research real
formats/names for technical diagrams [L53-L66] -> map each concept to a visual pattern (fan-out, convergence, tree, timeline,
cycle, cloud, assembly line, side-by-side, gap) [L179-L192] -> vary patterns [L194-L195] -> build JSON **section by section**
(~32k output-token limit; descriptive string ids; namespaced seeds per section, e.g. 100xxx, 200xxx; update cross-section
`boundElements`; then review the whole) [L208-L250] -> render and validate (mandatory) [L447-L509].

Actionable rules extracted:

| Topic | Rule (skill's numbers) | Source |
|---|---|---|
| Evidence artifacts | technical diagrams must show real code/JSON/event names; code/JSON box = dark rectangle `#1e293b` with syntax-coloured text, JSON text `#22c55e` | [SKILL SKILL.md#L70-L95; SKILL references/color-palette.md] |
| Multi-zoom | summary flow + labelled section regions + detail inside sections | [SKILL SKILL.md#L99-L118] |
| Containers | default to free-floating text; < 30% of text elements inside shapes; lines + dots for trees/timelines | [SKILL SKILL.md#L145-L160, L283-L345] |
| Hierarchy by size | hero 300x150, primary 180x90, secondary 120x60, small 60x40; most important element gets 200 px+ of whitespace | [SKILL SKILL.md#L392-L399] |
| Style | `roughness:0` for professional diagrams (1 for brainstorm), `strokeWidth` 1/2/3, **`opacity` always 100**, `fontSize` 16-20, `fontFamily:3`, text centred/middle in shapes | [SKILL SKILL.md#L363-L388, L409-L421] |
| Palette (fill / stroke) | primary `#3b82f6`/`#1e3a5f`; secondary `#60a5fa`; tertiary `#93c5fd`; start `#fed7aa`/`#c2410c`; end `#a7f3d0`/`#047857`; warning `#fee2e2`/`#dc2626`; decision `#fef3c7`/`#b45309`; AI `#ddd6fe`/`#6d28d9`; error `#fecaca`/`#b91c1c`; text title `#1e40af`, subtitle `#3b82f6`, body `#64748b`, on-light `#374151`, on-dark `#ffffff`; "do not invent new colours"; dark stroke + light fill | [SKILL references/color-palette.md] |
| Connections | every relationship needs an arrow; route around elements with extra `points` waypoints | [SKILL SKILL.md#L404-L406, L483-L488] |
| Render loop | render PNG, **read it**, audit vs the plan, check defects (clipped/overlapping text, arrows through shapes or into empty space, ambiguous labels, uneven spacing, lopsided composition, tiny text), fix, re-render; typically 2-4 iterations; 27-point checklist | [SKILL SKILL.md#L447-L552] |
| Renderer | Playwright + headless Chromium loads a template that `import { exportToSvg } from "https://esm.sh/@excalidraw/excalidraw?bundle"` (**unpinned version**), scale 2, max width 1920, padding 80, min viewport height 600; needs `uv sync` + `playwright install chromium` | [SKILL references/render_excalidraw.py, render_template.html] |
| Don'ts | do not generate the whole file in one pass; do not delegate to a sub-agent; do not write a Python generator ("hand-crafted JSON with descriptive IDs is more maintainable") | [SKILL SKILL.md#L246-L250] |

Its element templates are full hand-written elements (text with `width/height`, `fontFamily:3`, `lineHeight:1.25`,
`containerId`; arrows with `startBinding:{elementId,focus:0,gap:2}`) [SKILL references/element-templates.md]. Note the
tension with 1.5: the skill hand-computes text boxes and relies on a human-like render loop; its "no generator" rule is a
reaction to context overhead for a general agent, not a property of Excalidraw. No licence file: use the ideas, do not
copy the text.

### 3.3 Obsidian Excalidraw plugin: ExcalidrawAutomate (`ea`)

Scripting API for Obsidian scripts [OBS docs/AITrainingData/excalidraw-automate/references/type-definitions.md; guidance in
OBS docs/AITrainingData/excalidraw-automate/SKILL.md]. Shape of the API (signatures as in the type definitions):

| Call | Notes |
|---|---|
| `ea.style` / `ea.setStyle()` | `strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle, roughness, opacity, roundness, fontFamily, fontSize, textAlign, verticalAlign, startArrowHead, endArrowHead`; set **before** creating elements ("paintbrush") |
| `addRect/addDiamond/addEllipse(topX, topY, w, h, id?)`, `addBlob`, `addFrame(x,y,w,h,name?)`, `addStickyNote` | return element ids |
| `addText(topX, topY, text, {autoResize, wrapAt, width, height, textAlign, box: boolean\|"box"\|"blob"\|"ellipse"\|"diamond", boxPadding, boxStrokeColor, textVerticalAlign})` | `box` creates the container for you; `ea.measureText(text)` gives size from the current style |
| `addLine(points)`, `addArrow(points, {startArrowHead, endArrowHead, startObjectId, endObjectId, startFixedPoint, endFixedPoint, elbowed, ...})` | arrowheads `arrow, bar, circle, circle_outline, triangle, triangle_outline, diamond, diamond_outline, null` |
| `connectObjects(idA, "top"\|"bottom"\|"left"\|"right"\|null, idB, connB, {numberOfPoints, startArrowHead, endArrowHead, padding = 10})` | arrow between two shapes at chosen sides (the equivalent of 1.4 binding, done for you) |
| `addLabelToLine(lineId, label)` | straight 2-point lines only |
| `addToGroup([ids])` | returns the new groupId |
| `addMermaid(diagram, groupElements = true)`, `addImage`, `addLaTex`, `addEmbeddable` | |
| `getBoundingBox(elements)`, `generateElementId()`, `refreshTextElementSize(id)` | layout helpers |
| `addElementsToView(repositionToCursor?, save?, newElementsOnTop?, shouldRestoreElements?)` | commits the workbench to the scene |
| `createSVG()`, `createPNG()`, `createPNGBase64()` ("designed to support LLM workflows"), `toClipboard()` | render/verify |

Guidance worth reusing: always `await` async calls; the scene's elements are immutable, so copy into the workbench
(`copyViewElementsToEAforEditing`) and commit once; delete with `isDeleted = true`; prefer `ea` over `window.ExcalidrawLib`;
text has three properties (`text` wrapped, `originalText` unwrapped, `rawText` with markup) that must be kept in sync;
`ea.clone*` regenerates ids and is only for real duplicates [OBS SKILL.md "Core Workflow", "Text Element"]. Typical element
batching is "stage in the workbench, commit once", which maps to "build the whole element array, restore it once".

### 3.4 `@excalidraw/mermaid-to-excalidraw`

`parseMermaidToExcalidraw(definition, config?)` -> `{elements: skeleton[], files}`; then `convertToExcalidrawElements(elements)`;
config supports only `startOnLoad`, `flowchart.curve`, `themeVariables.fontSize`, `maxEdges` (500), `maxTextSize` (50000)
[M2E README.md; M2E src/constants.ts]. Browser-only (it renders the SVG, then reads `getBoundingClientRect`/DOM ids)
[M2E src/parseMermaid.ts#L51-L150]. Dispatch by `diagram.type`: `flowchart-v2`/`graph` -> flowchart, `sequence`, `class`/`classDiagram`,
`er`, `state`/`stateDiagram` -> native shapes; **everything else, or any parser exception, -> one `image` element with an SVG
data URL in `files`** (`convertSvgToGraphImage`) [M2E src/parseMermaid.ts#L52-L150]. The older docs page says flowcharts only
[EXM dev-docs/docs/@excalidraw/mermaid-to-excalidraw/api.mdx]; the code and my run say five native types. Listed fallbacks:
unsupported flowchart shapes (subroutine, cylinder, hexagon, ...) become rectangles, markdown strings become plain text,
FontAwesome icons are dropped, `x--x` arrowheads become bars (same page).

`[RUN]` results (font 16 px; native = rectangles/arrows/text, not an image):

| Diagram | mermaid 11.17.2 (this repo's lockfile) | mermaid 11.12.1 |
|---|---|---|
| flowchart LR with labels, decision, cylinder | native (9 skeleton -> 17 elements) | not rerun |
| sequenceDiagram | native (14 elements) | not rerun |
| classDiagram (3 variants) | **image** ("DOM Node with id classId-Animal-0 not found") | native (7-9 skeleton -> 9-11 elements) |
| erDiagram | **image** ("ER entity entity-CUSTOMER-0 not found") | native (3 boxes, 2 labelled arrows) |
| stateDiagram / -v2 | **image** ("State node element not found") | native |
| flowchart with `subgraph` | **image** ("SubGraph element not found") | native (15 elements) |
| gantt, pie, mindmap | image (default branch) | not rerun (code path unchanged) |

`packages/app/package.json` declares `"mermaid": "^11.0.0"` and the lockfile resolved 11.17.2, while
`@excalidraw/mermaid-to-excalidraw@2.2.2` declares `^11.12.1`. Pin mermaid (e.g. `11.12.1`) if Mermaid input is kept, and
treat an `image` result as a failed conversion (it is not editable and not hand-drawn).
Layout quality is whatever Mermaid computed: e.g. an arrow into a subgraph crossed its title in my render.

### 3.5 Verification practice (what to copy)

| Method | Where | Notes |
|---|---|---|
| `exportToSvg({elements, appState, files, exportPadding})` -> screenshot | excalidraw-mcp widget; coleam00 skill; Ergonotes preview | restores internally; embeds fonts. By default fonts are fetched from a CDN (`esm.sh`) unless `window.EXCALIDRAW_ASSET_PATH` points at the copied `dist/prod/fonts` [EX fonts/ExcalidrawFontFace.ts#L11-L13, L153-L160; docs installation "Self-hosting fonts"]. I found no `EXCALIDRAW_ASSET_PATH` in `packages/*/src` or `apps/*/src` of this repo, so previews and PNG exports are online-dependent |
| `exportToBlob({mimeType:'image/png', exportPadding, getDimensions})` | docs [EXM dev-docs/docs/@excalidraw/excalidraw/api/utils/export.mdx] | what to hand back to a vision model; the MCP sends 512 px max |
| `ea.createPNGBase64()` | Obsidian ExcalidrawAutomate | same idea inside Obsidian |
| headless Chromium + DevTools protocol or Playwright | my harness; coleam00's `render_excalidraw.py` | pure Node without a DOM is unverified; `measureText` needs a canvas |

Programmatic checks to add before rendering (cheap, no vision): every `containerId`/binding target exists; every bound arrow
appears in its shapes' `boundElements`; arrows have `points`, texts have `fontSize/fontFamily/width/height`; no two shapes'
boxes overlap unless nested; text box fits in its container (`textWidth <= W-10`, rectangle); ids unique; no ``` in strings.

---

## 4. Recommendation

### 4.1 The four approaches

| | (a) write scene JSON | (b) write Mermaid, convert in app | (c) compact DSL + helper | (d) pull a library item and place it |
|---|---|---|---|---|
| Output tokens | highest (about 5 elements per node+arrow; text needs width/height, positions) | lowest | low (nodes/edges only) | very low (an item name + position) |
| Reliability | fragile: `points`, font props, two-way bindings, text positions; a typo yields a silent invisible element | depends on the mermaid version (3.4: image fallback); failure is loud | high: the helper owns defaults, bindings, centring | high if the helper does the remap (2.5) |
| Visual quality | full control; best ceiling | Mermaid layout (dagre), poor control, arrows may cross | good with a grid; agent still chooses positions/colours | icon/stencil quality of the library; not a diagram by itself |
| Editable afterwards | yes | yes when native, no when image | yes | yes (grouped) |
| Needs DOM/fonts | no (but must estimate text) | yes | yes (canvas `measureText`; load fonts first) | no for placement; fonts for text re-measure |
| Where to run | anywhere | in the app | in the app (or any browser context) | in the app |
| Best for | escape hatch, tweaks, shapes the DSL lacks | quick flowchart/sequence/ER from text the user already has | **default for architecture/flow/mind-map-like drawings** | logos, cloud/UML icons, stencils |

### 4.2 What the skill should teach (in order)

1. **Default to (c).** Agent emits a small spec: `nodes[{id,label,shape,col,row,fill}]`, `edges[{from,to,label}]` (optionally
   `frames`, `notes`); the helper lays out on a grid, builds skeletons with explicit arrow spans, runs
   `convertToExcalidrawElements({regenerateIds:false})` then `restoreElements({refreshDimensions:true, repairBindings:true})`
   after `document.fonts.load` for the chosen font, and returns the `ergonote-excalidraw` block. Verified implementation (this exact block, plus `placeLibraryItem` from 2.5, was extracted from this file and re-run `[RUN]`: 21 elements, 0 duplicate ids, 0 dangling bindings, rendered as expected):

```ts
import { convertToExcalidrawElements, restoreElements } from '@excalidraw/excalidraw';
export function buildDiagram(spec) {                         // [RUN] rendered the 4-node/3-edge example below
  const W = spec.w ?? 180, H = spec.h ?? 80, GX = spec.gx ?? 100, GY = spec.gy ?? 80, pos = {}, sk = [];
  for (const n of spec.nodes) {
    const x = (n.col ?? 0) * (W + GX), y = (n.row ?? 0) * (H + GY), shape = n.shape ?? 'rectangle';
    pos[n.id] = { x, y, w: n.w ?? W, h: n.h ?? H };
    sk.push({ type: shape, id: n.id, x, y, width: n.w ?? W, height: n.h ?? H, roughness: 0,
      backgroundColor: n.fill ?? '#a5d8ff', strokeColor: n.stroke ?? '#1e1e1e',
      roundness: shape === 'rectangle' ? { type: 3 } : null,
      label: { text: n.label, fontSize: 20, fontFamily: 5 } });
  }
  for (const e of spec.edges) {
    const a = pos[e.from], b = pos[e.to]; let sx, sy, ex, ey;
    if (Math.abs(b.y - a.y) < 1) { const r = b.x > a.x; sx = r ? a.x + a.w : a.x; ex = r ? b.x : b.x + b.w; sy = ey = a.y + a.h / 2; }
    else { const d = b.y > a.y; sy = d ? a.y + a.h : a.y; ey = d ? b.y : b.y + b.h; sx = a.x + a.w / 2; ex = b.x + b.w / 2; }
    sk.push({ type: 'arrow', x: sx, y: sy, width: ex - sx, height: ey - sy, roughness: 0, points: [[0, 0], [ex - sx, ey - sy]],
      start: { id: e.from }, end: { id: e.to }, ...(e.label ? { label: { text: e.label, fontSize: 16, fontFamily: 5 } } : {}) });
  }
  const els = convertToExcalidrawElements(sk, { regenerateIds: false });
  return restoreElements(els, null, { refreshDimensions: true, repairBindings: true });
}
```

   Run on `Editor -> Scene store -> Markdown file`, `AI agent -> Scene store` (180x80 boxes, gaps 100/80) it produced rounded
   pastel boxes with centred labels, arrows touching both shapes (`gap` 1), correct bindings, and a labelled arrow
   ("edit") that was cramped at 100 px: use >= 150 px horizontal gap when an arrow has a label. Diagonal edges and elbow
   routing are not handled by this helper (see 1.4 for elbow fixed points).
2. **Mermaid (b)** for "I already have Mermaid" and quick flowcharts; pin mermaid; detect a result that is a single `image`
   and tell the agent to switch to (c).
3. **Library (d)** for icons: search `libraries.json` (2.2), fetch one file, `restoreLibraryItems`, choose by item `name`,
   place with `placeLibraryItem` next to the node it decorates, record library name + authors; avoid brand logos unless the
   user asks.
4. **Raw JSON (a)** only with the minimum field set below, and always run the same `restoreElements` + render check.
5. **Always render and look** (3.5) and fix: overlap, clipped text, arrows into empty space, tiny text.

### 4.3 Minimum fields an agent must set for a scene to load in `@excalidraw/excalidraw ^0.18` (0.18.1)

Scene: `type:"excalidraw"`, `version:2`, `elements:[...]`; `appState` and `files` may be `{}` (restore fills all of
`appState`; the Ergonotes dialog spreads `appState`, so set at least `viewBackgroundColor`).

| Element | Must set | Should set (otherwise ugly or fragile) |
|---|---|---|
| any | `id` (unique), `type`, `x`, `y` | `roughness:0` (default is 1), random `seed` if roughness > 0 (default is 1 for all), `strokeColor`, `backgroundColor` |
| shapes | `width`, `height` (both non-zero) | `roundness:{type:3}` for rounded rectangles, `boundElements` for its text/arrows |
| text (free) | `text`, `fontSize`, `fontFamily`, `width`, `height` (or restore with `refreshDimensions`) | `lineHeight` (= font metric), `textAlign` |
| text (in shape/arrow) | all of the above + `containerId`, `textAlign:"center"`, `verticalAlign:"middle"`, position inside the container (1.4) and the container's `boundElements:[{type:"text",id}]` | `originalText` (defaults to `text`) |
| arrow / line | **`points`** (first `[0,0]`), consistent `x,y,width,height` | `startBinding/endBinding {elementId, focus:0, gap:1-8}` **and** the reverse `boundElements` entry on both shapes; `endArrowhead` (arrow defaults to `"arrow"`); elbow arrows: `elbowed:true` + `fixedPoint` in both bindings |
| image | `fileId`, `scale:[1,1]`, a `files[fileId]` entry with `mimeType`, `id`, `dataURL`, `created` | `status:"saved"` |
| frame | `name`, `x,y,width,height`; children carry `frameId`; children listed before the frame | |
| group | same string in every member's `groupIds` | |

Everything else (`angle, strokeWidth, strokeStyle, fillStyle, opacity, version, versionNonce, index, isDeleted, groupIds,
frameId, roundness, boundElements, updated, link, locked`) is defaulted by restore and need not be written.

### 4.4 Design numbers to give the agent (sourced above; marked where they are my choice)

| Topic | Value |
|---|---|
| Node size | 160-200 x 70-80 for a labelled rectangle; >= 120x60 minimum [MCP]; hero 300x150, primary 180x90, secondary 120x60 [SKILL] |
| Spacing | >= 20-30 px minimum [MCP]; my helper test used 100 px horizontal and 80 px vertical gaps, and 150 px or more once an arrow carries a label |
| Excalidraw grid | `DEFAULT_GRID_SIZE = 20`, step 5 [EX constants.ts#L201-L202]; snapping to multiples of 20 keeps things tidy (my suggestion) |
| Font | `fontFamily` 5 (Excalifont, default) or 6 (Nunito) for clean looks; size 20 labels, 16 arrow labels/secondary, 24-28 titles; minimum 14 [MCP]; no emoji [MCP] |
| Style | `roughness:0` + `roundness:{type:3}` for technical diagrams, `roughness:1` for sketchy [SKILL]; `opacity:100` [SKILL] |
| Colour | pastel fill + darker stroke of the same hue. Excalidraw's own palette (open-color shades 1 and 4): red `#ffc9c9`/`#e03131`, pink `#fcc2d7`/`#c2255c`, grape `#eebefa`/`#9c36b5`, violet `#d0bfff`/`#6741d9`, blue `#a5d8ff`/`#1971c2`, cyan `#99e9f2`/`#0c8599`, teal `#96f2d7`/`#099268`, green `#b2f2bb`/`#2f9e44`, yellow `#ffec99`/`#f08c00`, orange `#ffd8a8`/`#e8590c`, gray `#e9ecef`/`#343a40`, text/stroke black `#1e1e1e` [EX colors.ts#L26-L90 with open-color 1.9.1 shades 0,2,4,6,8 `[RUN]`]; semantic meaning per colour [SKILL palette] |
| Hierarchy | one hero element, 2-3 levels of size, titles 24-28 px free-floating, whitespace around the key element [SKILL] |
| Arrow routing | straight arrows between same-row/column neighbours, side midpoints; elbow arrows (4 points + `fixedPoint`) for offsets; never through a third shape; labels short [MCP, SKILL] |
| Count | MCP: "fewer, larger elements"; SKILL: build in sections because of output limits. My guidance: about 6-12 labelled nodes per drawing; split bigger systems into several drawings or frames |
| Verify | restore + checks, render PNG/SVG, look, fix; 2-4 iterations [SKILL] |

### 4.5 Findings about this repo that affect the skill (read-only observations)

- `docs/agents/ergonotes-skill/SKILL.md` (line 34 when I read it; the file was being edited concurrently) tells the agent to leave `ergonote-excalidraw` blocks untouched; if (c)/(d)
  are adopted, a tool that takes the DSL (and runs in the app, where the canvas and fonts exist) must write the block, since
  a Node-side MCP server cannot call `measureText` without a DOM.
- `packages/app/src/editor/diagram.ts` already does Mermaid -> scene with `convertToExcalidrawElements({regenerateIds:false})`
  but does not wait for fonts or call `restoreElements({refreshDimensions:true})`; the excalidraw-mcp widget does both.
- Mermaid pin (3.4) and font hosting (3.5) as above.
- Forward compatibility: on `master` bindings change to `{elementId, fixedPoint, mode}` and elements gain `created`
  [EXM packages/element/src/types.ts#L83, L318-L332]. Restore preserves unknown fields on 0.18.1; migration of old
  `focus/gap` bindings on master was not checked.

---

## Unverified / open

- Whether `read_widget_context` (referenced in the excalidraw-mcp `create_view` response) exists: not registered in `src/server.ts`
  at `157aa23`; I did not check other files or the deployed server.
- Pure-Node (no DOM) rendering or text measurement with Excalidraw: not tested. `setCustomTextMetricsProvider` exists but I did
  not exercise it.
- Cold-font behaviour of `convertToExcalidrawElements`: for the default font the widths were identical before and after loading
  in my harness; for font ids 1/3/6/8 my measurements were identical to each other (fonts not registered), so I have no
  trustworthy width table for them.
- Obsidian `compressed-json` algorithm and the exact `.excalidraw.md` text-elements syntax beyond what the quoted code shows.
- Frame, group, image and embeddable elements were checked only as far as restore + SVG export (frames); not loaded into the
  interactive `<Excalidraw>` component.
- Copyright ownership of individual library items and trademark status of logos in them (sources only state MIT for the repo).
- Mermaid conversion with versions between 11.12.1 and 11.17.2 (where the break happens), and class/ER/state conversion
  with other `@excalidraw/mermaid-to-excalidraw` versions.
- `master` behaviour (bindings with `mode`, `created`, `stickynote`, `normalizeIndices`) was read, not run.
- Whether libraries.excalidraw.com applies any undocumented rate limits (only a handful of requests were made).

## Sources

Fetched 2026-10-18. `[CODE path#Lx-Ly]` -> base URL + path.

| Code | Base URL | Pinned to |
|---|---|---|
| EX | https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/ (raw: https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.1/packages/excalidraw/) | tag `v0.18.1` = a2ec288 |
| EXU | https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/utils/ | tag `v0.18.1` |
| EXM | https://github.com/excalidraw/excalidraw/blob/master/ (e.g. `packages/element/src/types.ts`, `dev-docs/docs/...`) | master `4c37956` |
| DOCS | https://docs.excalidraw.com/docs/codebase/json-schema ; https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton ; .../api/utils/restore ; .../api/utils/export ; .../installation ; https://docs.excalidraw.com/docs/@excalidraw/mermaid-to-excalidraw/api ; https://docs.excalidraw.com/docs/codebase/frames | live site (tracks master); sources are the `dev-docs/docs/**.mdx` files in EXM |
| LIB | https://github.com/excalidraw/excalidraw-libraries/blob/main/ (files: `README.md`, `LICENSE`, `libraries.json`, `stats.json`, `authors.json`, `script.js`, `vercel.json`, `scripts/validate-libraries.js`, `libraries/**`); site https://libraries.excalidraw.com | clone at `297a349` |
| MCP | https://github.com/excalidraw/excalidraw-mcp/blob/157aa23ceb1976008aadc89eb05e3444060f09d6/ (`README.md`, `CLAUDE.md`, `src/server.ts`, `src/mcp-app.tsx`, `manifest.json`) | `157aa23` |
| SKILL | https://github.com/coleam00/excalidraw-diagram-skill/blob/8646fcc9f74f38539c6cdb4c969723336a96ddcd/ (`SKILL.md`, `README.md`, `references/color-palette.md`, `references/element-templates.md`, `references/json-schema.md`, `references/render_excalidraw.py`, `references/render_template.html`) | `8646fcc` |
| OBS | https://github.com/zsviczian/obsidian-excalidraw-plugin/blob/master/ (`README.md`, `src/shared/ExcalidrawData.ts`, `src/shared/excalidrawMarkdownParsing.ts`, `src/constants/constants.ts`, `docs/AITrainingData/excalidraw-automate/SKILL.md`, `.../references/type-definitions.md`) | master `3746c59` (release 2.29.0) |
| M2E | https://github.com/excalidraw/mermaid-to-excalidraw/blob/master/ (`README.md`, `src/index.ts`, `src/parseMermaid.ts`, `src/graphToExcalidraw.ts`, `src/constants.ts`); npm https://www.npmjs.com/package/@excalidraw/mermaid-to-excalidraw 2.2.2 | master + npm 2.2.2 |
| NPM | https://registry.npmjs.org/@excalidraw/excalidraw ; https://registry.npmjs.org/@excalidraw/mermaid-to-excalidraw | dist-tags/time as of 2026-10-18 |
| Repo | `/home/cuongtc9/Ergonotes/packages/app/src/editor/{diagram.ts,extensions.tsx}`, `packages/app/src/components/DrawingDialog.tsx`, `docs/agents/ergonotes-skill/SKILL.md` | working tree |

Key files read in EX: `element/types.ts`, `element/newElement.ts`, `element/textElement.ts`, `element/textMeasurements.ts`,
`element/binding.ts`, `element/sizeHelpers.ts`, `element/index.ts`, `data/restore.ts`, `data/transform.ts`, `data/json.ts`,
`data/types.ts`, `data/library.ts`, `clipboard.ts`, `constants.ts`, `colors.ts`, `appState.ts`, `fonts/FontMetadata.ts`,
`fonts/ExcalidrawFontFace.ts`, `components/App.tsx`, `components/PublishLibrary.tsx`, `locales/en.json`, `types.ts`,
`index.tsx`, `fractionalIndex.ts`.
