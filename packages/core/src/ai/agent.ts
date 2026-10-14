// The chat agent: a loop of "model answers or asks for tools -> run the tools -> model continues".
import type { AiEvent, AiMessage, AiToolCall, AiToolSpec, AiTransport } from './types.ts';

export interface AgentTool { spec: AiToolSpec; run(args: Record<string, unknown>): Promise<string> }

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; call: AiToolCall; result: string; error: boolean }
  | { type: 'usage'; input: number; output: number };

export interface AgentRun {
  transport: AiTransport;
  system: string;
  /** earlier turns of the conversation, ending with the user's new message */
  history: AiMessage[];
  tools: AgentTool[];
  signal?: AbortSignal;
  onEvent(e: AgentEvent): void;
  /** safety net against a model that never stops asking for tools */
  maxSteps?: number;
}

export const AGENT_MAX_STEPS = 50;

/** Runs until the model answers without asking for a tool. Returns the messages added to `history`. */
export async function runAgent(run: AgentRun): Promise<AiMessage[]> {
  const added: AiMessage[] = [];
  const messages = [...run.history];
  const byName = new Map(run.tools.map(t => [t.spec.name, t]));
  const limit = run.maxSteps ?? AGENT_MAX_STEPS;
  for (let step = 0; step < limit; step++) {
    if (run.signal?.aborted) break;
    let text = '';
    const calls: AiToolCall[] = [];
    for await (const e of run.transport({ model: 'chat', system: run.system, messages, tools: run.tools.map(t => t.spec) }, run.signal) as AsyncIterable<AiEvent>) {
      if (e.type === 'text') { text += e.delta; run.onEvent({ type: 'text', delta: e.delta }); }
      else if (e.type === 'tool_call') calls.push(e.call);
      else if (e.type === 'usage') run.onEvent({ type: 'usage', input: e.input, output: e.output });
    }
    const assistant: AiMessage = { role: 'assistant', content: text, ...(calls.length ? { toolCalls: calls } : {}) };
    messages.push(assistant);
    added.push(assistant);
    if (calls.length === 0) return added;
    for (const c of calls) {
      if (run.signal?.aborted) break;
      const tool = byName.get(c.name);
      let result: string;
      let error = false;
      if (!tool) { result = `Error: there is no tool called ${c.name}.`; error = true; }
      else {
        try { result = await tool.run(c.args); } catch (e) { result = `Error: ${e instanceof Error ? e.message : String(e)}`; error = true; }
      }
      run.onEvent({ type: 'tool', call: c, result, error });
      const msg: AiMessage = { role: 'tool', callId: c.id, name: c.name, content: result };
      messages.push(msg);
      added.push(msg);
    }
  }
  if (!run.signal?.aborted) {
    const stop: AiMessage = { role: 'assistant', content: '(Stopped: too many steps in one request.)' };
    run.onEvent({ type: 'text', delta: stop.content });
    added.push(stop);
  }
  return added;
}

const MAX_NOTE_CHARS = 200_000;

export interface PromptInput {
  /** the open note, when there is one */
  note: { id: string; title: string; body: string } | null;
  wholeVault: boolean;
  today: string;
}

export function chatSystemPrompt(p: PromptInput): string {
  const lines = [
    'You are the assistant inside Ergonotes, a personal note-taking app. The user writes notes in Markdown.',
    `Today is ${p.today}. Answer in the language the user writes in. Be concise.`,
    'You can read and change notes only through your tools. Never claim you changed a note unless a tool confirmed it.',
    'Edits to a note are shown to the user as a proposal they accept or reject; say what you changed in one or two sentences.',
    'Prefer replace_text, insert_after_heading and append_to_note over update_note, which replaces the whole body. Read a note before you edit it.',
    'Tasks are Markdown checklists: `- [ ] text @due(2026-10-15T17:00) @remind(2026-10-15T16:30) @flag`. Link notes with `[[<note-id>|Title]]`.',
    'To draw a diagram, call insert_diagram with Mermaid source (flowchart, sequenceDiagram, mindmap, classDiagram). Do not hand-write drawing data.',
    p.wholeVault
      ? 'You may search and read any note except those the user marked private.'
      : 'You can only see the note that is open. You cannot search or list other notes.',
  ];
  if (p.note) {
    const body = p.note.body.length > MAX_NOTE_CHARS ? p.note.body.slice(0, MAX_NOTE_CHARS) + '\n…(truncated)' : p.note.body;
    lines.push('', `The open note has id ${p.note.id} and the title "${p.note.title}". Its Markdown:`, '<<<NOTE', body, 'NOTE>>>');
  } else lines.push('', 'No note is open.');
  return lines.join('\n');
}
