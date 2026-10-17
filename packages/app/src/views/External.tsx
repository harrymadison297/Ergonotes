import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, FolderInput, FileWarning } from 'lucide-react';
import { useApp, AppOverride } from '../state/app';
import { NoteEditor } from '../components/NoteEditor';
import { canOpenExternal, extRead, extReveal, extStat, type ExternalText } from '../backend/external';
import { EXTERNAL_PREFIX, baseName, externalApi, externalState, externalSummary, type ExternalState } from '../state/externalApi';
import { ApiKeeper } from '../state/apiKeeper';
import type { ItemSummary } from '@ergonotes/core';

/** A file outside the vault (CONTEXT.md, External file): the note editor on the file itself, saved straight back to it. */
export function ExternalView({ path }: { path?: string }) {
  const [state, setState] = useState<'loading' | { error: string } | { file: ExternalText }>('loading');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path || !canOpenExternal()) return;
    let live = true;
    setState('loading');
    extRead(path).then(file => { if (live) setState({ file }); }, e => { if (live) setState({ error: String(e?.message ?? e) }); });
    return () => { live = false; };
  }, [path, version]);

  if (!path) return <div className="empty" style={{ margin: 'auto' }}><h3>No file chosen</h3></div>;
  if (!canOpenExternal()) return <div className="empty" style={{ margin: 'auto' }}><h3>Open with works in the desktop app</h3><p>Install Ergonotes for Windows or Linux to open files from outside the vault.</p></div>;
  if (state === 'loading') return <div className="empty" style={{ margin: 'auto' }} role="status">Opening {baseName(path)}…</div>;
  if ('error' in state) {
    return (
      <div className="empty" style={{ margin: 'auto' }} role="alert">
        <FileWarning size={32} /><h3>{baseName(path)} could not be opened</h3><p>{state.error}</p>
        <button className="btn" onClick={() => setVersion(v => v + 1)}>Try again</button>
      </div>
    );
  }
  return <Loaded key={`${path}:${version}`} path={path} file={state.file} reload={() => setVersion(v => v + 1)} />;
}

function Loaded({ path, file, reload }: { path: string; file: ExternalText; reload: () => void }) {
  const app = useApp();
  const st = useMemo<ExternalState>(() => externalState(path, file), [path, file]);
  const api = useMemo(() => externalApi(st, app.api, file), [st, app.api, file]);
  const [changed, setChanged] = useState<'edited' | 'gone' | null>(null);
  const id = EXTERNAL_PREFIX + path;

  // the editor looks the file up by id, so it is the one entry of a map that has nothing else
  const byId = useMemo(() => {
    const m = new Map<string, ItemSummary>();
    m.get = (k: string) => (k === id ? externalSummary(st) : undefined);
    return m;
  }, [id, st]);
  const patch = useMemo(() => ({ api, byId }), [api, byId]);

  // another program changed the file (or removed it) while it is open
  useEffect(() => {
    const t = setInterval(() => {
      void extStat(path).then(s => {
        if (!s) setChanged('gone');
        else if (Math.abs(s.mtime - st.mtime) > 1) setChanged('edited');
      }, () => undefined);
    }, 2000);
    return () => clearInterval(t);
  }, [path, st]);

  const addToVault = async () => {
    const inbox = app.settings.captureFolder ?? app.items.find(i => i.role === 'inbox')?.id ?? null;
    const t = await extRead(path);
    const r = await app.run(app.api.importMarkdown([{ path: baseName(path), content: t.text }], inbox));
    if (r) { await app.refresh(); app.toast(`Added a copy of “${baseName(path)}” to your Inbox`); }
  };

  return (
    <AppOverride patch={patch}>
      <ApiKeeper api={api} />
      <div className="ext-view">
        <div className="banner info" role="note">
          <FolderOpen size={16} />
          <span className="grow">Outside your vault: saved straight to this file. Not synced, and no history is kept.</span>
          <button className="btn" onClick={() => void addToVault()}><FolderInput size={14} /> Add to vault</button>
          <button className="btn" onClick={() => void extReveal(path).catch(e => app.toast(String(e), 'error'))}><FolderOpen size={14} /> Show in folder</button>
        </div>
        {changed && (
          <div className="banner" role="alert">
            <FileWarning size={16} />
            <span className="grow">{changed === 'gone' ? 'This file was moved or deleted by another program.' : 'This file was changed by another program.'}</span>
            {changed === 'edited' && <button className="btn" onClick={reload}>Reload</button>}
            {changed === 'edited' && <button className="btn" onClick={() => { st.force = true; void extStat(path).then(s => { if (s) st.mtime = s.mtime; }); setChanged(null); }}>Keep mine</button>}
            {changed === 'gone' && <button className="btn" onClick={() => setChanged(null)}>Keep editing</button>}
          </div>
        )}
        <div className="ext-body"><NoteEditor id={id} outside={path} /></div>
      </div>
    </AppOverride>
  );
}
