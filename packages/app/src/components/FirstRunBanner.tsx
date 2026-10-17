import { useState } from 'react';
import { FolderOpen, KeyRound, X } from 'lucide-react';
import { useApp } from '../state/app';

const KEY = 'ergo.welcomed';
const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

/** Home, first run (ADR 0012): where the notes are, how to move them, and the password that was not asked for. Shown once. */
export function FirstRunBanner() {
  const app = useApp();
  const [gone, setGone] = useState(seen);
  if (gone || !app.folder || app.status.hasPassword || !app.status.passwordOptional) return null;
  const phone = typeof window !== 'undefined' && !!(window as unknown as { ErgoVault?: unknown }).ErgoVault;
  const dismiss = () => { try { localStorage.setItem(KEY, '1'); } catch { /* shown again next time */ } setGone(true); };
  return (
    <aside className="first-run" aria-label="Your notes folder">
      <div className="first-run-text">
        <b>Your notes are the Markdown files in <code title={app.folder.path}>{app.folder.path}</code>.</b>
        <span>{phone ? ' This folder belongs to the app and is removed if you uninstall it: choose another folder, or turn on Sync, to keep your notes safe.' : ' Open it in any other editor, or choose another folder. No password is needed on this device.'}</span>
      </div>
      <div className="first-run-actions">
        {app.folder.canPick && <button className="btn" onClick={() => void app.folder!.change()}><FolderOpen size={16} /> Change folder</button>}
        <button className="btn" onClick={() => app.setDialog({ kind: 'settings', tab: 'security' })}><KeyRound size={16} /> Set password</button>
        <button className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={dismiss}><X size={18} /></button>
      </div>
    </aside>
  );
}
