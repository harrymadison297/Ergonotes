# A record is a folder of audio, frames and transcript, kept as it is recorded

Replaces the "Recording and speech-to-text" part of ADR 0009 (the single clip with a transcript pasted into the note).
ADR 0008 (private notes never leave) and ADR 0010 (the vault is a folder) stand.

A lecture or a call is more than one clip: the other people talk, a presenter shows slides, and the person wants to
come back to "the slide at 23:10" and read what was said around it. A **record** is one folder in the Vault that holds
everything of one recording, and a note links to it with one line.

## Decision

Two kinds of record, one form:

| | Recording | Meeting |
|---|---|---|
| Kept | audio + transcript | audio + frames (pictures of the shared screen) + transcript |
| Needs screen sharing | no | **yes**; without the share nothing is recorded |
| Frames | none | on by default, can be turned off; the share is still needed for the call's sound |
| Where it can be made | any device with a microphone | web in Chromium and the Windows app; elsewhere a record can only be played |

### Form in a note

`[Meeting 19 Mar 12:34 · 52:10](attachments/record_20260319_123410 "type_record")`: the link points at a **directory**;
the title `type_record` makes the Ergonotes editor show the player. Other tools see a link to a folder. The older
`[Voice note](attachments/x.webm "audio")` clip keeps working and keeps its small player.

### The folder

```
attachments/record_20260319_123410/
  audio.webm                 one Opus track (24 kbit/s, mono); during recording audio-001.webm, audio-002.webm … (10 min each)
  frames/000012.jpg          a picture; the name is the second from the start (6 digits)
  transcript.txt             text, one block per minute, editable by hand
  record.json                what the player needs and nothing else
```

- `transcript.txt` is `[m:ss]` on its own line followed by what was said until the next mark, a mark per minute (`[65:00]`
  after 65 minutes). A person may edit the words; the marks are what the player reads. It is a `.txt`, not `.md`, so it
  is an attachment and not a second Note in the Vault (ADR 0010: every `.md` is a note).
- `record.json`: `{ version, kind: "recording" | "meeting", startedAt, seconds, parts, mime, frames: { "<second>": "user" | "auto" }, state: "recording" | "done" }`.
  A folder whose `state` is `recording` was cut short (the app died): it is shown as incomplete and still plays.
- The folder name is the recording device's local time; the second in a frame's name is what the player trusts.

### Recording

- **Written as it happens.** The folder and the link exist from the moment recording starts; each audio part and each
  frame is written to the Vault when it is complete. If the app dies, what had been written is there.
- **Audio** is one continuous recording, without a gap. Every 10 minutes what it has produced is written as a part
  (so little is lost if the app dies), and once recording stops the parts are joined into one `audio.webm`: the Opus
  packets are re-wrapped, not re-encoded, and given a length and a clock so the file can be sought. If joining fails
  the parts are kept and played in order.
- **Frames** are taken every 1, 2 or 5 seconds (the person chooses), or by a button, from the shared screen as a JPEG of
  at most 1280 px on the long side. While recording, a frame that is practically the same as the last one kept is
  dropped on the device; the button's frames are always kept.
- **Filtering after the fact.** A **Filter** button, pressed by the person, does a stricter local pass and asks the
  person's vision model which of the remaining frames to cut. The answer is `keep` or `cut` per frame, nothing else. The
  frames to cut are shown to the person, who can change them; **nothing is deleted until the person confirms**. Without a
  vision model the stricter local pass is all it does, and it says so.
- **Transcript** is made after stopping (or later, by a button) from the audio, sent in windows of 10 minutes (each far
  below a server's 25 MB) through the speech-to-text of ADR 0009. Segments with times are asked for (`verbose_json`); a
  window whose answer has no times is sent again in one-minute pieces so the marks stay right. A failed transcript
  never loses the record.
- **Summary** is a button on the record: the chat model writes it from the transcript (never from frames) as ordinary
  text under the link in the note, where it can be edited.

### Limits and failure

- A file of the Vault may be up to **100 MB** (was 25 MB). Records never come near it; a transcription server still takes
  25 MB per request, which one 10-minute window is far below.
- If the share or the microphone ends, the record stops there and what was captured is kept, with a message. A meeting is
  never continued with half of it.
- **A recording is a process of the app, not of the note.** It goes on when another note is opened. While it runs, a
  panel takes the place of the note list (clock, level, the pictures kept so far, Capture, Pause, Stop, throw away; "Show
  notes" brings the list back with a thin bar); where no list is on screen (home, a phone, a very narrow window) a small
  floating bar does the same. Closing the window asks first.
- A meeting needs the shared screen, not a microphone: with none (or a refused one) it goes on with the shared sound and
  says so once. A recording without a microphone does not start, and says so once.

### Lifecycle

- A note in the Trash takes the records it shows with it (unless another note still shows them) and brings them back
  when restored; deleting the note for good removes them with it. Deleting only the link leaves the folder, which is
  then listed in the Files page, tab **Records**, as a record without a note, to be removed by hand.
- Each file of the folder is an ordinary attachment item (ADR 0010): it syncs file by file.
- What was said is part of what the note is found by (search), and the assistant and MCP agents read it with
  `read_record`; both follow ADR 0008: a private note's record is not found, not read and never transcribed or sent for
  filtering. An exported note keeps the record's name and its transcript as a toggle.

### Private notes

A record in a private note keeps audio and frames on the device. No transcript, no model-assisted filter (the
stricter local pass still works), no summary.

## Consequences

- The Insert menu has two entries, **Recording** and **Meeting**, replacing "Voice note" and "Meeting recording"; dictation
  (speech written into the text at the cursor) is unchanged.
- A record is many items (a 90-minute lecture may have 100–300 frames). Dropping near-identical frames while capturing is
  therefore part of the design, not an optimisation.
- Platforms that cannot share a screen can still record audio and play any record; the meeting entry is not offered there.
- Everything the player shows can be rebuilt from the folder: frames by file name, transcript by marks, `record.json`
  only caches facts that are expensive to find (duration, which frames the person took).
