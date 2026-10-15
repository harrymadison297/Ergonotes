// The note tools, shared by the in-app chat agent and the MCP endpoint. Private notes are invisible here.
import type { ItemSummary, NoteDoc, VaultApi } from '../api.ts';
import type { AgentTool } from './agent.ts';

export type ToolVault = Pick<VaultApi,
  'search' | 'listItems' | 'getNote' | 'createNote' | 'saveNote' | 'rename' | 'move' | 'setTags' | 'tasks' | 'toggleTask' | 'dailyNote'>;

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
  const idArg = { id: { ...str, description: 'Note id. Optional when a note is open.' } };

  const all: (AgentTool & { vaultOnly?: boolean; write?: boolean })[] = [
    {
      vaultOnly: true,
      spec: { name: 'search_notes', description: 'Full-text search over note titles, text and tags.', parameters: obj({ query: str }, ['query']) },
      run: async a => json((await vault.search(String(a.query ?? ''))).filter(visible).map(brief)),
    },
    {
      vaultOnly: true,
      spec: { name: 'list_recent', description: 'The most recently changed notes.', parameters: obj({ limit: { type: 'number' } }) },
      run: async a => json((await vault.listItems()).filter(i => i.type === 'note' && !i.inTrash && !i.template && visible(i))
        .sort((x, y) => y.updated.localeCompare(x.updated)).slice(0, Math.min(Number(a.limit ?? 10), 50)).map(brief)),
    },
    {
      spec: { name: 'read_note', description: 'Read one note as Markdown, with its folder path, tags and links.', parameters: obj(idArg) },
      run: async a => {
        const id = target(a);
        const n = ctx.io ? await readOrThrow(id) : null;
        const doc: NoteDoc | null = await vault.getNote(id);
        if (!doc || doc.private || doc.type !== 'note') throw new Error(NOT_FOUND);
        return json({ id: doc.id, title: n?.title ?? doc.title, folder: doc.path.map(p => p.title).join(' / '), tags: doc.tags, updated: doc.updated, body: n?.body ?? doc.body, backlinks: doc.backlinks });
      },
    },
    {
      write: true,
      spec: { name: 'create_note', description: 'Create a NEW note (in the Inbox unless a folder id is given). Use it only when the user asks for a new or separate note, or when no note is open. To write into an existing note use append_to_note, insert_after_heading or replace_text.', parameters: obj({ title: str, body: { ...str, description: 'Markdown' }, folder: str, tags: { type: 'array', items: str } }, ['title']) },
      run: async a => {
        const n = await vault.createNote({ title: String(a.title), body: String(a.body ?? ''), parent: whole && a.folder ? String(a.folder) : undefined, tags: Array.isArray(a.tags) ? a.tags.map(String) : undefined });
        return json({ id: n.id, title: n.title });
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
      spec: { name: 'list_folders', description: 'All folders with their ids and parents.', parameters: obj({}) },
      run: async () => json((await vault.listItems()).filter(i => i.type === 'folder' && !i.inTrash).map(f => ({ id: f.id, title: f.title, parent: f.parent, notes: f.childCount }))),
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
