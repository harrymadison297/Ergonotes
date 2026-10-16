// Which frames of a recorded meeting to cut (ADR 0011). The model only recommends; the person confirms.
import { completeText } from './providers.ts';
import type { AiTransport } from './types.ts';

export interface FrameToJudge { second: number; jpeg: string }
export interface FrameJudgement {
  /** seconds of the frames the model would cut */
  cut: number[];
  /** frames in batches the model could not judge: they are kept */
  failed: number;
}
export interface JudgeOptions { batch?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }

const SYSTEM = [
  'You help someone tidy the frames of a recorded lecture or meeting. Each one is a picture of the shared screen, taken at the time given.',
  'The frames come from the latest to the earliest, so "after" below means a frame with a later time.',
  'Cut a frame when a frame after it shows the same content as completely (a slide or a board only fills up, so the later one is the one to keep; only a cursor, a scroll bar, a notification or a blink differ), a blank or loading screen, or one so blurred or cut off that it cannot be read.',
  'Keep a frame that shows content the frames after it do not: an earlier slide, a diagram or board before it was erased, a demo step, a document.',
  'Reply with only JSON of this shape: {"cut":[3,5]} where the numbers are the frame numbers to cut. {"cut":[]} cuts nothing.',
].join(' ');

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The numbers of the reply, wherever the model put its JSON. */
export function parseCut(reply: string, count: number): number[] | null {
  const m = /\{[^{}]*\}/.exec(reply);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { cut?: unknown };
    if (!Array.isArray(j.cut)) return null;
    return [...new Set(j.cut.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= count))];
  } catch { return null; }
}

export async function recommendCuts(transport: AiTransport, frames: FrameToJudge[], o: JudgeOptions = {}): Promise<FrameJudgement> {
  const size = Math.max(2, o.batch ?? 8);
  const cut: number[] = [];
  let failed = 0;
  let reference: FrameToJudge | null = null; // the last frame kept so far (the earliest): what the next batch is compared with
  // from the latest frame to the earliest, so that of frames that repeat each other the latest is the one that stays
  const ordered = [...frames].reverse();
  for (let i = 0; i < ordered.length; i += size) {
    if (o.signal?.aborted) break;
    const batch = ordered.slice(i, i + size);
    const images = [...(reference ? [reference.jpeg] : []), ...batch.map(f => f.jpeg)];
    const lines = [
      ...(reference ? [`The first image is a frame kept already (at ${clock(reference.second)}), later than these. It is only for comparing: do not number it.`] : []),
      ...batch.map((f, n) => `Frame ${n + 1}: at ${clock(f.second)}`),
      'Which frames should be cut?',
    ];
    try {
      const reply = await completeText(transport, { model: 'vision', system: SYSTEM, messages: [{ role: 'user', content: lines.join('\n'), images }], maxTokens: 200, temperature: 0 }, o.signal);
      const nums = parseCut(reply, batch.length);
      if (!nums) throw new Error('unreadable reply');
      const drop = new Set(nums);
      batch.forEach((f, n) => { if (drop.has(n + 1)) cut.push(f.second); });
      const kept = batch.filter((_, n) => !drop.has(n + 1));
      if (kept.length) reference = kept[kept.length - 1];
    } catch (e) {
      if (o.signal?.aborted) break;
      // a provider that is down for everything should say so, not look like "nothing to cut"
      if (i === 0 && e instanceof Error && !/unreadable reply/.test(e.message)) throw e;
      failed += batch.length;
      reference = batch[batch.length - 1];
    }
    o.onProgress?.(Math.min(ordered.length, i + size), ordered.length);
  }
  return { cut: cut.sort((a, b) => a - b), failed };
}
