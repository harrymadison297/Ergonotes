// The Ergonotes MCP (Model Context Protocol) server logic, free of any transport: JSON-RPC 2.0 messages in, a response out.
// The server peer feeds it from HTTP; the desktop app feeds it from its own local endpoint. Tools are the same note tools the
// in-app chat uses, so a private note does not exist here either.
import type { VaultApi } from '../api.ts';
import type { AgentTool } from './agent.ts';
import { ERGONOTES_GUIDE, ERGONOTES_INSTRUCTIONS } from './guide.ts';
import { buildTools, type ToolVault } from './tools.ts';

export type McpVault = ToolVault & Pick<VaultApi, 'status'>;
type Json = Record<string, unknown>;

/** Newest first. A client that asks for one of these gets it back; anything else gets the newest. */
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

/** What a tool that shows pictures returns: the text for the model and, if it has them, images (base64, no `data:` prefix). */
export interface RichResult { text: string; images?: { data: string; mimeType: string }[] }
/** A tool the host adds; `runRich` is used instead of `run` when the answer carries pictures. */
export type McpExtraTool = AgentTool & { runRich?(args: Record<string, unknown>): Promise<RichResult> };

export interface McpOptions {
  /** tools only the host can provide (the desktop app adds the drawing tools) */
  extraTools?: McpExtraTool[];
  /** shown to the client as the server version */
  version?: string;
}

interface ToolMeta { title: string; readOnly?: boolean; destructive?: boolean; idempotent?: boolean; out?: 'items' | 'object' | 'idtitle' }

// Hints for clients (Claude Code lets read-only tools run without asking). A tool not listed here is treated as a write
// that may be destructive, which is the protocol's own default.
const META: Record<string, ToolMeta> = {
  search_notes: { title: 'Search notes', readOnly: true, out: 'items' },
  list_recent: { title: 'Recent notes', readOnly: true, out: 'items' },
  read_note: { title: 'Read a note', readOnly: true, out: 'object' },
  read_record: { title: 'Read a recording transcript', readOnly: true },
  get_links: { title: 'Links of a note', readOnly: true, out: 'object' },
  list_tags: { title: 'List tags', readOnly: true, out: 'items' },
  list_folders: { title: 'List folders', readOnly: true, out: 'items' },
  list_tasks: { title: 'List tasks', readOnly: true, out: 'items' },
  create_note: { title: 'Create a note', destructive: false, out: 'idtitle' },
  append_to_note: { title: 'Append to a note', destructive: false },
  insert_after_heading: { title: 'Insert under a heading', destructive: false },
  replace_text: { title: 'Replace a passage', destructive: true },
  update_note: { title: 'Rewrite a note', destructive: true, idempotent: true },
  rename_note: { title: 'Rename a note', destructive: true, idempotent: true },
  add_tags: { title: 'Add tags', destructive: false, idempotent: true },
  move_note: { title: 'Move a note or folder', destructive: false, idempotent: true },
  complete_task: { title: 'Complete a task', destructive: false, idempotent: true },
  daily_note: { title: 'Open a daily note', destructive: false, idempotent: true, out: 'idtitle' },
  // the drawing tools the desktop app adds
  insert_diagram: { title: 'Draw a diagram from Mermaid', destructive: false },
  draw: { title: 'Draw a diagram', destructive: true },
  read_drawing: { title: 'Look at a drawing', readOnly: true },
  search_libraries: { title: 'Search Excalidraw libraries', readOnly: true },
  browse_library: { title: 'Look at an Excalidraw library', readOnly: true },
  import_library_item: { title: 'Add a library drawing', destructive: false },
};

const ITEMS_SCHEMA = { type: 'object', properties: { items: { type: 'array', items: { type: 'object' } } }, required: ['items'] };
const OBJECT_SCHEMA = { type: 'object' };
const ID_TITLE_SCHEMA = { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['id', 'title'] };
const OUTPUT = { items: ITEMS_SCHEMA, object: OBJECT_SCHEMA, idtitle: ID_TITLE_SCHEMA };

interface Prompt { name: string; title: string; description: string; args: { name: string; description: string; required?: boolean }[]; text(a: Record<string, string>): string }

const GUIDE_LINE = 'Follow the Ergonotes conventions (resource ergonotes://guide): read before you write, smallest edit, Inbox by default, reuse existing tags, no deleting, and write in my language.';
const PROMPTS: Prompt[] = [
  {
    name: 'write_note', title: 'Write a note', description: 'Write a well-formed note on a subject, linked to what the notes already say.',
    args: [{ name: 'topic', description: 'What the note is about', required: true }, { name: 'details', description: 'Content, source or points to cover' }],
    text: a => `Write a note about: ${a.topic}.${a.details ? `\n\nMaterial and wishes:\n${a.details}` : ''}\n\nFirst search my notes for the subject: if a note already covers it, extend that one. Otherwise create one idea per note with a clear title, link at least one related note, and use tags that already exist (list_tags). Read the note back when done and tell me where it is. ${GUIDE_LINE}`,
  },
  {
    name: 'capture', title: 'Capture into the Inbox', description: 'Save text as it is in the Inbox for later triage.',
    args: [{ name: 'text', description: 'What to save', required: true }],
    text: a => `Save this in my Inbox as a new note. Keep my words; only add a short title, today's date and the source if I gave one. Do not tag or file it.\n\n${a.text}\n\n${GUIDE_LINE}`,
  },
  {
    name: 'daily_plan', title: 'Plan the day', description: 'Open the daily note and propose the day from the open tasks.',
    args: [{ name: 'date', description: 'YYYY-MM-DD, default today' }],
    text: a => `Open my daily note for ${a.date || 'today'} (daily_note), look at list_tasks for what is due or overdue, and propose the three things that matter most. After I agree, write them under a "Today" heading in the daily note. ${GUIDE_LINE}`,
  },
  {
    name: 'triage_inbox', title: 'Triage the Inbox', description: 'Propose where each Inbox note belongs; change nothing until approved.',
    args: [],
    text: () => `Read every note in my Inbox. Show a table: note, proposed folder, tags to add, related notes to link, possible duplicate. Stop and wait for my approval; then apply it with move_note, add_tags and links. Never delete anything. ${GUIDE_LINE}`,
  },
  {
    name: 'ask_notes', title: 'Ask my notes', description: 'Answer a question from the notes only, with links to the sources.',
    args: [{ name: 'question', description: 'The question', required: true }],
    text: a => `Answer from my notes only: ${a.question}\n\nSearch with several wordings, read the relevant notes (or just the section), answer, and link every note you used. If the notes do not say, say so; do not fill the gap from general knowledge without marking it. Change nothing. ${GUIDE_LINE}`,
  },
  {
    name: 'meeting_minutes', title: 'Minutes of a meeting', description: 'Turn a recording or meeting transcript into minutes with action items.',
    args: [{ name: 'note', description: 'Title or id of the note that shows the recording', required: true }],
    text: a => `Find the note "${a.note}", read its recording with read_record, and add minutes to that note under a "Minutes" heading: a short summary, decisions, action items as checklist lines with an owner and @due when said, open questions, and the key quotes with their [m:ss] marks. Keep the recording link as it is. Do not invent names or dates that were not said. ${GUIDE_LINE}`,
  },
];

const LOCKED = 'The vault is locked. Unlock it first (in the Ergonotes window, or sign in to the server).';

function checkArgs(schema: Json, args: Json): string | null {
  const props = (schema.properties ?? {}) as Record<string, Json>;
  for (const k of (schema.required ?? []) as string[]) if (args[k] === undefined || args[k] === null) return `Missing argument "${k}".`;
  for (const [k, v] of Object.entries(args)) {
    const p = props[k];
    if (!p) return `Unknown argument "${k}". Accepted: ${Object.keys(props).join(', ') || '(none)'}.`;
    const want = p.type as string | undefined;
    const ok = !want || (want === 'array' ? Array.isArray(v) : want === 'number' ? typeof v === 'number' : want === typeof v);
    if (!ok) return `Argument "${k}" must be ${want === 'array' ? 'an array' : `a ${want}`}.`;
  }
  return null;
}

/** The object a client can read as structured output: an array is wrapped, plain text has none. */
function structuredOf(text: string): Json | undefined {
  try {
    const v: unknown = JSON.parse(text);
    if (Array.isArray(v)) return { items: v };
    if (v && typeof v === 'object') return v as Json;
  } catch { /* plain text */ }
  return undefined;
}

export function mcpTools(vault: McpVault, opts: McpOptions = {}) {
  return buildTools({ vault, scope: { kind: 'vault' }, extra: opts.extraTools }).map(t => {
    const m = META[t.spec.name];
    return {
      name: t.spec.name,
      title: m?.title ?? t.spec.name,
      description: t.spec.description,
      inputSchema: t.spec.parameters,
      ...(m?.out ? { outputSchema: OUTPUT[m.out] } : {}),
      annotations: {
        title: m?.title ?? t.spec.name,
        readOnlyHint: m?.readOnly === true,
        ...(m?.readOnly ? {} : { destructiveHint: m ? m.destructive === true : true }),
        idempotentHint: m?.idempotent === true || m?.readOnly === true,
        openWorldHint: false,
      },
      run: t.run,
      runRich: (t as McpExtraTool).runRich,
    };
  });
}

/** Handle one JSON-RPC message. Returns the response, or null when none is due (a notification, or a reply from the client). */
export async function handleRpc(vault: McpVault, msg: Json, opts: McpOptions = {}): Promise<Json | null> {
  const id = msg.id as string | number | undefined;
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string, data?: unknown) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
  if (id === undefined) return null; // a notification: no answer
  if (typeof msg.method !== 'string') return 'result' in msg || 'error' in msg ? null : fail(-32600, 'Invalid request');
  const method = msg.method;
  const params = (msg.params ?? {}) as Json;
  const ready = async () => (await vault.status()).state === 'ready';

  switch (method) {
    case 'initialize': {
      const asked = String(params.protocolVersion ?? '');
      const version = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return reply({
        protocolVersion: version,
        capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: 'ergonotes', title: 'Ergonotes', version: opts.version ?? '1.0.4' },
        instructions: ERGONOTES_INSTRUCTIONS,
      });
    }
    case 'ping': return reply({});

    case 'tools/list': return reply({ tools: mcpTools(vault, opts).map(({ run: _r, runRich: _rr, ...t }) => t) });
    case 'tools/call': {
      const tool = mcpTools(vault, opts).find(t => t.name === params.name);
      if (!tool) return fail(-32602, `Unknown tool ${String(params.name)}`);
      const text = (t: string) => reply({ isError: true, content: [{ type: 'text', text: t }] });
      if (!(await ready())) return text(LOCKED);
      const args = (params.arguments ?? {}) as Json;
      const bad = checkArgs(tool.inputSchema, args);
      if (bad) return text(bad);
      try {
        if (tool.runRich) {
          const r = await tool.runRich(args);
          return reply({ content: [{ type: 'text', text: r.text }, ...(r.images ?? []).map(i => ({ type: 'image', data: i.data, mimeType: i.mimeType }))] });
        }
        const out = await tool.run(args);
        const structured = 'outputSchema' in tool ? structuredOf(out) : undefined;
        return reply({ content: [{ type: 'text', text: out }], ...(structured ? { structuredContent: structured } : {}) });
      } catch (e) { return text(e instanceof Error ? e.message : String(e)); }
    }

    case 'resources/list':
      return reply({ resources: [{ uri: 'ergonotes://guide', name: 'guide', title: 'How to use Ergonotes', description: 'Conventions for reading and writing notes, and the Markdown syntax of tasks, events and blocks.', mimeType: 'text/markdown' }] });
    case 'resources/templates/list':
      return reply({ resourceTemplates: [{ uriTemplate: 'ergonotes://note/{id}', name: 'note', title: 'A note', description: 'The Markdown of one note, by id (from search_notes).', mimeType: 'text/markdown' }] });
    case 'resources/read': {
      const uri = String(params.uri ?? '');
      if (uri === 'ergonotes://guide') return reply({ contents: [{ uri, mimeType: 'text/markdown', text: ERGONOTES_GUIDE }] });
      const m = /^ergonotes:\/\/note\/(.+)$/.exec(uri);
      if (!m) return fail(-32002, 'Resource not found', { uri });
      if (!(await ready())) return fail(-32002, LOCKED, { uri });
      try {
        const read = mcpTools(vault, opts).find(t => t.name === 'read_note')!;
        const note = JSON.parse(await read.run({ id: decodeURIComponent(m[1]) })) as { body: string };
        return reply({ contents: [{ uri, mimeType: 'text/markdown', text: note.body }] });
      } catch { return fail(-32002, 'Resource not found', { uri }); }
    }

    case 'prompts/list':
      return reply({ prompts: PROMPTS.map(p => ({ name: p.name, title: p.title, description: p.description, arguments: p.args.map(a => ({ name: a.name, description: a.description, required: a.required === true })) })) });
    case 'prompts/get': {
      const p = PROMPTS.find(x => x.name === params.name);
      if (!p) return fail(-32602, `Unknown prompt ${String(params.name)}`);
      const a = Object.fromEntries(Object.entries((params.arguments ?? {}) as Json).map(([k, v]) => [k, String(v)]));
      const missing = p.args.find(x => x.required && !a[x.name]?.trim());
      if (missing) return fail(-32602, `Missing argument "${missing.name}"`);
      return reply({ description: p.description, messages: [{ role: 'user', content: { type: 'text', text: p.text(a) } }] });
    }

    default: return fail(-32601, `Method not found: ${method}`);
  }
}
