import { useEffect, useState } from 'react';
import type { VaultStatus } from '@ergonotes/core';
import { createBackend, type Backend } from './backend';
import { Gate } from './components/Gate';
import { LoadingScreen } from './components/CurveLoader';
import { Shell } from './components/Shell';
import { AppProvider } from './state/app';
import { JOIN_FLAG } from './state/firstRun';
import { ConfirmHost } from './state/confirm';

/**
 * A first launch on an installed app (desktop, Android) opens a vault with no password in the default folder and shows the
 * app: ADR 0012. The web and the server peer still ask for a password; so does a person who chose to join an existing vault.
 */
async function firstRun(backend: Backend, status: VaultStatus): Promise<VaultStatus> {
  const alone = status.state === 'no-vault' && backend.mode === 'local' && !!backend.folder && localStorage.getItem(JOIN_FLAG) !== '1';
  if (!alone) return status;
  await backend.api.createVault('', { noPassword: true, deviceName: status.deviceName });
  return backend.api.status();
}

export function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [step, setStep] = useState<string | undefined>(undefined);

  useEffect(() => {
    createBackend()
      .then(async b => {
        setBackend(b);
        const st = await b.api.status();
        if (st.state === 'no-vault' && b.mode === 'local' && b.folder) setStep('Setting up your notes…');
        setStatus(await firstRun(b, st));
      })
      .catch(e => setFatal(String(e?.message ?? e)));
  }, []);

  if (fatal) return <div className="gate"><div className="gate-card"><h1>Ergonotes could not start</h1><p>{fatal}</p></div></div>;
  if (!backend || !status) return <LoadingScreen text={step} />;

  const ready = status.state === 'ready' && (!status.remote || status.authenticated);
  if (!ready) {
    return <><Gate backend={backend} status={status} onReady={async () => setStatus(await backend.api.status())} /><ConfirmHost /></>;
  }
  return (
    <AppProvider backend={backend} status={status}>
      <Shell />
      <ConfirmHost />
    </AppProvider>
  );
}
