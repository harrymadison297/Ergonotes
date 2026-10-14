// Next-words suggestion ("ghost text"): the request to send and the clean-up of the answer.
import type { AiRequest } from './types.ts';

const BEFORE = 700;
const AFTER = 200;

export const SUGGEST_SYSTEM =
  'You are the autocomplete of a note-taking app. Continue the text exactly where it stops, in the same language and style. ' +
  'Reply with only the continuation: at most 12 words, no quotes, no explanation, never repeat the text. ' +
  'Start with a space when the continuation begins a new word. If nothing sensible follows, reply with nothing.';

export function suggestionRequest(input: { title: string; before: string; after: string }): AiRequest {
  const before = input.before.slice(-BEFORE);
  const after = input.after.slice(0, AFTER);
  return {
    model: 'suggest', system: SUGGEST_SYSTEM, maxTokens: 60, temperature: 0.3,
    messages: [{
      role: 'user',
      content: `Note title: ${input.title || 'Untitled'}\n\nText before the cursor:\n<<<\n${before}\n>>>\n` +
        (after.trim() ? `\nText after the cursor:\n<<<\n${after}\n>>>\n` : '') + '\nContinuation:',
    }],
  };
}

/** The model may wrap, repeat or ramble: keep one short continuation that really continues `before`. */
export function cleanSuggestion(raw: string, before: string): string {
  let s = raw.replace(/^\s*(continuation:)\s*/i, '');
  const q = /^["'“‘`](.*)["'”’`]$/s.exec(s.trim());
  if (q) s = (/^\s/.test(s) ? ' ' : '') + q[1];
  s = s.replace(/\r/g, '');
  const para = s.search(/\n\s*\n/);
  if (para >= 0) s = s.slice(0, para);
  s = s.replace(/\n+$/, '');
  if (s.trim() === '') return '';
  const tail = before.slice(-60);
  const probe = s.trim().slice(0, 40);
  if (probe.length >= 8 && tail.includes(probe)) return ''; // it repeated what is already there
  if (/^[A-Za-z0-9À-ɏ]/.test(s) && /[A-Za-z0-9À-ɏ,.;:!?)]$/.test(before)) s = ' ' + s;
  return s.length > 240 ? s.slice(0, 240).replace(/\s+\S*$/, '') : s;
}
