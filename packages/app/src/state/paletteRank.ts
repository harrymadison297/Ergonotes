// Which rows the search palette shows and in what order. Pure: the palette gives it rows with a group and a rank, it
// gives back the rows to list.

export type GroupName = 'Notes' | 'Recent notes' | 'Folders' | 'Tasks' | 'Tags' | 'Pages' | 'Commands';
/** Where groups sit when nothing matches one better than another. */
export const GROUP_ORDER: GroupName[] = ['Notes', 'Recent notes', 'Folders', 'Tasks', 'Tags', 'Pages', 'Commands'];

export type Mode = 'all' | 'commands' | 'tags' | 'tasks';

/** How well `text` fits what was typed (every word must be in it): 0 best, 3 not at all. */
export function fit(text: string, terms: string[]): number {
  const t = text.toLowerCase();
  if (!terms.every(w => t.includes(w))) return 3;
  if (t.startsWith(terms[0])) return 0;
  return t.split(/[\s/_-]+/).some(w => w.startsWith(terms[0])) ? 1 : 2;
}

/** The first character of the query picks a mode: `>` Commands, `#` Tags, `-` Tasks; anything else searches everything. */
export function parseQuery(q: string): { mode: Mode; query: string } {
  const mode: Mode = q.startsWith('>') ? 'commands' : q.startsWith('#') ? 'tags' : q.startsWith('-') ? 'tasks' : 'all';
  return { mode, query: (mode === 'all' ? q : q.slice(1)).trim() };
}

/**
 * Drop what does not fit, keep the best few of each group, and put the groups in order. `rank` is 0 (starts with what was
 * typed), 1 (a word does), 2 (somewhere inside) or 3 (no fit).
 */
export function arrangeRows<R extends { group: GroupName; rank: number }>(rows: R[], o: { mode: Mode; query: string; terms: string[] }): R[] {
  const { mode, query, terms } = o;
  let out = rows;
  if (terms.length) out = out.filter(r => r.rank < 3);
  // next to notes, a command, a page or a tag must begin a word with what was typed; the Commands list (">") is looser
  if (mode === 'all' && terms.length) out = out.filter(r => !['Commands', 'Pages', 'Tags'].includes(r.group) || r.rank <= 1);
  // inside a group the better fits come first; a search that finds nothing else shows the tasks and tags it did find
  const cap: Partial<Record<GroupName, number>> = mode === 'all' ? { Tasks: 5, Tags: 5, Pages: 4, Commands: 5 } : {};
  const taken: Partial<Record<GroupName, number>> = {};
  const sorted = out.map((r, i) => ({ r, i })).sort((a, b) => a.r.rank - b.r.rank || a.i - b.i).map(x => x.r);
  const kept = sorted.filter(r => { const n = (taken[r.group] ?? 0) + 1; taken[r.group] = n; return n <= (cap[r.group] ?? 50); });
  const best = (g: GroupName) => Math.min(...kept.filter(r => r.group === g).map(r => r.rank), 9);
  const groups = GROUP_ORDER.filter(g => kept.some(r => r.group === g)).sort((a, b) => (mode === 'all' && query ? best(a) - best(b) : 0) || GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
  return groups.flatMap(g => kept.filter(r => r.group === g));
}
