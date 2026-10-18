---
name: attachments
description: How images, PDFs, spreadsheets, audio and recordings are attached to notes in the user's Ergonotes vault and referenced from the text, and what can and cannot be done through the tools. Use when the user asks to add, embed, link or caption a file, image or recording in a note, or asks where an attachment is.
argument-hint: "[file or note]"
---

# Attachments

An **attachment** is a file in the vault, normally under `attachments/`, shown or linked from a note with a standard
Markdown reference. The tools work on notes, not on files.

## What you can do

- **Reference an attachment that exists.** Use the path as the note already writes it (read the note to see references and the folder it sits in).
  - Image: `![Quarterly chart](attachments/chart.png)`
  - File: `[Contract.pdf](attachments/Contract.pdf)`
  - Short clip: `[Voice note 0:05](attachments/note.webm "audio")`
  - Recording or meeting: `[Meeting 2026-10-20 09:00](attachments/record_20261020_090000 "type_record")`
- **Write around it**: a caption, a description, alt text, a heading for it, the minutes of a recording (`meeting`).
- **Move a reference** inside a note, or to another note, with `replace_text`, `append_to_note`, `insert_after_heading`.
- **Read a recording's transcript** with `read_record`.

## What you cannot do

You have no tool to add, rename, move, transcribe or delete files. Do not try to put files into `attachments/` by writing to
the vault folder. Tell the user to add the file in the app (the Insert menu → Image or File, or drag it into the note, or paste
an image); once it is in the note you can edit the text around it.

## Writing the reference

- **Alt text is mandatory** for images: say what the image shows ("Bar chart of visits by month, rising from 1,204 to 1,590"), not "image".
- Put a short caption line under an image when it needs one, in italics.
- The path is relative to the vault's root (`attachments/…`) as the app writes it. Do not turn it into an absolute path or a URL.
- Do not rename a file in a reference; the file name must match the file.
- Keep a `"type_record"` or `"audio"` title exactly: it tells the app how to show the item.

## Limits worth telling the user

- A file over 100 MB stays in the folder and can be opened, but it does not sync.
- Pictures taken from a shared screen during a meeting are in the record's folder; you cannot see them.

## Do not

- Do not delete or replace an attachment's reference to "clean up".
- Do not embed a drawing by hand; see `drawing`.
- Do not paste the contents of a file (a PDF's text) into a note unless asked; link it.
