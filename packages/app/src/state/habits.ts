// Small helpers for showing Habits (the rules themselves are in the core: habit.ts).
import type { DayState, HabitInfo, Nudge } from '@ergonotes/core';

export const hhmm = (d = new Date()): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** "once a day", "8 times a day", "2 times in 3 days" */
export function describeTarget(h: { target: number; per: number }): string {
  const times = h.target === 1 ? 'once' : h.target === 2 ? 'twice' : `${h.target} times`;
  return h.per === 1 ? `${times} a day` : `${times} in ${h.per} days`;
}

/** "3/8" — what has been done in the window that ends today, of what is wanted */
export const progress = (h: Pick<HabitInfo, 'target' | 'status'>): string => `${Math.min(h.status.inWindow, h.target)}/${h.target}`;

export const isMet = (h: HabitInfo): boolean => h.status.todayState === 'met';
/** Habits that still want something today: shown as tasks on Home, the Calendar and the Tasks page */
export const openToday = (hs: HabitInfo[]): HabitInfo[] => hs.filter(h => !h.archived && h.status.todayState === 'pending');

export const STATE_WORD: Record<DayState, string> = { met: 'met', behind: 'behind', exempt: 'not counted', pending: 'still open', future: '' };

/** The Habit whose message matters most now: firm before gentle before good (a milestone before an ordinary day done). */
export function topNudge(hs: HabitInfo[]): { habit: HabitInfo; nudge: Nudge } | null {
  const rank = (n: Nudge) => (n.tone === 'firm' ? 3 : n.tone === 'gentle' ? 2 : n.key.startsWith('streak') ? 1 : 0);
  let best: { habit: HabitInfo; nudge: Nudge } | null = null;
  for (const h of hs) {
    if (!h.nudge || h.archived) continue;
    if (!best || rank(h.nudge) > rank(best.nudge) || (rank(h.nudge) === rank(best.nudge) && h.status.missed > best.habit.status.missed)) best = { habit: h, nudge: h.nudge };
  }
  return best;
}

/** What the chip of a mention says: the streak and where today stands. */
export function habitChip(h: HabitInfo): { text: string; met: boolean } {
  const met = h.status.todayState === 'met';
  const streak = h.status.streak > 0 ? `${h.status.streak}-day streak` : 'no streak yet';
  return { met, text: `${streak} · ${h.archived ? 'archived' : met ? 'met today' : h.status.todayState === 'exempt' ? 'not counted yet' : `${h.status.left} to go`}` };
}

// ---- a message put away for today stays away (this Device only)
const KEY = 'ergo.nudges';
function read(day: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { day: string; keys: string[] } | null;
    return v && v.day === day ? new Set(v.keys) : new Set();
  } catch { return new Set(); }
}
export const nudgeId = (h: HabitInfo, n: Nudge): string => `${h.id}:${n.key}`;
export const nudgeDismissed = (day: string, id: string): boolean => read(day).has(id);
export function dismissNudge(day: string, id: string) {
  const s = read(day); s.add(id);
  try { localStorage.setItem(KEY, JSON.stringify({ day, keys: [...s] })); } catch { /* private window */ }
}
