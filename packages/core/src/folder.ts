// Pure functions for a vault that is a folder of Markdown files (ADR 0010): file text <-> database text,
// surgical frontmatter edits, safe file names, standard links and byte-for-byte block preservation.
import YAML from 'yaml';
import { sha256hex } from './util.ts';

export type Fm = Record<string, unknown>;

// ---------- paths (always `/`, relative to the vault root, no leading slash) ----------
export const dirname = (p: string): string => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
export const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
export const joinPath = (...parts: string[]): string => parts.filter(Boolean).join('/');
export const stripExt = (n: string): string => n.replace(/\.(md|markdown)$/i, '');
export const isNotePath = (p: string): boolean => /\.(md|markdown)$/i.test(p);
export const titleOfPath = (p: string): string => stripExt(basename(p));
export const extOf = (p: string): string => { const m = /\.[^./]+$/.exec(basename(p)); return m ? m[0].toLowerCase() : ''; };

/** Collapse `.` and `..`; returns null when the path leaves the vault. */
export function normalizePath(p: string): string | null {
  const out: string[] = [];
  for (const s of p.replace(/\\/g, '/').split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') { if (!out.length) return null; out.pop(); } else out.push(s);
  }
  return out.join('/');
}

/** `to` written relative to the folder `fromDir`. */
export function relativePath(fromDir: string, to: string): string {
  const a = fromDir ? fromDir.split('/') : [];
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

/** A folder's id: the same path always gives the same id, so folders need no stored identity. */
export function folderIdOf(path: string): string {
  const h = sha256hex(`ergonotes-folder:${path.toLowerCase()}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---------- file names ----------
const WIN_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** A title as a file name that is valid on Windows, macOS and Linux. */
export function safeName(title: string, max = 120): string {
  let s = title.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[.\s-]+/, '').replace(/[.\s]+$/, '');
  if (WIN_RESERVED.test(s)) s = `${s}_`;
  if (s.length > max) s = s.slice(0, max).trim();
  return s || 'Untitled';
}

/** `Name.md`, then `Name 2.md`, `Name 3.md`...; `taken` compares case-insensitively (Windows, macOS). */
export function uniquePath(dir: string, name: string, ext: string, taken: (lowerPath: string) => boolean): string {
  const make = (n: string) => joinPath(dir, n + ext);
  let p = make(name);
  for (let i = 2; taken(p.toLowerCase()); i++) p = make(`${name} ${i}`);
  return p;
}

// ---------- the file as text ----------
export interface FileMeta { eol: 'lf' | 'crlf'; bom: boolean }

/** Decode a file's text for the database: no byte order mark, `\n` line ends, and what was removed. */
export function normalizeFileText(raw: string): { text: string; meta: FileMeta } {
  const bom = raw.charCodeAt(0) === 0xfeff;
  let t = bom ? raw.slice(1) : raw;
  const crlf = (t.match(/\r\n/g) ?? []).length;
  const lf = (t.match(/\n/g) ?? []).length - crlf;
  const eol = crlf > lf ? 'crlf' : 'lf';
  if (crlf) t = t.replace(/\r\n/g, '\n');
  return { text: t, meta: { eol, bom } };
}

export function denormalizeFileText(text: string, meta: Partial<FileMeta>): string {
  const t = meta.eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
  return meta.bom ? '﻿' + t : t;
}

// ---------- frontmatter ----------
const FM_RE = /^---[ \t]*\n(?:([\s\S]*?)\n)?(?:---|\.\.\.)[ \t]*(?:\n|$)/;

export interface FmBlock { raw: string; end: number }
/** The frontmatter block of an LF text: the YAML between the fences and where the body starts. */
export function locateFm(text: string): FmBlock | null {
  const m = FM_RE.exec(text);
  return m ? { raw: m[1] ?? '', end: m[0].length } : null;
}

export interface ParsedNote { fm: Fm; body: string; hasFm: boolean; /** frontmatter present but unreadable: never edited */ broken: boolean }

export function parseNote(text: string): ParsedNote {
  const b = locateFm(text);
  if (!b) return { fm: {}, body: text, hasFm: false, broken: false };
  try {
    const v = YAML.parse(b.raw);
    if (v === null || v === undefined) return { fm: {}, body: text.slice(b.end), hasFm: true, broken: false };
    if (typeof v === 'object' && !Array.isArray(v)) return { fm: v as Fm, body: text.slice(b.end), hasFm: true, broken: false };
  } catch { /* fall through */ }
  return { fm: {}, body: text, hasFm: true, broken: true };
}

/** User properties only: the reserved `_ergo_*` keys are never exposed. */
export function userFm(fm: Fm): Fm {
  const o: Fm = {};
  for (const [k, v] of Object.entries(fm)) if (!k.startsWith('_ergo_')) o[k] = v;
  return o;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Change some properties of a note's frontmatter and nothing else: key order, comments, quoting and the body
 * stay as they were. `undefined` removes a key. A text whose frontmatter cannot be read is returned untouched.
 */
export function editFm(text: string, edits: Fm, o: { top?: string[] } = {}): string {
  const b = locateFm(text);
  if (!b) {
    const pairs = Object.entries(edits).filter(([, v]) => v !== undefined);
    if (!pairs.length) return text;
    const y = YAML.stringify(Object.fromEntries(pairs), { lineWidth: 0 }).trimEnd();
    return `---\n${y}\n---\n${text}`;
  }
  const doc = YAML.parseDocument(b.raw);
  if (doc.errors.length) return text;
  if (!doc.contents) doc.contents = doc.createNode({}) as never;
  if (!YAML.isMap(doc.contents)) return text;
  const map = doc.contents as YAML.YAMLMap;
  let changed = false;
  for (const [k, v] of Object.entries(edits)) {
    const exists = map.has(k);
    const curNode = exists ? map.get(k, true) : undefined;
    const curVal = YAML.isNode(curNode) ? (curNode as YAML.Node).toJSON() : curNode;
    if (v === undefined) {
      if (exists) { map.delete(k); changed = true; }
      continue;
    }
    if (exists && same(curVal, v)) continue;
    const node = doc.createNode(v);
    if (YAML.isSeq(curNode) && curNode.flow && YAML.isSeq(node)) node.flow = true;
    if (exists) map.set(k, node);
    else if (o.top?.includes(k)) map.items.unshift(doc.createPair(k, node));
    else map.set(k, node);
    changed = true;
  }
  if (!changed) return text;
  if (map.items.length === 0) return text.slice(b.end);
  const unindentedSeq = /^[^\s#][^:\n]*:[ \t]*\n-[ \t]/m.test(b.raw);
  const y = doc.toString({ lineWidth: 0, indentSeq: !unindentedSeq, flowCollectionPadding: false }).trimEnd();
  return `---\n${y}\n---\n${text.slice(b.end)}`;
}

/** Replace everything after the frontmatter. */
export function withBody(text: string, body: string): string {
  const b = locateFm(text);
  return (b ? text.slice(0, b.end) : '') + body;
}

// ---------- reserved keys: how a note's database text differs from its file ----------
const isReservedLine = (l: string) => /^_ergo_[A-Za-z0-9_]+:/.test(l);

export function reservedOf(text: string): Record<string, unknown> {
  const b = locateFm(text);
  const out: Record<string, unknown> = {};
  if (!b) return out;
  for (const line of b.raw.split('\n')) {
    const m = /^(_ergo_[A-Za-z0-9_]+):[ \t]*(.*)$/.exec(line);
    if (!m) continue;
    try { out[m[1]] = JSON.parse(m[2]); } catch { out[m[1]] = m[2]; }
  }
  return out;
}

/** Set (or with `undefined` remove) reserved keys. They are single-line, JSON-valued and kept first. */
export function setReserved(text: string, kv: Record<string, unknown>): string {
  const b = locateFm(text);
  const lines = b && b.raw !== '' ? b.raw.split('\n') : [];
  const keyOf = (l: string) => l.slice(0, l.indexOf(':'));
  const kept = lines.filter(l => isReservedLine(l) && !(keyOf(l) in kv));
  const rest = lines.filter(l => !isReservedLine(l));
  const add = Object.entries(kv).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  const all = [...kept, ...add, ...rest];
  const body = b ? text.slice(b.end) : text;
  if (b && all.join('\n') === b.raw) return text;
  if (!all.length) return b ? body : text;
  return `---\n${all.join('\n')}\n---\n${body}`;
}

/** The text a Device stores for a file: the file as read, with its place in the vault recorded in reserved keys. */
export function toItemText(fileText: string, meta: { path: string; trashed?: string | null }): string {
  const { text, meta: fmeta } = normalizeFileText(fileText);
  return setReserved(text, {
    _ergo_path: meta.path,
    _ergo_trashed: meta.trashed || undefined,
    _ergo_eol: fmeta.eol === 'crlf' ? 'crlf' : undefined,
    _ergo_bom: fmeta.bom ? true : undefined,
  });
}

/** A stored text without its reserved keys, still with `\n` line ends. */
export function stripReserved(itemText: string): string {
  const b = locateFm(itemText);
  if (!b) return itemText;
  const kept = b.raw.split('\n').filter(l => !isReservedLine(l));
  const body = itemText.slice(b.end);
  // frontmatter that held only reserved keys was added by the app: the file had none
  return kept.some(l => l.trim() !== '') ? `---\n${kept.join('\n')}\n---\n${body}` : body;
}

/** The file for a stored text: reserved keys removed, original line ends and byte order mark restored. */
export function toFileText(itemText: string): string {
  const r = reservedOf(itemText);
  return denormalizeFileText(stripReserved(itemText), { eol: r._ergo_eol === 'crlf' ? 'crlf' : 'lf', bom: r._ergo_bom === true });
}

// ---------- links ----------
export interface LinkRef {
  kind: 'md' | 'wiki';
  embed: boolean;
  /** offsets of the whole link in the body */
  start: number;
  end: number;
  label: string;
  /** the destination as written, without any fragment */
  target: string;
  fragment: string;
  /** wiki only: the `|alias` including the bar, or '' */
  alias: string;
  /** md only: the optional "title" part including leading whitespace */
  title: string;
  /** md only: the destination was written in `<angle brackets>` */
  angle: boolean;
}

/** Mask fenced code and inline code so links inside them are not found. */
function maskCode(body: string): string {
  let out = '';
  let fence: string | null = null;
  for (const line of body.split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      out += ' '.repeat(line.length) + '\n';
    } else if (m) {
      fence = m[1];
      out += ' '.repeat(line.length) + '\n';
    } else out += line.replace(/(`+)[^`\n]*?\1/g, s => ' '.repeat(s.length)) + '\n';
  }
  return out.slice(0, -1);
}

const MD_LINK = /(!?)\[([^\]\n]*)\]\((<[^>\n]*>|[^()\s]*(?:\([^()\s]*\)[^()\s]*)*)((?:\s+(?:"[^"\n]*"|'[^'\n]*'))?)\)/g;
const WIKI_LINK = /(!?)\[\[([^\]\n|#^]*)((?:[#^][^\]\n|]*)?)((?:\|[^\]\n]*)?)\]\]/g;
const SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i;

export function findLinks(body: string): LinkRef[] {
  const masked = maskCode(body);
  const out: LinkRef[] = [];
  for (const m of masked.matchAll(MD_LINK)) {
    let dest = m[3];
    const angle = dest.startsWith('<');
    if (angle) dest = dest.slice(1, -1);
    if (!dest || SCHEME.test(dest)) continue;
    const h = dest.search(/[#?]/);
    out.push({
      kind: 'md', embed: m[1] === '!', start: m.index!, end: m.index! + m[0].length, label: m[2],
      target: h < 0 ? dest : dest.slice(0, h), fragment: h < 0 ? '' : dest.slice(h), alias: '', title: m[4] ?? '', angle,
    });
  }
  for (const m of masked.matchAll(WIKI_LINK)) {
    out.push({
      kind: 'wiki', embed: m[1] === '!', start: m.index!, end: m.index! + m[0].length, label: '',
      target: m[2].trim(), fragment: m[3] ?? '', alias: m[4] ?? '', title: '', angle: false,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

function decodeDest(s: string): string {
  try { return decodeURI(s); } catch { return s; }
}

/** The destination as written into Markdown: spaces, parentheses and `%` escaped, everything else left readable. */
export function encodeDest(p: string): string {
  return p.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/</g, '%3C').replace(/>/g, '%3E');
}

/** Names the links of a vault can point at: every note and attachment path, and notes by title. */
export interface LinkIndex {
  /** lower-case vault path -> actual path */
  paths: Map<string, string>;
  /** lower-case note title -> actual paths, nearest the root first */
  names: Map<string, string[]>;
  /** lower-case file name of a non-note file -> actual paths */
  files: Map<string, string[]>;
}

export function buildLinkIndex(paths: Iterable<string>): LinkIndex {
  const idx: LinkIndex = { paths: new Map(), names: new Map(), files: new Map() };
  const add = (m: Map<string, string[]>, k: string, p: string) => { const l = m.get(k) ?? []; l.push(p); l.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)); m.set(k, l); };
  for (const p of paths) {
    idx.paths.set(p.toLowerCase(), p);
    if (isNotePath(p)) add(idx.names, titleOfPath(p).toLowerCase(), p);
    else add(idx.files, basename(p).toLowerCase(), p);
  }
  return idx;
}

/** The file a link points at, as a vault path, or null when it points at nothing in the vault. */
export function resolveLink(ref: LinkRef, fromPath: string, idx: LinkIndex): string | null {
  const raw = ref.kind === 'md' ? decodeDest(ref.target) : ref.target;
  if (!raw) return null;
  const byPath = (p: string | null): string | null => {
    if (!p) return null;
    return idx.paths.get(p.toLowerCase()) ?? (isNotePath(p) ? null : idx.paths.get((p + '.md').toLowerCase()) ?? null);
  };
  if (ref.kind === 'md') {
    if (raw.startsWith('/')) return byPath(normalizePath(raw.slice(1)));
    // relative to the note's folder; as other tools do, a path from the vault root works too
    return byPath(normalizePath(joinPath(dirname(fromPath), raw))) ?? byPath(normalizePath(raw));
  }
  // wiki: a path from the vault root, or just a name (the closest folder wins, then the shortest path)
  if (raw.includes('/')) {
    const hit = byPath(normalizePath(raw));
    if (hit) return hit;
  }
  const name = (raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw).toLowerCase();
  const list = idx.names.get(stripExt(name)) ?? idx.files.get(name);
  if (!list?.length) return null;
  return list.find(p => dirname(p) === dirname(fromPath)) ?? list[0];
}

/**
 * Rewrite the links of one note after files moved or were renamed. Only the destination (and a label that was
 * the old title) is replaced; every other character of the note is untouched.
 *   fromOld / fromNew: where this note lived before / after
 *   moved: old path -> new path of every file that moved
 *   resolve: which file (old path) a link pointed at before anything moved
 */
export function rewriteLinks(
  body: string,
  o: { fromOld: string; fromNew: string; moved: Map<string, string>; resolve: (ref: LinkRef) => string | null },
): string {
  const refs = findLinks(body);
  if (!refs.length) return body;
  let out = '';
  let pos = 0;
  for (const ref of refs) {
    const target = o.resolve(ref);
    if (!target) continue;
    const next = o.moved.get(target) ?? target;
    if (next === target && o.fromOld === o.fromNew) continue;
    let text: string;
    if (ref.kind === 'md') {
      const orig = decodeDest(ref.target);
      let rel = relativePath(dirname(o.fromNew), next);
      if (!/\.(md|markdown)$/i.test(orig) && isNotePath(next)) rel = stripExt(rel);
      if (orig.startsWith('/')) rel = '/' + next;
      const dest = ref.angle ? `<${rel}>` : encodeDest(rel);
      const oldTitle = titleOfPath(target);
      const label = !ref.embed && ref.label === oldTitle && titleOfPath(next) !== oldTitle ? titleOfPath(next) : ref.label;
      text = `${ref.embed ? '!' : ''}[${label}](${dest}${ref.fragment}${ref.title})`;
      if (text === body.slice(ref.start, ref.end)) continue;
    } else {
      if (next === target) continue; // a title or a path from the root still points at the same name
      const orig = ref.target;
      let t: string;
      if (orig.includes('/')) t = isNotePath(orig) ? next : stripExt(next);
      else t = titleOfPath(next) === titleOfPath(target) ? orig : titleOfPath(next);
      if (t === orig) continue;
      text = `${ref.embed ? '!' : ''}[[${t}${ref.fragment}${ref.alias}]]`;
    }
    out += body.slice(pos, ref.start) + text;
    pos = ref.end;
  }
  return out + body.slice(pos);
}

// ---------- blocks: keep what the person did not edit ----------
export interface Block { text: string; gap: string }

/** Split Markdown into top-level blocks; `text + gap` of all blocks, joined, is exactly the input. */
export function splitBlocks(md: string): Block[] {
  const lines = md.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const start = i;
    let fence: string | null = null;
    let math = false;
    // a block is a run of non-blank lines; a code fence or a $$ pair may contain blank lines
    while (i < lines.length) {
      const l = lines[i];
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
      if (fence) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(l)) fence = null;
      } else if (math) {
        if (/^\s*\$\$\s*$/.test(l)) math = false;
      } else if (f) fence = f[1];
      else if (/^\s*\$\$\s*$/.test(l)) math = true;
      else if (l.trim() === '') break;
      i++;
    }
    const textEnd = i;
    while (i < lines.length && lines[i].trim() === '') i++;
    const text = lines.slice(start, textEnd).join('\n');
    const raw = lines.slice(start, i).join('\n') + (i < lines.length ? '\n' : '');
    blocks.push({ text, gap: raw.slice(text.length) });
  }
  return blocks;
}

export const joinBlocks = (bs: Block[]): string => bs.map(b => b.text + b.gap).join('');

/** Longest common subsequence of two string arrays: pairs of matching indexes. */
function lcs(a: string[], b: string[]): [number, number][] {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const out: [number, number][] = [];
  for (let k = 0; k < s; k++) out.push([k, k]);
  const n = ea - s, m = eb - s;
  if (n > 0 && m > 0) {
    const w = m + 1;
    const t = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = a[s + i] === b[s + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[s + i] === b[s + j]) { out.push([s + i, s + j]); i++; j++; }
      else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++;
      else j++;
    }
  }
  for (let k = 0; k < a.length - ea; k++) out.push([ea + k, eb + k]);
  return out;
}

/**
 * Save without disturbing what was not edited.
 *   oldRaw   the body as it is in the file
 *   oldNorm  what the editor produced from oldRaw immediately after loading it (unedited)
 *   newMd    what the editor produces now
 * Every block of newMd that equals a block of oldNorm is replaced by the matching block of oldRaw.
 */
export function preserveBlocks(oldRaw: string, oldNorm: string, newMd: string): string {
  if (newMd === oldRaw) return oldRaw;
  const R = splitBlocks(oldRaw);
  const N = splitBlocks(oldNorm);
  const W = splitBlocks(newMd);
  const pairs = R.length === N.length
    ? lcs(N.map(b => b.text), W.map(b => b.text))
    : lcs(R.map(b => b.text), W.map(b => b.text)); // the editor merged or split blocks: only exact matches survive
  const rawFor = new Map<number, number>(pairs.map(([i, j]) => [j, i]));
  const out: Block[] = W.map((w, j) => {
    const i = rawFor.get(j);
    if (i === undefined) return w;
    const r = R[i];
    // keep the old spacing, but never glue a block to the one after it
    const lastOld = i === R.length - 1, lastNew = j === W.length - 1;
    return { text: r.text, gap: lastOld === lastNew ? r.gap : w.gap };
  });
  return joinBlocks(out);
}
