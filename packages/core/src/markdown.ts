import YAML from 'yaml';

export type Frontmatter = Record<string, unknown>;
export interface Doc { fm: Frontmatter; body: string }

const FM_ORDER = ['id', 'type', 'title', 'parent', 'tags', 'created', 'updated', 'template', 'folder', 'trashed', 'pinned'];

/** Split `---\nyaml\n---\nbody` into frontmatter and body. A text without frontmatter has an empty `fm`. */
export function splitDoc(text: string): Doc {
  // files written on Windows: normalise the line endings of a note that starts with CRLF frontmatter
  if (text.startsWith('---\r\n')) text = text.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { fm: {}, body: text };
  const end = text.indexOf('\n---', 4);
  if (end < 0) return { fm: {}, body: text };
  const after = text.indexOf('\n', end + 1);
  const raw = text.slice(4, end);
  let fm: Frontmatter = {};
  try {
    const parsed = YAML.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) fm = parsed as Frontmatter;
  } catch {
    return { fm: {}, body: text };
  }
  const body = after < 0 ? '' : text.slice(after + 1);
  return { fm, body };
}

export function joinDoc(fm: Frontmatter, body: string): string {
  const ordered: Frontmatter = {};
  for (const k of FM_ORDER) if (fm[k] !== undefined && fm[k] !== null) ordered[k] = fm[k];
  for (const k of Object.keys(fm).sort()) if (!(k in ordered) && fm[k] !== undefined && fm[k] !== null) ordered[k] = fm[k];
  const y = YAML.stringify(ordered, { lineWidth: 0 }).trimEnd();
  return `---\n${y}\n---\n${body}`;
}

// ---------- Ergonote fenced blocks ----------
const FENCE_OPEN = /^```ergonote-[\w-]+\s*$/;
const FENCE_CLOSE = /^```\s*$/;

/** Group body lines into merge units: each ergonote-* fenced block becomes one atomic unit. */
export function toUnits(body: string): string[] {
  const lines = body.split('\n');
  const units: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_OPEN.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && !FENCE_CLOSE.test(lines[j])) j++;
      units.push(lines.slice(i, Math.min(j + 1, lines.length)).join('\n'));
      i = j;
    } else units.push(lines[i]);
  }
  return units;
}
export const fromUnits = (units: string[]): string => units.join('\n');

// ---------- inline tokens ----------
export const WIKILINK_RE = /\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|([^\]]*)\]\]/g;

export function extractLinkIds(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(WIKILINK_RE)) ids.add(m[1]);
  return [...ids];
}

// ---------- tasks ----------
export interface Task {
  /** 0-based index among task lines of the note */
  index: number;
  /** 0-based line number within the body */
  line: number;
  done: boolean;
  text: string;
  due?: string;
  remind?: string;
  flag: boolean;
}
const TASK_RE = /^(\s*)([-*+]) \[( |x|X)\] (.*)$/;
const DUE_RE = /\s*@due\(([^)]+)\)/;
const REMIND_RE = /\s*@remind\(([^)]+)\)/;
const FLAG_RE = /\s*@flag\b/;

export function parseTasks(body: string): Task[] {
  const out: Task[] = [];
  const lines = body.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const m = TASK_RE.exec(lines[i]);
    if (!m) continue;
    let text = m[4];
    const due = DUE_RE.exec(text)?.[1];
    const remind = REMIND_RE.exec(text)?.[1];
    const flag = FLAG_RE.test(text);
    text = text.replace(DUE_RE, '').replace(REMIND_RE, '').replace(FLAG_RE, '').trim();
    out.push({ index: out.length, line: i, done: m[3] !== ' ', text, due, remind, flag });
  }
  return out;
}

export function setTaskDone(body: string, index: number, done: boolean): string {
  const t = parseTasks(body)[index];
  if (!t) return body;
  const lines = body.split('\n');
  lines[t.line] = lines[t.line].replace(/\[( |x|X)\]/, done ? '[x]' : '[ ]');
  return lines.join('\n');
}

// ---------- snippets / titles ----------
export function plainSnippet(body: string, max = 180): string {
  const s = body
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .filter(l => !/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) || !/-/.test(l))
    .map(l => (/^\s*\|.*\|\s*$/.test(l) ? l.replace(/\|/g, ' ') : l))
    .join('\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[[0-9a-f-]{36}\|([^\]]*)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/@(due|remind)\([^)]*\)|@flag\b/g, '')
    .replace(/^[#>\-*+\s]+/gm, '')
    .replace(/\[[ xX]\]\s*/g, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function firstImage(body: string): string | undefined {
  const u = /!\[[^\]]*\]\(([^)\s]+)\)/.exec(body)?.[1];
  return u && !u.startsWith('data:') ? u : undefined;
}
