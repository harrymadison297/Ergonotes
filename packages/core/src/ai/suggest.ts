// Next-words suggestion ("ghost text"): the request to send and the clean-up of the answer.
import type { AiMessage, AiRequest } from './types.ts';

const BEFORE = 1500;
const AFTER = 300;
const CURSOR = '<CURSOR>';

export const SUGGEST_SYSTEM =
  'You are the autocomplete of a note-taking app. The user\'s note has a <CURSOR> marker. Write only the text that should be typed at the cursor.\n' +
  'Rules:\n' +
  '- Continue the sentence naturally, in the same language and style, in 3 to 12 words. Do not start a new topic.\n' +
  '- Never repeat any text that is before the cursor, and never write what already follows it.\n' +
  '- If the text ends in the middle of a word, continue that word with no space. If it ends with a complete word, start with a space. If it ends with a space, do not start with another one.\n' +
  '- Reply with the text as a single JSON string and nothing else, so that spaces are visible. If nothing sensible fits, reply with "".';

/** Worked examples, as earlier turns of the conversation: they teach the format and the spacing better than rules do. */
const EXAMPLES: AiMessage[] = [
  { role: 'user', content: `Note: Weekly sync\n\nWe agreed to ship the${CURSOR}` },
  { role: 'assistant', content: '" first version next week"' },
  { role: 'user', content: `Note: About me\n\nI am a software en${CURSOR}` },
  { role: 'assistant', content: '"gineer who builds mobile apps"' },
  { role: 'user', content: `Note: Shopping\n\nFor the party I still need balloons, candles and ${CURSOR}` },
  { role: 'assistant', content: '"a birthday cake"' },
  { role: 'user', content: `Note: Plan\n\nTodo:\n- call the bank\n- ${CURSOR}\n- book the hotel` },
  { role: 'assistant', content: '"pay the electricity bill"' },
];

export function suggestionRequest(input: { title: string; before: string; after: string }): AiRequest {
  const before = input.before.slice(-BEFORE);
  const after = input.after.slice(0, AFTER);
  return {
    model: 'suggest', system: SUGGEST_SYSTEM, maxTokens: 60, temperature: 0.3,
    messages: [...EXAMPLES, { role: 'user', content: `Note: ${input.title || 'Untitled'}\n\n${before}${CURSOR}${after}` }],
  };
}

const WORD = /[\p{L}\p{N}]/u;

/** The text inside the model's JSON string. Falls back to the raw answer when it ignored the format. */
function unwrap(raw: string): { text: string; quoted: boolean } {
  const s = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const a = s.indexOf('"');
  const b = s.lastIndexOf('"');
  if (a >= 0 && b > a) {
    const inner = s.slice(a, b + 1);
    try { const v: unknown = JSON.parse(inner); if (typeof v === 'string') return { text: v, quoted: true }; } catch { /* fall through */ }
    return { text: inner.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"'), quoted: true };
  }
  return { text: s.replace(/^\s*(continuation:)\s*/i, ''), quoted: false };
}

/** Drop what the model repeated from the end of `before` (it often restarts the sentence). */
function withoutRepeat(text: string, before: string): string {
  const tail = before.slice(-400).toLowerCase();
  const low = text.toLowerCase();
  const lead = low.length - low.trimStart().length;
  for (let k = Math.min(low.length - lead, tail.length); k >= 4; k--) {
    if (tail.endsWith(low.slice(lead, lead + k))) {
      const start = tail.length - k;
      // only at a word boundary: "…the cat" + "cat sat" repeats, "…the c" + "cat" does not
      if (start === 0 || !WORD.test(tail[start - 1]) || !WORD.test(tail[start])) return text.slice(lead + k);
    }
  }
  return text;
}

const MAX_WORDS = 14;

/** The model may wrap, repeat or ramble: keep one short continuation that really continues `before`. */
export function cleanSuggestion(raw: string, before: string): string {
  const { text: t0, quoted } = unwrap(raw);
  let s = t0.replace(/\r/g, '');
  const para = s.search(/\n\s*\n/);
  if (para >= 0) s = s.slice(0, para);
  s = withoutRepeat(s.replace(/\n+$/, ''), before);
  if (s.trim() === '') return '';
  const endsSpace = /\s$/.test(before);
  if (endsSpace) s = s.replace(/^[ \t]+/, '');
  // a model that ignored the JSON format lost its leading space on the way: assume a new word
  else if (!quoted && WORD.test(s[0]) && WORD.test(before.slice(-1))) s = ' ' + s;
  // short is better than clever
  const words = s.split(/(\s+)/);
  let n = 0, out = '';
  for (const part of words) {
    if (part.trim()) { if (++n > MAX_WORDS) break; }
    out += part;
  }
  s = out.trimEnd();
  return s.length > 240 ? s.slice(0, 240).replace(/\s+\S*$/, '') : s;
}
