# Editor elements beyond CommonMark keep a plain, readable Markdown form

The Insert menu offers more than Markdown has syntax for: a collapsible toggle, a contents box, a page break, a date,
an event, a tick box, a formula, a diagram, a voice note. A note is a Markdown file (ADR 0002) that other tools, the
MCP endpoint and the three-way merge (ADR 0001) all read as text, so each element must be written as text a person or
an agent can read, and must read back as the same element.

## Decision

Each element has one fixed text form. The editor reads it into the element and writes exactly that form back.

| Element | Written as |
|---|---|
| Toggle (collapsible block) | `:::toggle Title` … `:::` (any blocks inside; may nest) |
| Contents | a line `[TOC]` (a live list of this note's headings) |
| Page break | a line `\newpage` (printing and the HTML export break the page there) |
| Date mention | `@date(2026-10-20)` (a chip; clicking it opens the calendar on that day) |
| Event | `Team sync @event(2026-10-20T09:00-10:30)`, or `@event(2026-10-20)` all day; listed in the calendar |
| Tick box | `☐` / `☑` in running text (not a list item; a list item is a task) |
| Formula | `$x^2$` inline, `$$` … `$$` as a block (KaTeX); "$5 and $6" stays prose |
| Diagram | a ```` ```mermaid ```` fence, shown as the diagram, source one click away |
| Voice note, recording | a link `[Voice note 14:30 · 0:42](ergo-file:<id> "audio")`; the title `audio` makes it a player |
| Inline tag | `#tag` in the text; choosing one also adds the tag to the note's tags (frontmatter stays the source of tags) |
| New linked note | an ordinary `[[id|Title]]` link to a note created beside this one |

Reading back is lossless for these shapes and tolerant otherwise: a tool that does not know a form shows the text
as written (`:::toggle …`, `@date(…)`), which is still readable.

### Recording and speech-to-text

- A **voice note** is recorded in the app (the microphone is allowed only on https or localhost), stored once as a file
  item and shown as an audio clip. It works with no AI at all.
- **Writing it out** (voice dictation, a meeting's transcript, "Transcribe media") uses *speech-to-text*: a model of a
  **custom server** that speaks OpenAI's `/audio/transcriptions` (OpenAI, Groq, a local Whisper server). OpenRouter and
  Anthropic have no such endpoint, so they cannot be chosen for it. The call is made like the chat's (ADR 0008): by a
  device itself, or by the server peer in the web build, so the key stays off the browser.
- The browser's own dictation is **not** used: it sends audio to the browser vendor, which would be a second, unannounced
  place for note content to go.
- A **voice note** records the microphone only. A **meeting recording** records the microphone *and* the sound the
  computer plays (the other people on a call): the browser's screen sharing is asked for with audio, and the two are
  mixed into one track. Where that is not offered (Safari, Firefox, most webviews, Android) the option is off and the
  microphone alone is recorded, which picks the call up if it is on the speakers. If the person cancels the share, or
  shares without sound, nothing is recorded and they are told, rather than getting a recording of one side.
- A meeting recording is a heading, the clip, a summary written by the chat model (if one is configured), and the
  transcript in a toggle. The recording is kept even when writing it out fails.
- **A private note's audio is never sent for transcription**, the same rule as for text (ADR 0008).

## Consequences

- New element, new form: it is added to this table, to the skill file agents read, and gets a round-trip check.
- `\newpage`, `[TOC]` and `:::toggle` are conventions, not standards: other renderers show them as text. They were
  chosen because they are what Pandoc, most wikis and Docusaurus-style Markdown already use.
- Audio is stored in the Vault like any attachment (25 MB per file, about 80 minutes of speech at the recorder's
  32 kbit/s); longer recordings are cut at the limit.
