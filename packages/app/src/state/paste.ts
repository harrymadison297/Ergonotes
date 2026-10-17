// What a paste carries that is a file: a screenshot or picture, or a file copied in a file manager.

/** The parts of a DataTransfer this reads (a paste's `clipboardData`). */
export interface PastedData {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<{ kind: string; getAsFile(): File | null }> | null;
  getData?(type: string): string;
}

/**
 * The files to attach for a paste, or none when the paste is for the text.
 * A picture is always taken (as it always was). Any other file is taken only when the paste has no text with it, so
 * text copied from a spreadsheet or a web page, which some programs send with a file next to it, stays text.
 */
export function pastedFiles(dt: PastedData | null | undefined): File[] {
  if (!dt) return [];
  let files = Array.from(dt.files ?? []);
  if (files.length === 0) files = Array.from(dt.items ?? []).filter(i => i.kind === 'file').map(i => i.getAsFile()).filter((f): f is File => !!f);
  const pictures = files.filter(f => f.type.startsWith('image/'));
  if (pictures.length) return pictures;
  if (files.length && (dt.getData?.('text/plain') ?? '') === '' && (dt.getData?.('text/html') ?? '') === '') return files;
  return [];
}
