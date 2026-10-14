import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, RotateCcw, Send, Settings as SettingsIcon, Sparkles, Square, Trash2, Wrench, X } from 'lucide-react';
import { buildTools, chatSystemPrompt, lineDiff, mergeText, runAgent, type AgentTool, type NoteIO } from '@ergonotes/core';
import { useApp } from '../state/app';
import { chat, pendingFor, useChat, type Proposal } from '../state/aiChat';
import { classNames } from '../state/util';
import { drawingBlock, mermaidToScene } from '../editor/diagram';
import { IconBtn } from './ui';
import { Resizer } from './Resizer';

export interface AiPanelProps {
  noteId: string;
  /** the note as it is on screen, unsaved typing included */
  live: () => { title: string; body: string };
  /** the note cannot be changed (trash, read-only) */
  locked: boolean;
  /** write into the open note through the editor so it saves like typing does */
  applyToEditor: (patch: { title?: string; body?: string }) => void;
  onClose: () => void;
}

const QUICK = [
  { label: 'Summarize', prompt: 'Summarize this note in a few bullet points. Do not change the note.' },
  { label: 'Fix spelling', prompt: 'Fix spelling and grammar mistakes in this note. Change nothing else.' },
  { label: 'Continue writing', prompt: 'Continue writing this note where it stops, in the same style.' },
  { label: 'Draw a diagram', prompt: 'Draw a diagram that explains the main idea of this note and add it to the note.' },
];

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

export function AiPanel({ noteId, live, locked, applyToEditor, onClose }: AiPanelProps) {
  const app = useApp();
  const { api, ai } = app;
  const st = useChat();
  const [draft, setDraft] = useState('');
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const isPrivate = !!app.byId.get(noteId)?.private;
  const idRef = useRef(noteId);
  idRef.current = noteId;
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [st.items.length, st.items.at(-1)]);
  useEffect(() => () => abort.current?.abort(), []);

  /** Put a text into a note: the open note goes through the editor, any other note straight to the vault. */
  const applyNow = async (id: string, patch: { title?: string; body?: string }) => {
    if (id === idRef.current) { applyToEditor(patch); return; }
    await api.saveNote(id, patch);
  };

  const io = (): NoteIO => ({
    read: async id => {
      const p = pendingFor(chat.get(), id);
      if (p) return { id, title: p.title, body: p.body };
      if (app.byId.get(id)?.private) return null;
      if (id === idRef.current) { const l = liveRef.current(); return { id, title: l.title, body: l.body }; }
      const n = await api.getNote(id);
      return n && n.type === 'note' && !n.private ? { id, title: n.title, body: n.body } : null;
    },
    write: async (id, patch) => {
      const cur = await io().read(id);
      if (!cur) throw new Error('Note not found');
      const existing = pendingFor(chat.get(), id);
      const next = { title: patch.title ?? cur.title, body: patch.body ?? cur.body };
      if (ai.autoApply) {
        const was = id === idRef.current ? liveRef.current() : cur;
        await applyNow(id, patch);
        const done: Proposal = { id: `p${chat.nextId()}`, noteId: id, baseTitle: was.title, baseBody: was.body, ...next, state: 'accepted' };
        chat.set(s => ({ ...s, proposals: { ...s.proposals, [done.id]: done }, items: [...s.items, { id: chat.nextId(), kind: 'proposal', proposalId: done.id }] }));
        return 'Updated.';
      }
      const base = existing ? { title: existing.baseTitle, body: existing.baseBody } : id === idRef.current ? liveRef.current() : cur;
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

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || st.busy) return;
    setDraft('');
    const ctl = new AbortController();
    abort.current = ctl;
    const userItem = { id: chat.nextId(), kind: 'user' as const, text: msg };
    chat.set(s => ({ ...s, busy: true, items: [...s.items, userItem] }));
    const history = [...chat.get().history, { role: 'user' as const, content: msg }];
    try {
      const cur = await io().read(noteId);
      const base = buildTools({ vault: api, scope: ai.wholeVault ? { kind: 'vault' } : { kind: 'note', noteId }, io: io() });
      const tools = locked ? base.filter(t => !/^(append_to_note|replace_text|insert_after_heading|update_note|rename_note|add_tags)$/.test(t.spec.name)) : [...base, diagramTool(base)];
      let streaming: number | null = null;
      const added = await runAgent({
        transport: app.aiTransport, tools, history, signal: ctl.signal,
        system: chatSystemPrompt({ note: cur ? { id: noteId, title: cur.title, body: cur.body } : null, wholeVault: ai.wholeVault, today: new Date().toLocaleDateString('en-CA') }),
        onEvent: e => {
          if (e.type === 'text') {
            if (streaming === null) {
              const id = chat.nextId();
              streaming = id;
              chat.set(s => ({ ...s, items: [...s.items, { id, kind: 'assistant', text: e.delta }] }));
            } else {
              const id = streaming;
              chat.set(s => ({ ...s, items: s.items.map(i => (i.id === id && i.kind === 'assistant' ? { ...i, text: i.text + e.delta } : i)) }));
            }
          } else if (e.type === 'tool') {
            streaming = null;
            chat.set(s => ({ ...s, items: [...s.items, { id: chat.nextId(), kind: 'tool', name: e.call.name, label: toolLabel(e.call.name, e.call.args), error: e.error }] }));
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
      chat.set(s => ({ ...s, busy: false }));
      abort.current = null;
    }
  };

  const decide = async (id: string, accept: boolean) => {
    const p = chat.get().proposals[id];
    if (!p || p.state !== 'pending') return;
    if (!accept) { chat.set(s => ({ ...s, proposals: { ...s.proposals, [id]: { ...p, state: 'rejected' } } })); return; }
    const noteId = p.noteId;
    try {
      // the person may have typed since the proposal was made: bring both together instead of overwriting
      const now = noteId === idRef.current ? liveRef.current() : await api.getNote(noteId);
      if (!now) throw new Error('This note is no longer available.');
      let body = p.body;
      if (now.body !== p.baseBody && p.body !== p.baseBody) {
        const r = mergeText(now.body, p.baseBody, p.body);
        if (!r.clean) { app.toast('The note changed since this suggestion, in the same place. Reject it and ask again.', 'error'); return; }
        body = r.text;
      } else if (p.body === p.baseBody) body = now.body;
      await applyNow(noteId, { title: p.title !== p.baseTitle ? p.title : undefined, body: body !== now.body ? body : undefined });
      chat.set(s => ({ ...s, proposals: { ...s.proposals, [id]: { ...p, body, state: 'accepted' } } }));
      void app.refresh();
    } catch (e) { app.toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const undo = async (id: string) => {
    const p = chat.get().proposals[id];
    if (!p || p.state !== 'accepted') return;
    try {
      await applyNow(p.noteId, { title: p.title !== p.baseTitle ? p.baseTitle : undefined, body: p.baseBody });
      chat.set(s => ({ ...s, proposals: { ...s.proposals, [id]: { ...p, state: 'rejected' } } }));
    } catch (e) { app.toast(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const noKey = !ai.hasKey;
  return (
    <aside className={classNames('ai-panel', app.isMobile && 'mobile')} aria-label="AI assistant">
      {!app.isMobile && <Resizer pane="aiW" edge="left" label="Resize AI assistant" />}
      <header className="ai-head">
        <Sparkles size={16} />
        <h3>Assistant</h3>
        <span className="grow" />
        <IconBtn label="Clear conversation" icon={<Trash2 size={16} />} disabled={st.busy || st.items.length === 0} onClick={() => chat.reset()} />
        <IconBtn label="AI settings" icon={<SettingsIcon size={16} />} onClick={() => app.setDialog({ kind: 'settings', tab: 'ai' })} />
        <IconBtn label="Close assistant" icon={<X size={16} />} onClick={onClose} />
      </header>
      <div className="ai-scroll" role="log" aria-live="polite">
        {noKey && (
          <div className="ai-empty">
            <p>Connect an AI provider to ask questions about your notes and have them written, edited or drawn for you.</p>
            <button className="btn primary" onClick={() => app.setDialog({ kind: 'settings', tab: 'ai' })}>Add an API key</button>
          </div>
        )}
        {!noKey && isPrivate && <div className="ai-empty"><p>This note is private, so the assistant cannot see it. Turn off “Private” in the note’s menu to use it here.</p></div>}
        {!noKey && !isPrivate && st.items.length === 0 && (
          <div className="ai-empty">
            <p>{ai.wholeVault ? 'Ask about any of your notes, or have one written.' : 'Ask about this note, or have it edited, extended or illustrated.'}</p>
            <div className="ai-quick">{QUICK.map(q => <button key={q.label} className="chip" onClick={() => void send(q.prompt)}>{q.label}</button>)}</div>
          </div>
        )}
        {st.items.map(it => {
          if (it.kind === 'user') return <div key={it.id} className="ai-msg user">{it.text}</div>;
          if (it.kind === 'assistant') return <div key={it.id} className="ai-msg bot">{it.text}</div>;
          if (it.kind === 'tool') return <div key={it.id} className={classNames('ai-tool', it.error && 'err')}><Wrench size={12} /> {it.label}{it.error ? ' (failed)' : ''}</div>;
          if (it.kind === 'error') return <div key={it.id} className="ai-msg error" role="alert">{it.text}</div>;
          const p = st.proposals[it.proposalId];
          if (!p) return null;
          const title = app.byId.get(p.noteId)?.title ?? p.title;
          return (
            <div key={it.id} className={classNames('ai-proposal', p.state)}>
              <div className="ai-proposal-head">
                <b>{p.state === 'pending' ? 'Suggested changes' : p.state === 'accepted' ? 'Applied' : 'Rejected'}</b>
                <span className="muted"> · {title}</span>
              </div>
              <Diff p={p} />
              {p.state === 'pending' && (
                <div className="ai-proposal-actions">
                  <button className="btn primary" onClick={() => void decide(p.id, true)}><Check size={14} /> Accept</button>
                  <button className="btn" onClick={() => void decide(p.id, false)}><X size={14} /> Reject</button>
                </div>
              )}
              {p.state === 'accepted' && <div className="ai-proposal-actions"><button className="btn" onClick={() => void undo(p.id)}><RotateCcw size={14} /> Undo</button></div>}
            </div>
          );
        })}
        {st.busy && <div className="ai-working"><Loader2 size={14} className="spin" /> Working…</div>}
        {!st.busy && st.usage.input + st.usage.output > 0 && <div className="ai-usage">{st.usage.input.toLocaleString()} in · {st.usage.output.toLocaleString()} out tokens this session</div>}
        <div ref={endRef} />
      </div>
      <form className="ai-input" onSubmit={e => { e.preventDefault(); void send(draft); }}>
        <textarea aria-label="Message the assistant" rows={2} value={draft} disabled={noKey || isPrivate}
          placeholder={noKey ? 'Add an API key first' : 'Ask, or tell it what to write…'}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft); } }} />
        {st.busy
          ? <IconBtn label="Stop" icon={<Square size={16} />} variant="primary" onClick={() => abort.current?.abort()} />
          : <IconBtn label="Send" icon={<Send size={16} />} variant="primary" disabled={noKey || isPrivate || !draft.trim()} onClick={() => void send(draft)} />}
      </form>
    </aside>
  );
}
