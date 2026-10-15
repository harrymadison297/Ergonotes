// The assistant conversation on screen. It is saved to the vault (so it has a history on every device) by the panel.
import { useSyncExternalStore } from 'react';
import type { AiMessage } from '@ergonotes/core';

/** `text` is set for a file taken from the device (it is not in the vault) */
export interface Mention { kind: 'note' | 'file'; id: string; title: string; text?: string }

export interface Proposal {
  id: string;
  noteId: string;
  /** the note as it is saved now */
  baseTitle: string;
  baseBody: string;
  title: string;
  body: string;
  /** `closed`: a proposal from an earlier session, whose base may be out of date, so it can no longer be applied */
  state: 'pending' | 'accepted' | 'rejected' | 'closed';
}
export type ChatItem =
  | { id: number; kind: 'user'; text: string; mentions: Mention[] }
  | { id: number; kind: 'assistant'; text: string }
  /** `noteId`: the note a tool created, so the chat can link to it */
  | { id: number; kind: 'tool'; name: string; label: string; error: boolean; noteId?: string }
  | { id: number; kind: 'proposal'; proposalId: string }
  | { id: number; kind: 'error'; text: string };

export interface ChatState {
  /** the saved conversation this is, once it has been saved */
  convId: string | null;
  items: ChatItem[];
  /** what the model has been told so far */
  history: AiMessage[];
  /** by proposal id; while a proposal is pending, further edits to its note go into it */
  proposals: Record<string, Proposal>;
  busy: boolean;
  /** "the provider is busy, trying again…" */
  notice: string | null;
  usage: { input: number; output: number };
}

const fresh = (): ChatState => ({ convId: null, items: [], history: [], proposals: {}, busy: false, notice: null, usage: { input: 0, output: 0 } });
let state: ChatState = fresh();
let seq = 0;
const listeners = new Set<() => void>();

export const chat = {
  get: () => state,
  set(fn: (s: ChatState) => ChatState) { state = fn(state); listeners.forEach(l => l()); },
  nextId: () => ++seq,
  /** a new, empty conversation */
  reset() { state = fresh(); listeners.forEach(l => l()); },
  /** open a saved conversation */
  load(s: Omit<ChatState, 'busy' | 'notice'>) {
    seq = Math.max(seq, ...s.items.map(i => i.id), 0);
    state = { ...s, busy: false, notice: null };
    listeners.forEach(l => l());
  },
};

export function useChat(): ChatState {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state);
}

/** The proposal for a note that is still waiting for an answer. */
export const pendingFor = (s: ChatState, noteId: string): Proposal | undefined =>
  Object.values(s.proposals).find(p => p.noteId === noteId && p.state === 'pending');

// ---- what is written to the vault
const MAX_TOOL_TEXT = 3000;

/** A conversation as JSON text: long tool results and the bodies of settled proposals are cut, they only cost space. */
export function serializeChat(s: ChatState): string {
  const history = s.history.map(m => (m.role === 'tool' && m.content.length > MAX_TOOL_TEXT ? { ...m, content: m.content.slice(0, MAX_TOOL_TEXT) + '\n…(cut)' } : m));
  const proposals: Record<string, Proposal> = {};
  for (const [id, p] of Object.entries(s.proposals)) proposals[id] = p.state === 'pending' ? p : { ...p, baseBody: '', body: '' };
  // a file taken from the device is in `history` already; the chip only needs its name
  const items = s.items.map(i => (i.kind === 'user' && i.mentions.some(m => m.text !== undefined) ? { ...i, mentions: i.mentions.map(({ text: _t, ...m }) => m) } : i));
  return JSON.stringify({ v: 1, items, history, proposals, usage: s.usage });
}

export function parseChat(id: string, data: string): Omit<ChatState, 'busy' | 'notice'> | null {
  try {
    const j = JSON.parse(data) as Partial<ChatState>;
    if (!Array.isArray(j.items) || !Array.isArray(j.history)) return null;
    const proposals: Record<string, Proposal> = {};
    // a proposal still open when the conversation was saved can no longer be applied safely
    for (const [pid, p] of Object.entries(j.proposals ?? {})) proposals[pid] = p.state === 'pending' ? { ...p, state: 'closed' } : p;
    return { convId: id, items: j.items, history: j.history, proposals, usage: j.usage ?? { input: 0, output: 0 } };
  } catch { return null; }
}
