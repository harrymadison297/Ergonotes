import { AlertTriangle, Cloud, CloudOff, Loader2, RefreshCw } from 'lucide-react';
import { useApp } from '../state/app';
import { relTime } from '../state/util';

/** Sync status for the sidebar footer and the phone's More page: icon, wording, and the action. */
export function useSync() {
  const app = useApp();
  const st = app.status;
  const noStore = !st.store;
  let icon = <Cloud size={18} />;
  let text = 'Synced';
  let dot: 'ok' | 'err' | 'busy' | null = null;
  let err = false;
  if (st.syncing) { icon = <Loader2 size={18} className="spin" />; text = 'Syncing…'; dot = 'busy'; }
  else if (noStore) { icon = <CloudOff size={18} />; text = 'Local only'; }
  else if (st.lastSyncError) { icon = <AlertTriangle size={18} />; text = 'Sync problem'; err = true; dot = 'err'; }
  else if (st.pending > 0) { icon = <RefreshCw size={18} />; text = `${st.pending} waiting`; dot = 'busy'; }
  else if (st.lastSyncAt) { text = `Synced ${relTime(st.lastSyncAt)}`; dot = 'ok'; }
  const label = st.lastSyncError ?? (noStore ? 'Choose storage to sync between devices' : `${text}. Sync now`);
  const run = async () => {
    if (noStore) return app.setDialog({ kind: 'settings', tab: 'sync' });
    const r = await app.run(app.api.sync());
    await app.refresh();
    if (r?.error) app.toast(r.error, 'error'); else if (r) app.toast(r.pulled || r.pushed ? `Synced: ${r.pulled} received, ${r.pushed} sent` : 'Everything is up to date');
  };
  return { icon, text, dot, err, label, run };
}
