// Finding the vault of a note and the notes in it (VS Code side).
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { posix, titleOf, type NoteRef, habitOf, isHabitFile } from './notes';

export interface VaultRoot { fsPath: string }

const hasMarker = (dir: string) => { try { return fs.statSync(path.join(dir, '.ergonotes')).isDirectory(); } catch { return false; } };

/** The folder of the vault a file belongs to: the nearest one up the path that has `.ergonotes/`, else the workspace folder it is in. */
export function vaultRootFor(uri: vscode.Uri): VaultRoot | null {
  if (uri.scheme !== 'file') return null;
  let dir = path.dirname(uri.fsPath);
  for (;;) {
    if (hasMarker(dir)) return { fsPath: dir };
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const ws = vscode.workspace.getWorkspaceFolder(uri);
  return ws ? { fsPath: ws.uri.fsPath } : null;
}

/** `Projects/Plan.md`: where a file is, from the vault root. */
export const relToRoot = (root: VaultRoot, uri: vscode.Uri) => posix(path.relative(root.fsPath, uri.fsPath));

const SKIP = '**/{node_modules,.ergonotes,.trash,.git,.obsidian}/**';

export async function noteRefs(root: VaultRoot): Promise<NoteRef[]> {
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(root.fsPath, '**/*.md'), SKIP, 5000);
  return files.map(f => { const p = relToRoot(root, f); return { title: titleOf(p), path: p }; });
}

/** The Habits: the files of `.habits/` whose frontmatter says `habit: true` (ADR 0014). */
export async function habitFiles(root: VaultRoot): Promise<NoteRef[]> {
  const out: NoteRef[] = [];
  for (const n of (await noteRefs(root)).filter(r => isHabitFile(r.path))) {
    try {
      const head = fs.readFileSync(path.join(root.fsPath, n.path), 'utf8').slice(0, 2000);
      if (/^---\r?\n[\s\S]*?\bhabit:\s*true\b/.test(head) && habitOf(head + '\n---\n', '2000-01-01')) out.push(n);
    } catch { /* unreadable: not offered */ }
  }
  return out;
}
