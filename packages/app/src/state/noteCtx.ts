// Where the open note lives. Editor node views sit outside the app's React providers (see appRef) and a
// relative link or image source only means something next to the note that holds it.
import { dirname, joinPath, normalizePath, relativePath, encodeDest } from '@ergonotes/core';

let dir = '';
export const setNoteDir = (notePath: string) => { dir = dirname(notePath); };
export const noteDir = (): string => dir;

const SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i;
const dec = (s: string) => { try { return decodeURI(s); } catch { return s; } };

/** Vault paths a link or image `src` written in the open note can mean: next to the note first, then from the vault root. */
export function vaultPathsOf(src: string): string[] {
  if (!src || SCHEME.test(src)) return [];
  const raw = dec(src.replace(/[#?].*$/, ''));
  const out: string[] = [];
  const rel = raw.startsWith('/') ? normalizePath(raw.slice(1)) : normalizePath(joinPath(dir, raw));
  if (rel) out.push(rel);
  const root = normalizePath(raw);
  if (root && root !== rel) out.push(root);
  return out;
}

/** How a note in the open note's folder writes a link to `vaultPath`. */
export const linkTo = (vaultPath: string): string => encodeDest(relativePath(dir, vaultPath));
