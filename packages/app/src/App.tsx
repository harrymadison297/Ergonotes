import { useEffect, useState } from 'react';
import type { VaultStatus } from '@ergonotes/core';
import { createBackend, type Backend } from './backend';
import { Gate } from './components/Gate';
import { Shell } from './components/Shell';
import { AppProvider } from './state/app';

export function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    createBackend()
      .then(async b => { setBackend(b); setStatus(await b.api.status()); })
      .catch(e => setFatal(String(e?.message ?? e)));
  }, []);

  if (fatal) return <div className="gate"><div className="gate-card"><h1>Ergonotes could not start</h1><p>{fatal}</p></div></div>;
  if (!backend || !status) return <div className="gate" aria-busy="true" />;

  const ready = status.state === 'ready' && (!status.remote || status.authenticated);
  if (!ready) {
    return <Gate backend={backend} status={status} onReady={async () => setStatus(await backend.api.status())} />;
  }
  return (
    <AppProvider backend={backend} status={status}>
      <Shell />
    </AppProvider>
  );
}
