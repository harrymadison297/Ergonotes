// Where the open note lives. Editor node views sit outside the app's React providers (see appRef) and a
// relative link or image source only means something next to the note that holds it.
import { dirname, linkTargets, relativePath, encodeDest } from '@ergonotes/core';

let dir = '';
export const setNoteDir = (notePath: string) => { dir = dirname(notePath); };
export const noteDir = (): string => dir;

/** Vault paths a link or image `src` written in the open note can mean: next to the note first, then from the vault root. */
export const vaultPathsOf = (src: string): string[] => linkTargets(dir, src);

/** How a note in the open note's folder writes a link to `vaultPath`. */
export const linkTo = (vaultPath: string): string => encodeDest(relativePath(dir, vaultPath));
