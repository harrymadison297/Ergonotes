// The note tools, shared by the in-app chat agent and the MCP endpoint. Private notes are invisible here.
import type { ItemSummary, NoteDoc, VaultApi } from '../api.ts';
import type { AgentTool } from './agent.ts';
import { recordDirsIn } from '../recordlink.ts';

export type ToolVault = Pick<VaultApi,
  'search' | 'listItems' | 'getNote' | 'getRecord' | 'createNote' | 'saveNote' | 'rename' | 'move' | 'setTags' | 'tasks' | 'toggleTask' | 'dailyNote'>;

/** How a note is read and written by the edit tools. The chat puts a review step in `write`; MCP writes directly. */
export interface NoteIO {
  /** the note as the next edit should see it (including edits not accepted yet) */
  read(id: string): Promise<{ id: string; title: string; body: string } | null>;
  write(id: string, patch: { title?: string; body?: string }): Promise<string>;
}

export type ToolScope =
  | { kind: 'vault' }
  /** the open note, plus notes the person attached to the conversation */
  | { kind: 'note'; noteId: string | null; allow?: string[] };

export interface ToolContext {
  vault: ToolVault;
  scope: ToolScope;
  io?: NoteIO;
  /** answer only: no tool that creates or changes anything */
  readOnly?: boolean;
  /** tools only the host can provide (the app adds insert_diagram) */
  extra?: AgentTool[];
}

const str = { type: 'string' };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

const brief = (i: ItemSummary) => ({ id: i.id, title: i.title, snippet: i.snippet, tags: i.tags, updated: i.updated, folder: i.parent });
const visible = (i: ItemSummary) => !i.private;
const NOT_FOUND = 'Note not found';

export function directIO(vault: ToolVault): NoteIO {
  return {
    read: async id => {
      const n = await vault.getNote(id);
      return n && !n.private && n.type === 'note' ? { id: n.id, title: n.title, body: n.body } : null;
    },
    write: async (id, patch) => { await vault.saveNote(id, patch); return 'Updated.'; },
  };
}

/** Start of the section a heading opens, and its end (the next heading of the same or a higher level). */
export function sectionRange(body: string, heading: string): { start: number; end: number } | null {
  const lines = body.split('\n');
  const want = heading.replace(/^#+\s*/, '').trim().toLowerCase();
  let fence = false;
  let found = -1, level = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) fence = !fence;
    if (fence) continue;
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
    if (!m) continue;
    if (found < 0 && m[2].trim().toLowerCase() === want) { found = i; level = m[1].length; continue; }
    if (found >= 0 && m[1].length <= level) return { start: found, end: i };
  }
  return found >= 0 ? { start: found, end: lines.length } : null;
}

export function buildTools(ctx: ToolContext): AgentTool[] {
  const { vault, scope } = ctx;
  const io = ctx.io ?? directIO(vault);
  const whole = scope.kind === 'vault';
  const current = scope.kind === 'note' ? scope.noteId : null;
  const allowed = new Set(scope.kind === 'note' ? scope.allow ?? [] : []);
  const json = (o: unknown) => JSON.stringify(o, null, 2);

  /** Note id of a call: explicit, or the open note when the chat is limited to it. */
  const target = (a: Record<string, unknown>): string => {
    const id = typeof a.id === 'string' && a.id ? a.id : current;
    if (!id) throw new Error('Give the id of the note.');
    if (!whole && id !== current && !allowed.has(id)) throw new Error(NOT_FOUND);
    return id;
  };
  const readOrThrow = async (id: string) => {
    const n = await io.read(id);
    if (!n) throw new Error(NOT_FOUND);
    return n;
  };
  const hiddenIds = async () => new Set((await vault.listItems()).filter(i => i.private).map(i => i.id));
  const idArg = { id: { ...str, description: 'Note id. Optional when a note is open.' } };

  const all: (AgentTool & { vaultOnly?: boolean; write?: boolean })[] = [
    {
      vaultOnly: true,
      spec: {
        name: 'search_notes',
        description: 'Full-text search over note titles, text and tags. Optional filters narrow it (or replace the query): `folder` (a folder id from list_folders, subfolders included), `tag` (a tag, or a parent such as "work" for "work/acme"), `since` / `until` (YYYY-MM-DD, on the day the note last changed). At most `limit` results (default 20, up to 50).',
        parameters: obj({
          query: { ...str, description: 'Words to look for. May be empty when a filter is given.' },
          folder: str, tag: str, since: str, until: str, limit: { type: 'number' },
        }),
      },
      run: async a => {
        const query = String(a.query ?? '').trim();
        const folder = a.folder ? String(a.folder) : '';
        const tag = a.tag ? String(a.tag).replace(/^#/, '').toLowerCase() : '';
        const since = a.since ? String(a.since) : '';
        const until = a.until ? String(a.until) : '';
        if (!query && !folder && !tag && !since && !until) throw new Error('Give a query, or at least one filter (folder, tag, since, until).');
        const items = await vault.listItems();
        const inFolder = folder ? descendantsOf(items, folder) : null;
        const pool = query ? await vault.search(query) : items.filter(i => !i.template).sort((x, y) => y.updated.localeCompare(x.updated));
        return json(pool
          .filter(i => i.type === 'note' && !i.inTrash && visible(i))
          .filter(i => !inFolder || (i.parent !== null && inFolder.has(i.parent)))
          .filter(i => !tag || i.tags.some(t => t.toLowerCase() === tag || t.toLowerCase().startsWith(`${tag}/`)))
          .filter(i => !since || i.updated.slice(0, 10) >= since)
          .filter(i => !until || i.updated.slice(0, 10) <= until)
          .slice(0, Math.min(Math.max(Number(a.limit ?? 20) || 20, 1), 50)).map(brief));
      },
    },
    {
      vaultOnly: true,
      spec: { name: 'list_recent', description: 'The most recently changed notes.', parameters: obj({ limit: { type: 'number' } }) },
      run: async a => json((await vault.listItems()).filter(i => i.type === 'note' && !i.inTrash && !i.template && visible(i))
        .sort((x, y) => y.updated.localeCompare(x.updated)).slice(0, Math.min(Number(a.limit ?? 10), 50)).map(brief)),
    },
    {
      spec: {
        name: 'read_note',
        description: 'Read one note as Markdown, with its folder path, tags and backlinks (get_links also gives the notes it links to). Give `heading` to read only the section under that heading (cheaper for a long note).',
        parameters: obj({ ...idArg, heading: { ...str, description: 'Heading text without the #. Optional.' } }),
      },
      run: async a => {
        const id = target(a);
        const n = ctx.io ? await readOrThrow(id) : null;
        const doc: NoteDoc | null = await vault.getNote(id);
        if (!doc || doc.private || doc.type !== 'note') throw new Error(NOT_FOUND);
        let body = n?.body ?? doc.body;
        let section: string | undefined;
        if (a.heading) {
          const r = sectionRange(body, String(a.heading));
          if (!r) throw new Error(`No heading "${String(a.heading)}". Headings in this note: ${sectionHeadings(body).join(' | ') || '(none)'}.`);
          body = body.split('\n').slice(r.start, r.end).join('\n');
          section = String(a.heading);
        }
        const hidden = await hiddenIds();
        return json({
          id: doc.id, title: n?.title ?? doc.title, folder: doc.path.map(p => p.title).join(' / '), tags: doc.tags, updated: doc.updated,
          ...(section ? { section } : {}), body, backlinks: doc.backlinks.filter(b => !hidden.has(b.id)),
        });
      },
    },
    {
      spec: { name: 'read_record', description: 'Read the transcript (one block per minute, with its time mark) of the recordings and meetings a note shows, and how long and how many frames each has.', parameters: obj(idArg) },
      run: async a => {
        const doc: NoteDoc | null = await vault.getNote(target(a));
        if (!doc || doc.private || doc.type !== 'note') throw new Error(NOT_FOUND);
        const out: { record: string; kind: string; seconds: number; frames: number; transcript: string }[] = [];
        for (const dir of recordDirsIn(doc.body, doc.filePath)) {
          const r = await vault.getRecord(dir);
          if (!r) continue;
          out.push({ record: r.path, kind: r.meta?.kind ?? 'recording', seconds: r.meta?.seconds ?? 0, frames: r.frames.length, transcript: (r.transcript ?? '(no transcript yet)').slice(0, 60_000) });
        }
        return out.length ? json(out) : 'This note shows no recordings.';
      },
    },
    {
      write: true,
      spec: { name: 'create_note', description: 'Create a NEW note (in the Inbox unless a folder id is given). Use it only when the user asks for a new or separate note, or when no note is open. To write into an existing note use append_to_note, insert_after_heading or replace_text.', parameters: obj({ title: str, body: { ...str, description: 'Markdown' }, folder: str, tags: { type: 'array', items: str } }, ['title']) },
      run: async a => {
        const title = String(a.title);
        const same = (await vault.listItems()).filter(i => i.type === 'note' && !i.inTrash && !i.template && !i.private && i.title.trim().toLowerCase() === title.trim().toLowerCase());
        const n = await vault.createNote({ title, body: String(a.body ?? ''), parent: whole && a.folder ? String(a.folder) : undefined, tags: Array.isArray(a.tags) ? a.tags.map(String) : undefined });
        return json({
          id: n.id, title: n.title,
          ...(same.length ? { warning: `A note titled "${same[0].title}" already exists (id ${same[0].id}). Read it, and append to it if this is the same subject; the new note was still created.` } : {}),
        });
      },
    },
    {
      write: true,
      spec: { name: 'append_to_note', description: 'Append Markdown to the end of an existing note.', parameters: obj({ ...idArg, text: str }, ['text']) },
      run: async a => {
        const id = target(a);
        const n = await readOrThrow(id);
        return io.write(id, { body: `${n.body.replace(/\s+$/, '')}\n\n${String(a.text ?? '')}\n` });
      },
    },
    {
      write: true,
      spec: {
        name: 'replace_text',
        description: 'Replace one passage of a note with other text. `find` must match exactly one place; include enough surrounding text to be unique.',
        parameters: obj({ ...idArg, find: str, replace: str }, ['find', 'replace']),
      },
      run: async a => {
        const id = target(a);
        const n = await readOrThrow(id);
        const find = String(a.find ?? '');
        if (!find) throw new Error('`find` is empty.');
        const parts = n.body.split(find);
        if (parts.length === 1) throw new Error('That text was not found in the note. Read the note again and copy the passage exactly.');
        if (parts.length > 2) throw new Error(`That text appears ${parts.length - 1} times. Include more surrounding text so it matches once.`);
        return io.write(id, { body: parts.join(String(a.replace ?? '')) });
      },
    },
    {
      write: true,
      spec: {
        name: 'insert_after_heading',
        description: 'Add Markdown at the end of the section that a heading opens (before the next heading of the same level).',
        parameters: obj({ ...idArg, heading: { ...str, description: 'The heading text, without the #' }, markdown: str }, ['heading', 'markdown']),
      },
      run: async a => {
        const id = target(a);
        const n = await readOrThrow(id);
        const r = sectionRange(n.body, String(a.heading ?? ''));
        if (!r) throw new Error(`No heading "${String(a.heading)}". Headings in this note: ${sectionHeadings(n.body).join(' | ') || '(none)'}.`);
        const lines = n.body.split('\n');
        let end = r.end;
        while (end > r.start + 1 && lines[end - 1].trim() === '') end--;
        const tail = lines.slice(end);
        const block = String(a.markdown ?? '').replace(/\s+$/, '').split('\n');
        const item = /^\s*([-*+]|\d+[.)])\s/;
        // a list continues the list above it; anything else is a paragraph of its own
        const gap = end > r.start + 1 && item.test(lines[end - 1]) && item.test(block[0]) ? [] : [''];
        lines.splice(0, lines.length, ...lines.slice(0, end), ...gap, ...block, ...(tail.length && tail[0].trim() !== '' ? [''] : []), ...tail);
        return io.write(id, { body: lines.join('\n') });
      },
    },
    {
      write: true,
      spec: { name: 'update_note', description: 'Replace the title and/or the whole Markdown body of a note. Prefer replace_text or append_to_note for small changes.', parameters: obj({ ...idArg, title: str, body: str }) },
      run: async a => {
        const id = target(a);
        await readOrThrow(id);
        return io.write(id, { title: a.title === undefined ? undefined : String(a.title), body: a.body === undefined ? undefined : String(a.body) });
      },
    },
    {
      write: true,
      spec: { name: 'rename_note', description: 'Change the title of a note.', parameters: obj({ ...idArg, title: str }, ['title']) },
      run: async a => { const id = target(a); await readOrThrow(id); await vault.rename(id, String(a.title ?? '')); return 'Renamed.'; },
    },
    {
      write: true,
      spec: { name: 'add_tags', description: 'Add tags to a note (existing tags stay).', parameters: obj({ ...idArg, tags: { type: 'array', items: str } }, ['tags']) },
      run: async a => {
        const id = target(a);
        const n = await vault.getNote(id);
        if (!n || n.private) throw new Error(NOT_FOUND);
        await vault.setTags(id, [...new Set([...n.tags, ...(Array.isArray(a.tags) ? a.tags.map(String) : [])])]);
        return 'Tagged.';
      },
    },
    {
      vaultOnly: true,
      write: true,
      spec: { name: 'move_note', description: 'Move a note or folder into a folder (folder id from list_folders), or to the top level when `folder` is empty.', parameters: obj({ id: str, folder: str }, ['id']) },
      run: async a => {
        const n = await vault.getNote(String(a.id));
        if (!n || n.private) throw new Error(NOT_FOUND);
        await vault.move(n.id, a.folder ? String(a.folder) : null);
        return 'Moved.';
      },
    },
    {
      vaultOnly: true,
      spec: { name: 'list_tags', description: 'Every tag in use with how many notes carry it (private notes are not counted). Look here before tagging so an existing tag is reused.', parameters: obj({}) },
      run: async () => {
        const m = new Map<string, number>();
        for (const i of await vault.listItems()) {
          if (i.type !== 'note' || i.inTrash || i.template || !visible(i)) continue;
          for (const t of i.tags) m.set(t, (m.get(t) ?? 0) + 1);
        }
        return json([...m.entries()].map(([tag, notes]) => ({ tag, notes })).sort((x, y) => x.tag.localeCompare(y.tag)));
      },
    },
    {
      spec: { name: 'get_links', description: 'The notes that link to this note (`backlinks`) and the notes it links to (`links`), without reading the bodies.', parameters: obj(idArg) },
      run: async a => {
        const doc: NoteDoc | null = await vault.getNote(target(a));
        if (!doc || doc.private || doc.type !== 'note') throw new Error(NOT_FOUND);
        const hidden = await hiddenIds();
        const keep = (l: { id: string; title: string }) => !hidden.has(l.id);
        return json({ id: doc.id, title: doc.title, backlinks: doc.backlinks.filter(keep), links: doc.links.filter(keep) });
      },
    },
    {
      vaultOnly: true,
      spec: { name: 'list_folders', description: 'All folders with their ids and parents.', parameters: obj({}) },
      run: async () => {
        const items = await vault.listItems();
        // the app's own count includes private notes; an agent must not be able to tell they are there
        const shown = new Map<string, number>();
        for (const i of items) if (i.parent && !i.inTrash && visible(i)) shown.set(i.parent, (shown.get(i.parent) ?? 0) + 1);
        return json(items.filter(i => i.type === 'folder' && !i.inTrash).map(f => ({ id: f.id, title: f.title, parent: f.parent, notes: shown.get(f.id) ?? 0 })));
      },
    },
    {
      vaultOnly: true,
      spec: { name: 'list_tasks', description: 'Checklist items across all notes, with due dates.', parameters: obj({ includeDone: { type: 'boolean' } }) },
      run: async a => {
        const hidden = new Set((await vault.listItems()).filter(i => i.private).map(i => i.id));
        return json((await vault.tasks()).filter(t => !hidden.has(t.noteId) && (a.includeDone === true || !t.done))
          .map(t => ({ noteId: t.noteId, note: t.noteTitle, index: t.index, text: t.text, done: t.done, due: t.due, remind: t.remind, flag: t.flag })));
      },
    },
    {
      vaultOnly: true,
      write: true,
      spec: { name: 'complete_task', description: 'Mark a checklist item done (use noteId and index from list_tasks).', parameters: obj({ noteId: str, index: { type: 'number' } }, ['noteId', 'index']) },
      run: async a => {
        const n = await vault.getNote(String(a.noteId));
        if (!n || n.private) throw new Error(NOT_FOUND);
        await vault.toggleTask(n.id, Number(a.index), true);
        return 'Done.';
      },
    },
    {
      vaultOnly: true,
      write: true,
      spec: { name: 'daily_note', description: 'Open (creating if needed) the daily note for a date (YYYY-MM-DD).', parameters: obj({ date: str }, ['date']) },
      run: async a => {
        const d = await vault.dailyNote(String(a.date));
        if (d.private) throw new Error(NOT_FOUND);
        return json({ id: d.id, title: d.title });
      },
    },
  ];
  const own = all.filter(t => (whole || !t.vaultOnly) && !(ctx.readOnly && t.write)).map(({ vaultOnly: _v, write: _w, ...t }) => t);
  return [...own, ...(ctx.readOnly ? [] : ctx.extra ?? [])];
}

/** The folder with this id and every folder below it. */
function descendantsOf(items: ItemSummary[], folder: string): Set<string> {
  const out = new Set([folder]);
  for (let grew = true; grew;) {
    grew = false;
    for (const i of items) if (i.type === 'folder' && i.parent && out.has(i.parent) && !out.has(i.id)) { out.add(i.id); grew = true; }
  }
  return out;
}

function sectionHeadings(body: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const l of body.split('\n')) {
    if (/^```/.test(l)) fence = !fence;
    if (fence) continue;
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(l);
    if (m) out.push(m[1]);
  }
  return out;
}
