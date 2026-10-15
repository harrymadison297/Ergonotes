import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AtSign, Brain, Check, ChevronDown, FileText, Glasses, History as HistoryIcon, Info, Lightbulb, Loader2, Paperclip, Pencil, Plus, RotateCcw, Search, Send, Shapes,
  SquarePen, Square, Trash2, WandSparkles, X,
} from 'lucide-react';
import { buildTools, chatSystemPrompt, lineDiff, mergeText, runAgent, type AgentTool, type ChatSummary, type NoteIO, type ThinkingLevel } from '@ergonotes/core';
import { useApp } from '../state/app';
import { chat, parseChat, pendingFor, serializeChat, useChat, type Mention, type Proposal } from '../state/aiChat';
import { toB64 } from '@ergonotes/core';
import { editorBridge, useOutline } from '../state/editorBridge';
import { renderMarkdown } from '../state/markdown';
import { setPrefs, usePrefs } from '../state/prefs';
import { classNames, relTime } from '../state/util';
import { href } from '../state/router';
import { drawingBlock, mermaidToScene } from '../editor/diagram';
import { fileToText } from './FilePreview';
import { IconBtn, useMenu } from './ui';
import { ModelPicker } from './ModelPicker';

const WRITE_TOOLS = /^(create_note|append_to_note|replace_text|insert_after_heading|update_note|rename_note|add_tags|move_note|complete_task|daily_note|insert_diagram)$/;

function toolLabel(name: string, a: Record<string, unknown>): string {
  const q = (v: unknown) => (typeof v === 'string' && v ? ` “${v.length > 40 ? v.slice(0, 39) + '…' : v}”` : '');
  switch (name) {
    case 'search_notes': return `Searched notes for${q(a.query)}`;
    case 'list_recent': return 'Looked at recent notes';
    case 'read_note': return 'Read a note';
    case 'create_note': return `Created a note${q(a.title)}`;
    case 'append_to_note': return 'Added text to a note';
    case 'replace_text': return 'Edited a passage';
    case 'insert_after_heading': return `Added under${q(a.heading)}`;
    case 'update_note': return 'Rewrote a note';
    case 'rename_note': return `Renamed a note to${q(a.title)}`;
    case 'add_tags': return 'Added tags';
    case 'move_note': return 'Moved a note';
    case 'list_folders': return 'Looked at the folders';
    case 'list_tasks': return 'Looked at the tasks';
    case 'complete_task': return 'Completed a task';
    case 'daily_note': return 'Opened a daily note';
    case 'insert_diagram': return 'Drew a diagram';
    default: return name;
  }
}

/** One line of a diff for display: drawing data and very long lines are shortened. */
function shown(line: string): string {
  if (/^\{"type":"excalidraw"/.test(line)) return '(drawing data)';
  return line.length > 180 ? line.slice(0, 179) + '…' : line;
}

function Diff({ p }: { p: Proposal }) {
  const ops = useMemo(() => lineDiff(p.baseBody.split('\n'), p.body.split('\n')), [p.baseBody, p.body]);
  const rows: { type: 'same' | 'del' | 'add' | 'gap'; text: string }[] = [];
  ops.forEach((op, oi) => {
    if (op.type !== 'same') { for (const l of op.lines) rows.push({ type: op.type, text: shown(l) }); return; }
    const keepHead = oi === 0 ? 0 : 2;
    const keepTail = oi === ops.length - 1 ? 0 : 2;
    if (op.lines.length <= keepHead + keepTail + 1) { for (const l of op.lines) rows.push({ type: 'same', text: shown(l) }); return; }
    for (const l of op.lines.slice(0, keepHead)) rows.push({ type: 'same', text: shown(l) });
    rows.push({ type: 'gap', text: `${op.lines.length - keepHead - keepTail} unchanged lines` });
    for (const l of op.lines.slice(op.lines.length - keepTail)) rows.push({ type: 'same', text: shown(l) });
  });
  return (
    <div className="ai-diff" role="group" aria-label="Proposed changes">
      {p.title !== p.baseTitle && <div className="ai-diff-row del">Title: {p.baseTitle}</div>}
      {p.title !== p.baseTitle && <div className="ai-diff-row add">Title: {p.title}</div>}
      {rows.map((r, i) => <div key={i} className={classNames('ai-diff-row', r.type)}>{r.type === 'add' ? '+ ' : r.type === 'del' ? '− ' : r.type === 'gap' ? '' : '  '}{r.text || ' '}</div>)}
    </div>
  );
}

const THINKING_LABEL: Record<ThinkingLevel, string> = { auto: 'Auto', off: 'Off', low: 'Low', medium: 'Medium', high: 'High' };

/** The model's thinking: open while it is still thinking, a collapsed line afterwards. */
function Thinking({ text, live }: { text: string; live: boolean }) {
  return (
    <details className="ai-think" open={live}>
      <summary>{live ? <><Loader2 size={12} className="spin" /> Thinking…</> : <><Brain size={12} /> Thought process</>}</summary>
      <div className="ai-think-text">{text}</div>
    </details>
  );
}

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className="ai-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ---------------------------------------------------------------- header actions: new chat, history
export function AiHeaderActions() {
  const app = useApp();
  const st = useChat();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ChatSummary[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = async () => { try { setList(await app.api.listChats()); } catch { setList([]); } };
  useEffect(() => {
    if (!open) return;
    void load();
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ai-actions" ref={box}>
      <IconBtn label="New chat" icon={<SquarePen size={18} />} disabled={st.busy || st.items.length === 0} onClick={() => chat.reset()} />
      <IconBtn label="Chat history" icon={<HistoryIcon size={18} />} active={open} haspopup onClick={() => setOpen(o => !o)} />
      {open && (
        <div className="ai-history" role="dialog" aria-label="Chat history">
          <h4>History</h4>
          {list === null && <div className="ai-history-empty"><Loader2 size={16} className="spin" /></div>}
          {list?.length === 0 && <div className="ai-history-empty">Your conversations will show up here.</div>}
          <ul>
            {(list ?? []).map(c => (
              <li key={c.id} className={classNames(c.id === st.convId && 'current')}>
                <button className="ai-history-open" disabled={st.busy} onClick={async () => {
                  const rec = await app.run(app.api.getChat(c.id));
                  const parsed = rec ? parseChat(rec.id, rec.data) : null;
                  if (!parsed) { app.toast('That conversation could not be opened', 'error'); return; }
                  chat.load(parsed);
                  setOpen(false);
                }}>
                  <span className="ai-history-title">{c.title}</span>
                  <span className="ai-history-when">{relTime(c.updated)}</span>
                </button>
                <IconBtn label={`Delete “${c.title}”`} icon={<Trash2 size={15} />} onClick={async () => {
                  await app.run(app.api.deleteChat(c.id));
                  if (c.id === st.convId) chat.reset();
                  await load();
                }} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the panel
const SUGGESTIONS: { icon: JSX.Element; label: string; prompt: string; needsNote?: boolean; send?: boolean }[] = [
  { icon: <Info size={18} />, label: 'What can the Assistant do?', prompt: 'What can you do here? Answer briefly, with examples.', send: true },
  { icon: <Search size={18} />, label: 'Ask my notes about…', prompt: 'Ask my notes about ' },
  { icon: <WandSparkles size={18} />, label: 'Draft a note to organize my day', prompt: 'Draft a note that helps me organize my day, with a checklist.', send: true },
  { icon: <FileText size={18} />, label: 'Summarize this note', prompt: 'Summarize this note in a few bullet points.', needsNote: true, send: true },
  { icon: <Lightbulb size={18} />, label: 'Help me brainstorm', prompt: 'Help me brainstorm about ', },
  { icon: <Shapes size={18} />, label: 'Draw a diagram of this note', prompt: 'Draw a diagram that explains the main idea of this note and add it to the note.', needsNote: true, send: true },
];

interface Pick extends Mention { hint?: string }

export function AiPanel() {
  const app = useApp();
  const { api, ai } = app;
  const st = useChat();
  const prefs = usePrefs();
  const outline = useOutline();
  const modeMenu = useMenu();
  const plusMenu = useMenu();
  const upload = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [picker, setPicker] = useState<{ query: string; at: number } | null>(null);
  const [pickIndex, setPickIndex] = useState(0);
  const [files, setFiles] = useState<{ id: string; name: string }[] | null>(null);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  // the note the person is looking at: the one in the editor, else the one in the address
  const route = app.route;
  const routeNote = 'note' in route ? route.note ?? null : null;
  const noteId = outline?.noteId ?? routeNote;
  const summary = noteId ? app.byId.get(noteId) : undefined;
  const isPrivate = !!summary?.private;
  const locked = !!outline?.locked || !!summary?.inTrash;
  const idRef = useRef(noteId);
  idRef.current = noteId;
  const mode = prefs.aiMode;

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [st.items.length, st.items.at(-1), st.notice]);
  useEffect(() => () => abort.current?.abort(), []);

  // ---- keep the conversation in the vault (once a turn has finished)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (st.busy || st.items.length === 0) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const s = chat.get();
      if (s.busy || s.items.length === 0) return;
      const id = s.convId ?? crypto.randomUUID();
      const first = s.items.find(i => i.kind === 'user');
      const title = (first && first.kind === 'user' ? first.text : 'Conversation').replace(/\s+/g, ' ').slice(0, 80);
      if (!s.convId) chat.set(x => (x.convId ? x : { ...x, convId: id }));
      void api.saveChat({ id, title, data: serializeChat(chat.get()) }).catch(() => undefined);
    }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [st.items, st.proposals, st.busy, api]);

  // ---- reading and writing notes for the tools
  const liveBody = () => (idRef.current && outline && outline.noteId === idRef.current ? editorBridge.fns()?.live() ?? null : null);

  const applyNow = async (id: string, patch: { title?: string; body?: string }) => {
    const fns = editorBridge.fns();
    if (fns && id === idRef.current && outline?.noteId === id) { fns.apply(patch); return; }
    await api.saveNote(id, patch);
  };

  const io = (): NoteIO => ({
    read: async id => {
      const p = pendingFor(chat.get(), id);
      if (p) return { id, title: p.title, body: p.body };
      if (app.byId.get(id)?.private) return null;
      const live = id === idRef.current ? liveBody() : null;
      if (live) return { id, title: live.title, body: live.body };
      const n = await api.getNote(id);
      return n && n.type === 'note' && !n.private ? { id, title: n.title, body: n.body } : null;
    },
    write: async (id, patch) => {
      const cur = await io().read(id);
      if (!cur) throw new Error('Note not found');
      const existing = pendingFor(chat.get(), id);
      const next = { title: patch.title ?? cur.title, body: patch.body ?? cur.body };
      if (ai.autoApply) {
        const was = (id === idRef.current ? liveBody() : null) ?? cur;
        await applyNow(id, patch);
        const done: Proposal = { id: `p${chat.nextId()}`, noteId: id, baseTitle: was.title, baseBody: was.body, ...next, state: 'accepted' };
        chat.set(s => ({ ...s, proposals: { ...s.proposals, [done.id]: done }, items: [...s.items, { id: chat.nextId(), kind: 'proposal', proposalId: done.id }] }));
        return 'Updated.';
      }
      const base = existing ? { title: existing.baseTitle, body: existing.baseBody } : (id === idRef.current ? liveBody() : null) ?? cur;
      const prop: Proposal = { id: existing?.id ?? `p${chat.nextId()}`, noteId: id, baseTitle: base.title, baseBody: base.body, ...next, state: 'pending' };
      chat.set(s => ({
        ...s,
        proposals: { ...s.proposals, [prop.id]: prop },
        items: existing ? s.items : [...s.items, { id: chat.nextId(), kind: 'proposal', proposalId: prop.id }],
      }));
      return 'Proposed to the user, who has to accept it. Later edits to this note build on this proposal.';
    },
  });

  const diagramTool = (base: AgentTool[]): AgentTool => ({
    spec: {
      name: 'insert_diagram',
      description: 'Draw a diagram from Mermaid source and add it to a note as a drawing the user can edit. Use flowchart, sequenceDiagram, classDiagram or mindmap syntax.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['mermaid'],
        properties: {
          id: { type: 'string', description: 'Note id. Optional when a note is open.' },
          mermaid: { type: 'string', description: 'Mermaid source, without code fences' },
          after_heading: { type: 'string', description: 'Put the drawing at the end of this section; otherwise at the end of the note' },
        },
      },
    },
    run: async a => {
      const scene = await mermaidToScene(String(a.mermaid ?? ''));
      const block = drawingBlock(scene);
      const id = typeof a.id === 'string' && a.id ? a.id : idRef.current;
      const heading = typeof a.after_heading === 'string' ? a.after_heading : '';
      const t = base.find(x => x.spec.name === (heading ? 'insert_after_heading' : 'append_to_note'));
      if (!t) throw new Error('Cannot add a drawing here.');
      await t.run(heading ? { id, heading, markdown: block } : { id, text: block });
      return 'Diagram added to the note.';
    },
  });

  // ---- sending
  /** The text of what the person attached, read now: the model gets it in the message itself. */
  const attachmentText = async (list: Mention[]): Promise<string> => {
    const parts: string[] = [];
    for (const m of list) {
      if (m.kind === 'note') {
        const n = app.byId.get(m.id)?.private ? null : await api.getNote(m.id);
        if (!n || n.private) { parts.push(`### Note: ${m.title}\n(not available)`); continue; }
        parts.push(`### Note: ${n.title} (id: ${n.id})\n<<<\n${n.body.slice(0, 60_000)}\n>>>`);
      } else {
        const f = m.text === undefined ? await api.getFile(m.id) : null;
        const t = m.text !== undefined ? m.text : f ? await fileToText(f).catch(() => null) : null;
        parts.push(t === null ? `### File: ${m.title}\n(this kind of file cannot be read as text)` : `### File: ${m.title}\n<<<\n${t}\n>>>`);
      }
    }
    return parts.length ? `\n\nAttached for context:\n${parts.join('\n\n')}` : '';
  };

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || st.busy) return;
    const attached = mentions;
    setDraft(''); setMentions([]); setPicker(null);
    const ctl = new AbortController();
    abort.current = ctl;
    chat.set(s => ({ ...s, busy: true, notice: null, items: [...s.items, { id: chat.nextId(), kind: 'user', text: msg, mentions: attached }] }));
    try {
      const content = msg + (await attachmentText(attached));
      const history = [...chat.get().history, { role: 'user' as const, content }];
      const cur = noteId ? await io().read(noteId) : null;
      const allow = chat.get().items.flatMap(i => (i.kind === 'user' ? i.mentions.filter(m => m.kind === 'note').map(m => m.id) : []));
      const base = buildTools({
        vault: api, io: io(), readOnly: mode === 'ask',
        scope: ai.wholeVault ? { kind: 'vault' } : { kind: 'note', noteId, allow },
      });
      const withDiagram = mode === 'edit' && !locked && noteId ? [...base, diagramTool(base)] : base;
      const tools = locked ? withDiagram.filter(t => !WRITE_TOOLS.test(t.spec.name) || t.spec.name === 'create_note') : withDiagram;
      let streaming: number | null = null;
      let thinkingId: number | null = null;
      const added = await runAgent({
        transport: app.aiTransport, tools, history, signal: ctl.signal,
        system: chatSystemPrompt({ note: cur && noteId ? { id: noteId, title: cur.title, body: cur.body } : null, wholeVault: ai.wholeVault, mode, today: new Date().toLocaleDateString('en-CA') }),
        onEvent: e => {
          if (e.type === 'thinking') {
            if (thinkingId === null) {
              const id = chat.nextId();
              thinkingId = id;
              chat.set(s => ({ ...s, notice: null, items: [...s.items, { id, kind: 'thinking', text: e.delta }] }));
            } else {
              const id = thinkingId;
              chat.set(s => ({ ...s, items: s.items.map(i => (i.id === id && i.kind === 'thinking' ? { ...i, text: i.text + e.delta } : i)) }));
            }
          } else if (e.type === 'text') {
            thinkingId = null;
            if (streaming === null) {
              const id = chat.nextId();
              streaming = id;
              chat.set(s => ({ ...s, notice: null, items: [...s.items, { id, kind: 'assistant', text: e.delta }] }));
            } else {
              const id = streaming;
              chat.set(s => ({ ...s, items: s.items.map(i => (i.id === id && i.kind === 'assistant' ? { ...i, text: i.text + e.delta } : i)) }));
            }
          } else if (e.type === 'tool') {
            streaming = null;
            thinkingId = null;
            let created: string | undefined;
            if (e.call.name === 'create_note' && !e.error) { try { created = (JSON.parse(e.result) as { id?: string }).id; } catch { /* not JSON */ } }
            chat.set(s => ({ ...s, notice: null, items: [...s.items, { id: chat.nextId(), kind: 'tool', name: e.call.name, label: toolLabel(e.call.name, e.call.args), error: e.error, noteId: created }] }));
          } else if (e.type === 'notice') {
            chat.set(s => ({ ...s, notice: e.text }));
          } else {
            chat.set(s => ({ ...s, usage: { input: s.usage.input + e.input, output: s.usage.output + e.output } }));
          }
        },
      });
      chat.set(s => ({ ...s, history: [...history, ...added] }));
      void app.refresh(); // tools may have created or moved notes
    } catch (e) {
      if (!ctl.signal.aborted) chat.set(s => ({ ...s, items: [...s.items, { id: chat.nextId(), kind: 'error', text: e instanceof Error ? e.message : String(e) }] }));
    } finally {
      chat.set(s => ({ ...s, busy: false, notice: null }));
      abort.current = null;
    }
  };

  const decide = async (id: string, accept: boolean) => {
    const p = chat.get().proposals[id];
    if (!p || p.state !== 'pending') return;
    if (!accept) { chat.set(s => ({ ...s, proposals: { ...s.proposals, [id]: { ...p, state: 'rejected' } } })); return; }
    try {
      // the person may have typed since the proposal was made: bring both together instead of overwriting
      const open = p.noteId === idRef.current ? liveBody() : null;
      const now = open ?? (await api.getNote(p.noteId));
      if (!now) throw new Error('This note is no longer available.');
      let body = p.body;
      if (now.body !== p.baseBody && p.body !== p.baseBody) {
        const r = mergeText(now.body, p.baseBody, p.body);
        if (!r.clean) { app.toast('The note changed since this suggestion, in the same place. Reject it and ask again.', 'error'); return; }
        body = r.text;
      } else if (p.body === p.baseBody) body = now.body;
      await applyNow(p.noteId, { title: p.title !== p.baseTitle ? p.title : undefined, body: body !== now.body ? body : undefined });
      chat.set(s => ({ ...s, proposals: { ...s.proposals, [id]: { ...p, body, state: 'accepted' } } }));
      void app.refresh();
    } catch (e) { app.toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const undo = async (id: string) => {
    const p = chat.get().proposals[id];
    if (!p || p.state !== 'accepted' || !p.baseBody) return;
    try {
      await applyNow(p.noteId, { title: p.title !== p.baseTitle ? p.baseTitle : undefined, body: p.baseBody });
      chat.set(s => ({ ...s, proposals: { ...s.proposals, [id]: { ...p, state: 'rejected' } } }));
    } catch (e) { app.toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  // ---- @ mentions
  const picks: Pick[] = useMemo(() => {
    if (!picker) return [];
    const q = picker.query.toLowerCase();
    const have = new Set(mentions.map(m => m.id));
    const notes = app.items
      .filter(i => i.type === 'note' && !i.inTrash && !i.template && !i.private && !have.has(i.id) && (!q || i.title.toLowerCase().includes(q)))
      .sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 6)
      .map<Pick>(i => ({ kind: 'note', id: i.id, title: i.title, hint: app.byId.get(i.parent ?? '')?.title }));
    const fs = (files ?? []).filter(f => !have.has(f.id) && (!q || f.name.toLowerCase().includes(q))).slice(0, 4)
      .map<Pick>(f => ({ kind: 'file', id: f.id, title: f.name, hint: 'File' }));
    return [...notes, ...fs];
  }, [picker, app.items, app.byId, files, mentions]);

  useEffect(() => { setPickIndex(0); }, [picker?.query]);
  useEffect(() => {
    if (picker && files === null) void api.listFiles().then(l => setFiles(l.map(f => ({ id: f.id, name: f.name }))), () => setFiles([]));
  }, [picker, files, api]);

  const onDraft = (value: string, caret: number) => {
    setDraft(value);
    const m = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    setPicker(m ? { query: m[2], at: caret - m[2].length - 1 } : null);
  };
  const choose = (p: Pick) => {
    if (!picker) return;
    const before = draft.slice(0, picker.at);
    const after = draft.slice(picker.at + 1 + picker.query.length);
    setDraft(before + after.replace(/^ /, ''));
    setMentions(m => [...m, { kind: p.kind, id: p.id, title: p.title }]);
    setPicker(null);
    area.current?.focus();
  };

  const startMention = () => {
    const sep = draft && !/\s$/.test(draft) ? ' ' : '';
    setDraft(draft + sep + '@');
    setPicker({ query: '', at: draft.length + sep.length });
    setTimeout(() => area.current?.focus(), 0);
  };
  /** a file from this device is read here and goes into the message; it is not stored in the vault */
  const attachLocal = async (list: FileList | null) => {
    for (const f of Array.from(list ?? []).slice(0, 4)) {
      try {
        const text = await fileToText({ name: f.name, mime: f.type || 'application/octet-stream', data: toB64(new Uint8Array(await f.arrayBuffer())) });
        if (text === null) { app.toast(`${f.name}: this kind of file cannot be read as text`, 'error'); continue; }
        setMentions(m => [...m, { kind: 'file', id: `local:${f.name}:${f.size}`, title: f.name, text }]);
      } catch (e) { app.toast(`${f.name}: ${e instanceof Error ? e.message : String(e)}`, 'error'); }
    }
  };

  const noKey = !ai.chatReady;
  const disabled = noKey || isPrivate;
  const empty = st.items.length === 0;

  return (
    <div className="ai-panel" aria-label="AI assistant">
      <div className="ai-scroll" role="log" aria-live="polite">
        {empty && (
          <div className="ai-welcome">
            {noKey ? (
              <>
                <h2>Connect an AI provider</h2>
                <p>Ask questions about your notes, and have them written, edited or drawn for you. Use your own key, or a model running on your own machine.</p>
                <button className="btn primary" onClick={() => app.setDialog({ kind: 'settings', tab: 'ai' })}>Set up AI</button>
              </>
            ) : isPrivate ? (
              <>
                <h2>This note is private</h2>
                <p>The assistant cannot see it. Choose “Allow AI to see this note” in the note’s menu to use it here.</p>
              </>
            ) : (
              <>
                <h2>What can I help with?</h2>
                <ul className="ai-suggest">
                  {SUGGESTIONS.filter(s => !s.needsNote || (noteId && !isPrivate)).map(s => (
                    <li key={s.label}>
                      <button onClick={() => { if (s.send) void send(s.prompt); else { setDraft(s.prompt); area.current?.focus(); } }}>{s.icon}<span>{s.label}</span></button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {st.items.map(it => {
          if (it.kind === 'user') {
            return (
              <div key={it.id} className="ai-user">
                {it.mentions.length > 0 && <div className="ai-chips">{it.mentions.map(m => <span key={m.id} className="ai-chip">{m.kind === 'note' ? <FileText size={12} /> : <Paperclip size={12} />}{m.title}</span>)}</div>}
                <div className="ai-bubble">{it.text}</div>
              </div>
            );
          }
          if (it.kind === 'assistant') return <Markdown key={it.id} text={it.text} />;
          if (it.kind === 'thinking') return <Thinking key={it.id} text={it.text} live={st.busy && st.items.at(-1)?.id === it.id} />;
          if (it.kind === 'tool') {
            return (
              <div key={it.id} className={classNames('ai-tool', it.error && 'err')}>
                <Pencil size={12} /> {it.label}{it.error ? ' (failed)' : ''}
                {it.noteId && <a className="ai-tool-link" href={href({ name: 'notes', note: it.noteId })}>Open</a>}
              </div>
            );
          }
          if (it.kind === 'error') return <div key={it.id} className="ai-error" role="alert">{it.text}</div>;
          const p = st.proposals[it.proposalId];
          if (!p) return null;
          const title = app.byId.get(p.noteId)?.title ?? p.title;
          const label = p.state === 'pending' ? 'Suggested changes' : p.state === 'accepted' ? 'Applied' : p.state === 'rejected' ? 'Rejected' : 'Not applied';
          return (
            <div key={it.id} className={classNames('ai-proposal', p.state)}>
              <div className="ai-proposal-head"><b>{label}</b><span className="muted"> · {title}</span></div>
              {(p.baseBody || p.body) && p.state !== 'closed' && (p.state === 'pending' || p.baseBody || p.body) && <Diff p={p} />}
              {p.state === 'pending' && (
                <div className="ai-proposal-actions">
                  <button className="btn primary" onClick={() => void decide(p.id, true)}><Check size={14} /> Accept</button>
                  <button className="btn" onClick={() => void decide(p.id, false)}><X size={14} /> Reject</button>
                </div>
              )}
              {p.state === 'accepted' && p.baseBody && <div className="ai-proposal-actions"><button className="btn" onClick={() => void undo(p.id)}><RotateCcw size={14} /> Undo</button></div>}
            </div>
          );
        })}
        {st.busy && <div className="ai-working"><Loader2 size={14} className="spin" /> {st.notice ?? 'Working…'}</div>}
        {!st.busy && st.usage.input + st.usage.output > 0 && <div className="ai-usage">{st.usage.input.toLocaleString()} in · {st.usage.output.toLocaleString()} out tokens</div>}
        <div ref={endRef} />
      </div>

      <div className="ai-composer-wrap">
        <div className="ai-context" title="The assistant works on this note">
          <FileText size={13} />
          <span>{isPrivate ? 'Private note (hidden from AI)' : summary ? summary.title || 'Untitled' : ai.wholeVault ? 'All your notes' : 'No note open'}</span>
        </div>
        <form className={classNames('ai-composer', disabled && 'disabled')} onSubmit={e => { e.preventDefault(); void send(draft); }}>
          {mentions.length > 0 && (
            <div className="ai-chips">
              {mentions.map(m => (
                <span key={m.id} className="ai-chip">
                  {m.kind === 'note' ? <FileText size={12} /> : <Paperclip size={12} />}{m.title}
                  <button type="button" aria-label={`Remove ${m.title}`} onClick={() => setMentions(x => x.filter(y => y.id !== m.id))}><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
          {picker && (
            <div className="ai-picker" role="listbox" aria-label="Attach a note or file">
              {picks.length === 0 && <div className="ai-picker-empty">{files === null ? 'Searching…' : 'No matching notes or files'}</div>}
              {picks.map((p, i) => (
                <button key={p.id} type="button" role="option" aria-selected={i === pickIndex} className={classNames(i === pickIndex && 'on')}
                  onMouseDown={e => { e.preventDefault(); choose(p); }}>
                  {p.kind === 'note' ? <FileText size={15} /> : <Paperclip size={15} />}
                  <span className="t">{p.title || 'Untitled'}</span>
                  {p.hint && <span className="h">{p.hint}</span>}
                </button>
              ))}
            </div>
          )}
          <textarea ref={area} aria-label="Message the assistant" rows={2} value={draft} disabled={disabled}
            placeholder={noKey ? 'Set up AI first' : isPrivate ? 'This note is private' : 'Ask anything'}
            onChange={e => onDraft(e.target.value, e.target.selectionStart)}
            onKeyDown={e => {
              if (picker && picks.length) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setPickIndex(i => (i + 1) % picks.length); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setPickIndex(i => (i - 1 + picks.length) % picks.length); return; }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(picks[pickIndex]); return; }
              }
              if (e.key === 'Escape' && picker) { e.preventDefault(); setPicker(null); return; }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft); }
            }} />
          <div className="ai-composer-bar">
            <IconBtn label="Attach" icon={<Plus size={18} />} disabled={disabled} haspopup
              onClick={e => plusMenu.open(e, [
                { label: 'A note or file from Ergonotes', icon: <AtSign size={16} />, onClick: startMention },
                { label: 'A file from this device', icon: <Paperclip size={16} />, onClick: () => upload.current?.click() },
              ], 'left')} />
            <IconBtn label="Mention a note or file" icon={<AtSign size={18} />} disabled={disabled} onClick={startMention} />
            <button type="button" className="ai-mode icon" aria-haspopup="menu" aria-label={`Mode: ${mode === 'edit' ? 'Edit' : 'Ask'}`} title={mode === 'edit' ? 'Edit: the assistant may change notes' : 'Ask: answers only'}
              onClick={e => modeMenu.open(e, [
                { label: 'Ask: answers only', icon: <Glasses size={16} />, checked: mode === 'ask', onClick: () => setPrefs({ aiMode: 'ask' }) },
                { label: 'Edit: may change notes', icon: <Pencil size={16} />, checked: mode === 'edit', onClick: () => setPrefs({ aiMode: 'edit' }) },
              ], 'left')}>
              {mode === 'edit' ? <Pencil size={15} /> : <Glasses size={16} />}
            </button>
            <ModelPicker label="Chat model" variant="pill" value={ai.chatModel} connections={ai.connections} needsTools
              effort={ai.chatThinking} onEffort={async l => { await app.run(api.setAiSettings({ chatThinking: l })); await app.refresh(); }}
              onPick={async ref => { await app.run(api.setAiSettings({ chatModel: ref })); await app.refresh(); }} />
            <span className="grow" />
            {st.busy
              ? <IconBtn label="Stop" icon={<Square size={16} />} variant="primary" onClick={() => abort.current?.abort()} />
              : <IconBtn label="Send" icon={<Send size={16} />} variant="primary" disabled={disabled || !draft.trim()} onClick={() => void send(draft)} />}
          </div>
        </form>
        {modeMenu.node}{plusMenu.node}
        <input ref={upload} type="file" hidden multiple accept=".txt,.md,.json,.csv,.tsv,.xlsx,.pptx,text/*" onChange={e => { void attachLocal(e.target.files); e.target.value = ''; }} />
        <p className="ai-disclaimer">AI can make mistakes. Check important information.</p>
      </div>
    </div>
  );
}
