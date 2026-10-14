import { useState, type FormEvent } from 'react';
import { FilePlus2, KeyRound, Link2, Loader2 } from 'lucide-react';
import type { StoreConfig, VaultStatus } from '@ergonotes/core';
import type { Backend } from '../backend';
import { classNames } from '../state/util';
import { StoreForm, emptyStore, storeFromForm, type StoreFormState } from './StoreForm';

function strength(pw: string): number {
  let s = Math.min(pw.length / 20, 1) * 60;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s += 15;
  if (/\d/.test(pw)) s += 10;
  if (/[^A-Za-z0-9]/.test(pw)) s += 15;
  if (/\s/.test(pw)) s += 10;
  return Math.min(100, s);
}

export function Gate({ backend, status, onReady }: { backend: Backend; status: VaultStatus; onReady: () => void }) {
  const api = backend.api;
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [remember, setRemember] = useState(backend.mode === 'local');
  const [deviceName, setDeviceName] = useState(status.deviceName);
  const [setupToken, setSetupToken] = useState('');
  const [store, setStore] = useState<StoreFormState>(emptyStore());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noVault = status.state === 'no-vault';
  const remote = backend.mode === 'remote';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (noVault && mode === 'create' && pw !== pw2) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      if (!noVault) await api.unlock(pw, { remember });
      else if (mode === 'create') await api.createVault(pw, { ...(remote ? {} : { deviceName }), remember, ...(remote && setupToken ? { setupToken } : {}) } as Parameters<typeof api.createVault>[1]);
      else await api.joinVault(storeFromForm(store) as StoreConfig, pw, { ...(remote ? {} : { deviceName }), remember, ...(remote && setupToken ? { setupToken } : {}) } as Parameters<typeof api.joinVault>[2]);
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  };

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <img src="./icon.svg" width={48} height={48} alt="" style={{ borderRadius: 12 }} />
        {!noVault ? (
          <>
            <h1>{remote ? 'Sign in' : 'Unlock your notes'}</h1>
            <p>{remote ? 'Enter your vault password to open your notes on this server.' : 'Your notes are encrypted with your vault password.'}</p>
          </>
        ) : remote ? (
          <>
            <h1>Set up Ergonotes</h1>
            <p>This server has no vault yet. Choose a password; it encrypts everything that leaves this machine.</p>
          </>
        ) : (
          <>
            <h1>Welcome to Ergonotes</h1>
            <p>Offline-first notes that sync through storage you own.</p>
            <div className="seg" role="group" aria-label="Setup type" style={{ marginBottom: 16 }}>
              <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}><FilePlus2 size={14} style={{ verticalAlign: -2 }} /> New vault</button>
              <button type="button" aria-pressed={mode === 'join'} onClick={() => setMode('join')}><Link2 size={14} style={{ verticalAlign: -2 }} /> Join existing</button>
            </div>
          </>
        )}

        {noVault && mode === 'join' && !remote && <StoreForm value={store} onChange={setStore} />}
        {noVault && remote && (
          <div className="field">
            <label htmlFor="setup-token">Setup token <span className="hint">(only if this server asks for one)</span></label>
            <input id="setup-token" className="input" autoComplete="off" value={setupToken} onChange={e => setSetupToken(e.target.value)} />
          </div>
        )}
        {noVault && !remote && (
          <div className="field">
            <label htmlFor="devname">This device's name</label>
            <input id="devname" className="input" value={deviceName} onChange={e => setDeviceName(e.target.value)} />
          </div>
        )}

        <div className="field">
          <label htmlFor="pw">{noVault && mode === 'create' ? 'Vault password' : 'Password'}</label>
          <input id="pw" type="password" className="input" autoComplete={noVault && mode === 'create' ? 'new-password' : 'current-password'}
            value={pw} onChange={e => setPw(e.target.value)} autoFocus required />
          {noVault && mode === 'create' && (
            <>
              <div className={classNames('strength', strength(pw) > 60 && pw.length >= 12 && 'ok')}><i style={{ width: `${strength(pw)}%` }} /></div>
              <span className="hint">At least 12 characters; a passphrase of several words is ideal. If you forget it your notes cannot be recovered.</span>
            </>
          )}
        </div>
        {noVault && mode === 'create' && (
          <div className="field">
            <label htmlFor="pw2">Repeat password</label>
            <input id="pw2" type="password" className="input" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} required />
          </div>
        )}
        {!remote && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
            <span>Keep this device unlocked <span className="hint">(stores the key on this device)</span></span>
          </label>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy || pw.length === 0}>
          {busy ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />}
          {!noVault ? (remote ? 'Sign in' : 'Unlock') : mode === 'create' ? 'Create vault' : 'Join vault'}
        </button>
      </form>
    </div>
  );
}
