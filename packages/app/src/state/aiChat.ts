// The chat conversation lives for the length of the app session (nothing about it is stored in the vault).
import { useSyncExternalStore } from 'react';
import type { AiMessage } from '@ergonotes/core';

export interface Proposal {
  id: string;
  noteId: string;
  /** the note as it is saved now */
  baseTitle: string;
  baseBody: string;
  title: string;
  body: string;
  state: 'pending' | 'accepted' | 'rejected';
}
export type ChatItem =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string }
  | { id: number; kind: 'tool'; name: string; label: string; error: boolean }
  | { id: number; kind: 'proposal'; proposalId: string }
  | { id: number; kind: 'error'; text: string };

export interface ChatState {
  items: ChatItem[];
  /** what the model has been told so far */
  history: AiMessage[];
  /** by proposal id; while a proposal is pending, further edits to its note go into it */
  proposals: Record<string, Proposal>;
  busy: boolean;
  usage: { input: number; output: number };
}

const EMPTY: ChatState = { items: [], history: [], proposals: {}, busy: false, usage: { input: 0, output: 0 } };
let state: ChatState = EMPTY;
let seq = 0;
const listeners = new Set<() => void>();

export const chat = {
  get: () => state,
  set(fn: (s: ChatState) => ChatState) { state = fn(state); listeners.forEach(l => l()); },
  nextId: () => ++seq,
  reset() { state = { ...EMPTY, items: [], history: [], proposals: {} }; listeners.forEach(l => l()); },
};

export function useChat(): ChatState {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state);
}

/** The proposal for a note that is still waiting for an answer. */
export const pendingFor = (s: ChatState, noteId: string): Proposal | undefined =>
  Object.values(s.proposals).find(p => p.noteId === noteId && p.state === 'pending');
