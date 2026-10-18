#!/usr/bin/env node
// PreToolUse hook: keeps Claude away from the vault's own files. `.ergonotes/` (sealed history, keys, settings), `.trash/` and
// `.habits/` are not for direct writing, `.habits/` and notes marked `private: true` are not for AI at all. Notes are reached
// through the MCP tools. This is a guard rail, not a lock: a shell command can still reach a file, and a private note is
// only truly invisible through MCP.
import { closeSync, openSync, readSync } from 'node:fs';
import { normalize, resolve } from 'node:path';
import { vaultRoot } from './endpoint.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
let ev;
try { ev = JSON.parse(input); } catch { process.exit(0); }

const deny = reason => {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
};

const tool = String(ev.tool_name ?? '');
const ti = ev.tool_input ?? {};
const seg = p => p.split(/[\\/]+/).map(s => s.toLowerCase());
const hidden = ['.ergonotes', '.trash', '.habits'];
const writes = /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool);

const root = vaultRoot();
const norm = p => normalize(p).replace(/\\/g, '/').toLowerCase();
/** Where a path is relative to: the vault folder when the app has told us where it is. */
const inVault = p => !root || norm(resolve(ev.cwd ?? process.cwd(), p)).startsWith(norm(root));
/** Which of the vault's own folders a path goes through, if it is in the vault. `.trash` is only the vault's when the vault is known (other programs have one too). */
const ownFolders = p => (inVault(p) ? seg(p).filter(s => hidden.includes(s) && (root || s !== '.trash')) : []);

/** Is this a Markdown file of the vault whose frontmatter says `private: true`? Only the first 4 KB are looked at. */
function isPrivateNote(path) {
  if (!root || !inVault(path)) return false;
  try {
    const fd = openSync(resolve(ev.cwd ?? process.cwd(), path), 'r');
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, 4096, 0);
    closeSync(fd);
    const fm = /^---\n([\s\S]*?)\n---/.exec(buf.subarray(0, n).toString('utf8').replace(/\r\n/g, '\n'))?.[1] ?? '';
    return /^private:\s*true\s*$/m.test(fm);
  } catch { return false; /* not readable: let the tool report it */ }
}

const target = ti.file_path ?? ti.notebook_path ?? ti.path ?? '';
// what a search names: its folder, but also the pattern or glob, which may point into a hidden folder from anywhere
const named = [target, ti.pattern, ti.glob].filter(x => typeof x === 'string' && x).join(' ');
if (named && /^(Write|Edit|MultiEdit|NotebookEdit|Read|Grep|Glob)$/.test(tool)) {
  const patternHits = /^(Grep|Glob)$/.test(tool) ? seg(`${ti.pattern ?? ''}/${ti.glob ?? ''}`).filter(s => s === '.habits' || s === '.ergonotes') : [];
  const hit = [...new Set([...ownFolders(String(target)), ...patternHits])];
  if (hit.length) {
    if (hit.includes('.habits')) deny('Habits are private to AI: they are not for Claude to read or write. Ask the user what they need instead.');
    if (writes) deny(`${hit[0]} is Ergonotes' own folder; do not write to it. Use the Ergonotes MCP tools for notes (create_note, append_to_note, ...).`);
    if (hit.includes('.ergonotes')) deny('.ergonotes/ is sealed (history, keys, AI settings): it is not for Claude to read. Use the Ergonotes MCP tools.');
  }
  // a note the user marked private must not be read straight from its file
  if (tool === 'Read' && /\.(md|markdown)$/i.test(String(target)) && isPrivateNote(String(target))) deny('This note is marked private, so it is not for AI. Do not read it.');
}

if (tool === 'Bash') {
  const cmd = String(ti.command ?? '');
  const names = hidden.filter(h => cmd.toLowerCase().includes(h));
  if (names.length) {
    const change = /(^|[\s;&|(])(rm|mv|cp|rsync|tee|truncate|dd|touch|mkdir|chmod|ln|install)\b|sed\s+(-[a-z]*i|--in-place)|>>?\s*\S*\.(ergonotes|trash|habits)|git\s+(rm|mv|clean|checkout|restore|reset)/i.test(cmd);
    if (names.includes('.habits')) deny('Habits are private to AI: they are not for Claude to read or change from a shell.');
    if (change) deny(`${names[0]} is Ergonotes' own folder; do not change it from a shell. Use the Ergonotes MCP tools for notes.`);
  }
  // a command that names a private note's file
  for (const m of cmd.matchAll(/[^\s"'`;|&<>()]+\.(?:md|markdown)\b/gi)) if (isPrivateNote(m[0])) deny('That command opens a note marked private, so it is not for AI.');
}
process.exit(0);
