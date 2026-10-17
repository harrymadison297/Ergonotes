/** Set on this Device when the person chose "Join an existing vault": the first-run set-up must not make a new vault meanwhile. */
export const JOIN_FLAG = 'ergo.join';

export function wantsToJoin(): boolean {
  try { return localStorage.getItem(JOIN_FLAG) === '1'; } catch { return false; }
}
export function setWantsToJoin(on: boolean) {
  try { if (on) localStorage.setItem(JOIN_FLAG, '1'); else localStorage.removeItem(JOIN_FLAG); } catch { /* private window */ }
}
