// Mood pictures (CONTEXT.md): the hand-drawn faces that go with a Nudge, an empty Widget or page, and the greeting.
import type { Nudge } from '@ergonotes/core';

export const MOODS = ['crown', 'annoyed', 'heart-eyes', 'angel', 'surprised', 'sweat', 'sleeping', 'relaxed', 'sad', 'delighted'] as const;
export type MoodName = (typeof MOODS)[number];

/** The face for a Nudge: the bigger the streak, the prouder; the more days missed, the more worried. */
export function moodForNudge(n: Pick<Nudge, 'key' | 'tone'>): MoodName {
  const m = /^(streak|missed)-(\d+)/.exec(n.key);
  if (m) {
    const k = Number(m[2]);
    if (m[1] === 'streak') return k >= 30 ? 'crown' : k >= 7 ? 'angel' : 'relaxed';
    return k >= 7 ? 'annoyed' : k >= 3 ? 'sad' : k === 2 ? 'sweat' : 'surprised';
  }
  return n.tone === 'good' ? 'heart-eyes' : n.tone === 'firm' ? 'annoyed' : 'surprised';
}

/** The face of the greeting: asleep late at night, delighted when every habit is met today, relaxed otherwise. */
export function moodForGreeting(hour: number, allMet: boolean): MoodName {
  if (hour >= 23 || hour < 5) return 'sleeping';
  return allMet ? 'delighted' : 'relaxed';
}
