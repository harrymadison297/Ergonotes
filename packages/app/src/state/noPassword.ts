import type { AppCtx } from './app';

/**
 * ADR 0012: a vault with no password is protected by nothing once it is on a Store or holds an AI key. The person is told
 * once for each such thing (this Device remembers it) and is offered the way out; nothing is blocked.
 */
const WORDS = {
  store: 'This vault has no password, so what is stored on your storage is not secret. ',
  ai: 'This vault has no password, so the API key is saved unprotected. ',
} as const;

export function warnNoPassword(app: Pick<AppCtx, 'status' | 'toast' | 'setDialog'>, why: keyof typeof WORDS) {
  if (app.status.hasPassword) return;
  const key = `ergo.nopw.${why}`;
  try { if (localStorage.getItem(key) === '1') return; localStorage.setItem(key, '1'); } catch { /* private window: tell each time */ }
  app.toast(WORDS[why] + 'Set a password to protect it.', 'info', { label: 'Set password', run: () => app.setDialog({ kind: 'settings', tab: 'security' }) });
}
