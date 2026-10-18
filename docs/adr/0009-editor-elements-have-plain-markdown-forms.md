# Editor elements beyond CommonMark keep a plain, readable Markdown form

*Amended by ADR 0015: agents may also draw an Excalidraw drawing directly (the `draw` tool and Excalidraw libraries), not only Mermaid; a drawing is still the `ergonote-excalidraw` block.*

The Insert menu offers more than Markdown has syntax for: a collapsible toggle, a contents box, a page break, a date,
an event, a tick box, a formula, a diagram, a voice note. A note is a Markdown file (ADR 0002, 0010) that other tools, the
MCP endpoint and the three-way merge (ADR 0001) all read as text, so each element must be written as text a person or
an agent can read, and must read back as the same element.

## Decision

Each element has one fixed text form. The editor reads it into the element and writes exactly that form back.

| Element | Written as |
|---|---|
| Toggle (collapsible block) | `<details><summary>Title</summary>` … `</details>` (any blocks inside; may nest) |
| Contents | not stored: the app lists the note's headings when the person opens it (ADR 0010) |
| Page break | `<div style="page-break-after: always;"></div>` (printing and the HTML export break the page there) |
| Date mention | `@date(2026-10-20)` (a chip; clicking it opens the calendar on that day) |
| Event | `Team sync @event(2026-10-20T09:00-10:30)`, or `@event(2026-10-20)` all day; listed in the calendar |
| Tick box | `☐` / `☑` in running text (not a list item; a list item is a task) |
| Formula | `$x^2$` inline, `$$` … `$$` as a block (KaTeX); "$5 and $6" stays prose |
| Diagram | a ```` ```mermaid ```` fence, shown as the diagram, source one click away |
| Audio clip | a link `[Voice note 14:30 · 0:42](attachments/Voice note.webm "audio")`; the title `audio` makes it a player (clips made before ADR 0011 and attached audio files) |
| Recording, meeting | a link to a folder, `[Meeting 2026-10-15 14:30](attachments/record_20261015_143000 "type_record")`; the title `type_record` makes it a player with frames and transcript (ADR 0011) |
| Tag | not text in the note: tags are the `tags:` property (ADR 0010) |
| New linked note | an ordinary `[Title](Title.md)` link to a note created beside this one |

Reading back is lossless for these shapes and tolerant otherwise: a tool that does not know a form shows the text
as written (`@date(…)`), which is still readable; `<details>` and the page-break `<div>` are standard HTML that most
Markdown tools already render.

### Recording and speech-to-text

> Superseded by ADR 0011 for recordings and meetings: a record is a folder (audio, frames, transcript), made as it is
> recorded, with the transcript in a file. What follows still holds for speech-to-text itself, dictation and
> "Transcribe media".

- Recording happens in the app (the microphone is allowed only on https or localhost). It works with no AI at all.
- **Writing it out** (voice dictation, a record's transcript, "Transcribe media") uses *speech-to-text*: a model of a
  **custom server** that speaks OpenAI's `/audio/transcriptions` (OpenAI, Groq, a local Whisper server). OpenRouter and
  Anthropic have no such endpoint, so they cannot be chosen for it. The call is made like the chat's (ADR 0008): by a
  device itself, or by the server peer in the web build, so the key stays off the browser.
- The browser's own dictation is **not** used: it sends audio to the browser vendor, which would be a second, unannounced
  place for note content to go.
- A **meeting** records the microphone *and* the sound of the shared tab or window (the other people on a call), mixed
  into one track; if the person cancels the share, or shares without sound, nothing is recorded and they are told,
  rather than getting a recording of one side (ADR 0011).
- **A private note's audio is never sent for transcription**, the same rule as for text (ADR 0008).

## Consequences

- New element, new form: it is added to this table, to the skill file agents read, and gets a round-trip check.
- The first version of this ADR used `:::toggle`, `[TOC]` and `\newpage`, which are conventions of some renderers, not
  standards; ADR 0010 replaced them with HTML that every Markdown tool understands, and removed the stored contents box.
- Audio is stored in the Vault like any attachment (100 MB per file since ADR 0011; a recording is cut into parts of
  10 minutes while it is made, so it has no length limit).
