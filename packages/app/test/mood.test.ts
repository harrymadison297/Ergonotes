// The hand-drawn faces: which one goes with which Nudge, and that every one is drawn in the text colour.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nudgeFor, habitStatus, addDays, type HabitDef, type Nudge } from '@ergonotes/core';
import { MOODS, moodForGreeting, moodForNudge } from '../src/state/mood';

const nudge = (key: string, tone: Nudge['tone'] = 'good'): Nudge => ({ key, tone, text: '' });

describe('the face of a nudge', () => {
  it('is prouder with the streak', () => {
    expect(moodForNudge(nudge('done-2026-10-17'))).toBe('heart-eyes');
    expect(moodForNudge(nudge('streak-3'))).toBe('relaxed');
    expect(moodForNudge(nudge('streak-7'))).toBe('angel');
    expect(moodForNudge(nudge('streak-14'))).toBe('angel');
    for (const k of [30, 60, 100]) expect(moodForNudge(nudge(`streak-${k}`))).toBe('crown');
  });
  it('is more worried with the days missed', () => {
    expect(moodForNudge(nudge('missed-1-2026-10-17', 'gentle'))).toBe('surprised');
    expect(moodForNudge(nudge('missed-2-2026-10-17', 'gentle'))).toBe('sweat');
    expect(moodForNudge(nudge('missed-3-2026-10-17', 'gentle'))).toBe('sad');
    expect(moodForNudge(nudge('missed-7-2026-10-17', 'firm'))).toBe('annoyed');
  });
  it('has a face for every nudge the core can give', () => {
    const def: HabitDef = { target: 1, per: 1, start: null, archived: false };
    const today = '2026-10-17';
    const seen = new Set<string>();
    for (let missed = 0; missed <= 9; missed++) {
      const n = nudgeFor(habitStatus(def, [{ date: addDays(today, -missed - 1) }], today));
      if (n) { seen.add(moodForNudge(n)); expect(MOODS).toContain(moodForNudge(n)); }
    }
    for (let streak = 1; streak <= 100; streak++) {
      const ins = Array.from({ length: streak }, (_, i) => ({ date: addDays(today, -i) }));
      const n = nudgeFor(habitStatus(def, ins, today));
      if (n) { seen.add(moodForNudge(n)); expect(MOODS).toContain(moodForNudge(n)); }
    }
    expect([...seen].sort()).toEqual(['angel', 'annoyed', 'crown', 'heart-eyes', 'relaxed', 'sad', 'surprised', 'sweat']);
  });
});

describe('the face of the greeting', () => {
  it('sleeps at night, is delighted when all is met, and is relaxed otherwise', () => {
    expect(moodForGreeting(2, true)).toBe('sleeping');
    expect(moodForGreeting(23, false)).toBe('sleeping');
    expect(moodForGreeting(10, true)).toBe('delighted');
    expect(moodForGreeting(10, false)).toBe('relaxed');
  });
});

describe('the pictures', () => {
  it('are all there, draw in the text colour and carry nothing active', () => {
    for (const m of MOODS) {
      const svg = readFileSync(new URL(`../src/assets/mood/${m}.svg`, import.meta.url), 'utf8');
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('currentColor');
      expect(svg).not.toMatch(/black|#000|<script|href=|onload/i);
    }
  });
});
