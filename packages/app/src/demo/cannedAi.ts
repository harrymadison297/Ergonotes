// The assistant of the public demo: no provider, no key, no network. It answers a few questions with written replies,
// streamed word by word, and shows one search of the notes first, so a visitor sees what the real assistant does.
import type { AiEvent, AiMessage, AiRequest, AiTransport } from '@ergonotes/core';

interface Topic { match: RegExp; search: string; reply: string }

const TOPICS: Topic[] = [
  {
    match: /demo|plan|launch|milestone|todo|next/i, search: 'Ergonotes demo plan',
    reply: `Here is where **Ergonotes demo plan** stands:\n\n- Done: the seed vault, canned replies for me, and the landing page.\n- Next: a short habit check-in clip (due in 2 days) and asking five friends to try it.\n- Launch day is in 5 days, at 10:00.\n\nThe riskiest item is *Read every sentence out loud* in the launch checklist, because it is due tomorrow and nobody has started it.\n\n(These are canned replies. In the installed app I answer from your own notes with your own OpenRouter or Anthropic key.)`,
  },
  {
    match: /run|marathon|train|pace|race/i, search: 'Half marathon',
    reply: `From **Half marathon** and **Running log**:\n\n- Target: 1:45:00, which is about 4:59 per kilometre.\n- Your last long run was 12 km and felt tired after 9, so the next one at 14 km is worth keeping easy.\n- The race is in 38 days, which fits the plan with a rest week in week 4.\n\nWant me to add a task to book the hotel? In the installed app I can write it into the note for you to accept.`,
  },
  {
    match: /water|hydrat|drink|habit|streak/i, search: 'Hydration',
    reply: `Your habits are kept in a hidden folder and are never mixed into your notes. Water is the steadiest one: you have drunk your 2 litres on most days lately, and today is already checked in. Journalling is the one that slips, mostly on late evenings.\n\nA habit only stores what you did; the streaks and misses you see on Home are worked out each time.`,
  },
  {
    match: /summar|week|today|overview|what.*(have|did)/i, search: 'tasks',
    reply: `A quick look at your week:\n\n1. **Today:** call the dentist (reminder at 12:00).\n2. **This week:** try on trail shoes, test the demo on a phone, finish the headline.\n3. **Coming up:** dinner with the neighbours, launch day, and the race.\n\nNotes marked private, like your journal, are never sent to me, so they are not in this summary.`,
  },
];

const FALLBACK: Topic = {
  match: /./, search: '',
  reply: `This is the demo assistant, so I only have a few written answers. Try asking about **the demo plan**, **your running**, **your habits** or **a summary of the week**.\n\nIn the installed apps I read and edit your notes with the model you choose, and notes marked private never leave your device.`,
};

const lastUser = (messages: AiMessage[]): string => {
  for (let i = messages.length - 1; i >= 0; i--) { const m = messages[i]; if (m.role === 'user') return m.content; }
  return '';
};
const topicOf = (messages: AiMessage[]): Topic => {
  const q = lastUser(messages);
  return TOPICS.find(t => t.match.test(q)) ?? FALLBACK;
};
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>(res => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
});

export const cannedTransport: AiTransport = async function* (req: AiRequest, signal?: AbortSignal): AsyncGenerator<AiEvent> {
  // the small suggestion model is off in the demo
  if (req.model === 'suggest') { yield { type: 'done' }; return; }
  const topic = topicOf(req.messages);
  const last = req.messages[req.messages.length - 1];
  const canSearch = !!req.tools?.some(t => t.name === 'search_notes');
  if (last?.role === 'user' && topic.search && canSearch) {
    await sleep(350, signal);
    yield { type: 'tool_call', call: { id: 'demo-search', name: 'search_notes', args: { query: topic.search } } };
    yield { type: 'done' };
    return;
  }
  await sleep(250, signal);
  for (const part of topic.reply.match(/\S+\s*|\n+/g) ?? []) {
    if (signal?.aborted) break;
    yield { type: 'text', delta: part };
    await sleep(22, signal);
  }
  yield { type: 'done' };
};
