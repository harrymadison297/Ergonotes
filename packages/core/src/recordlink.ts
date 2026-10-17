// How a note points at a record (ADR 0011): `[label](attachments/record_… "type_record")`. Writing the link, finding the
// records a note shows and taking one out again are all here, so the vault, the assistant's tools and the editor agree
// on what counts as a record link.
import { dirname, findLinks, linkTargets, type LinkRef } from './folder.ts';
import { RECORD_LINK_TITLE, isRecordDir } from './record.ts';

/** The link a note holds for a record; `dest` is the destination as it is written (already escaped). */
export const recordLinkMarkdown = (label: string, dest: string): string =>
  `[${label.replace(/[\[\]\n]/g, ' ')}](${dest} "${RECORD_LINK_TITLE}")`;

/** The record folder (a vault path) one link of the note at `notePath` shows, or null when it is not a record link. */
export function recordDirOfLink(ref: LinkRef, notePath: string): string | null {
  if (ref.kind !== 'md' || ref.title.trim().replace(/^["']|["']$/g, '') !== RECORD_LINK_TITLE) return null;
  return linkTargets(dirname(notePath), ref.target).find(isRecordDir) ?? null;
}

/** The record folders a note shows, each once, in the order they appear. */
export function recordDirsIn(body: string | readonly LinkRef[], notePath: string): string[] {
  const out = new Set<string>();
  for (const ref of typeof body === 'string' ? findLinks(body) : body) {
    const dir = recordDirOfLink(ref, notePath);
    if (dir) out.add(dir);
  }
  return [...out];
}

/** The note text without its link(s) to the record `dir`. A link alone on its line takes the line with it. */
export function removeRecordLink(body: string, notePath: string, dir: string): string {
  const refs = findLinks(body).filter(r => recordDirOfLink(r, notePath) === dir);
  let out = body;
  for (const r of refs.reverse()) {
    let s = r.start;
    let e = r.end;
    const lineStart = out.lastIndexOf('\n', s - 1) + 1;
    let lineEnd = out.indexOf('\n', e);
    if (lineEnd < 0) lineEnd = out.length;
    if (out.slice(lineStart, s).trim() === '' && out.slice(e, lineEnd).trim() === '') { s = lineStart; e = Math.min(lineEnd + 1, out.length); }
    out = out.slice(0, s) + out.slice(e);
  }
  return out;
}
