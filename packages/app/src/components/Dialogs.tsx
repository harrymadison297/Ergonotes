import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, Copy, FileUp, History as HistoryIcon, Loader2, LogOut, RotateCcw, Save, Trash2 } from 'lucide-react';
import { applyHunks, joinDoc, lineDiff, splitDoc, type ConflictDetail, type HeadInfo, type StoreConfig, type VersionInfo } from '@ergonotes/core';
import { useApp } from '../state/app';
import { classNames, relTime } from '../state/util';
import { Dialog } from './ui';
import { StoreForm, formFromStore, storeFromForm, type StoreFormState } from './StoreForm';

// ---------------------------------------------------------------- conflicted revision
export function ConflictDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const app = useApp();
  const [detail, setDetail] = useState<ConflictDetail | null>(null);
  const [which, setWhich] = useState(0);
  const [take, setTake] = useState<Record<number, boolean>>({});
  const [manual, setManual] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => { void app.api.conflictDetail(id).then(d => { setDetail(d); if (!d) closeRef.current(); }); }, [id, app.api]);
  const other: HeadInfo | undefined = detail?.others[which];
  const local = detail?.local;
  const [props, setProps] = useState<Record<string, boolean>>({});
  const lDoc = useMemo(() => splitDoc(local?.text ?? ''), [local]);
  const oDoc = useMemo(() => splitDoc(other?.text ?? ''), [other]);
  const differing = useMemo(() => {
    const keys = new Set([...Object.keys(lDoc.fm), ...Object.keys(oDoc.fm)]);
    return [...keys].filter(k => k !== 'updated' && JSON.stringify(lDoc.fm[k]) !== JSON.stringify(oDoc.fm[k]));
  }, [lDoc, oDoc]);
  // the diff shows the note's text only; changed properties (title, tags, folder...) are chosen separately
  const ops = useMemo(() => (local && other ? lineDiff(lDoc.body.split('\n'), oDoc.body.split('\n')) : []), [local, other, lDoc, oDoc]);
  useEffect(() => { setTake({}); setManual(null); setProps({}); }, [which, detail]);
  if (!detail || !local) return <Dialog title="Conflicted revision" onClose={onClose}><div className="empty"><Loader2 className="spin" /></div></Dialog>;

  const resolve = async (c: Parameters<typeof app.api.resolveConflict>[1]) => {
    setBusy(true);
    await app.run(app.api.resolveConflict(id, c));
    await app.refresh();
    setBusy(false);
    onClose();
  };
  let hunk = -1;
  let inChange = false;
  const pickedBody = applyHunks(lDoc.body.split('\n'), oDoc.body.split('\n'), take).join('\n');
  const pickedFm = { ...lDoc.fm };
  for (const k of differing) if (props[k]) { if (k in oDoc.fm) pickedFm[k] = oDoc.fm[k]; else delete pickedFm[k]; }
  const picked = Object.keys(pickedFm).length ? joinDoc(pickedFm, pickedBody) : pickedBody;
  const when = (h: HeadInfo) => `${h.deviceName} · ${relTime(h.ts)}`;

  return (
    <Dialog title={`Conflicted revision: ${detail.title}`} wide onClose={onClose}
      footer={<>
        <button className="btn" disabled={busy} onClick={() => void resolve({ kind: 'local' })}>Keep this device’s version</button>
        {other && <button className="btn" disabled={busy} onClick={() => void resolve({ kind: 'other', commit: other.commit })}>Keep {other.deviceName}’s version</button>}
        <button className="btn" disabled={busy} onClick={() => void resolve({ kind: 'both' })}>Keep both as separate notes</button>
        <button className="btn" disabled={busy} onClick={() => void resolve({ kind: 'combine' })}>Combine both texts</button>
        <button className="btn primary" disabled={busy} onClick={() => void resolve({ kind: 'text', text: manual ?? picked })}><Check size={16} /> Save {manual !== null ? 'edited text' : 'selection'}</button>
      </>}>
      <p style={{ marginTop: 0, color: 'var(--text-2)' }}>
        The same note was changed on more than one device. Nothing is lost: pick a whole version, choose change by change, or edit the result by hand.
        {detail.others.length > 1 && ` There are ${detail.others.length + 1} versions in all: saving here replaces all of them, so compare each one first.`}
      </p>
      {detail.others.length > 1 && (
        <div className="seg" role="group" aria-label="Compare with" style={{ marginBottom: 12 }}>
          {detail.others.map((o, i) => <button key={o.commit} aria-pressed={which === i} onClick={() => setWhich(i)}>{o.deviceName}</button>)}
        </div>
      )}
      <div className="compare-cols" style={{ marginBottom: 12 }}>
        <div><b>This device</b><div className="hint" style={{ color: 'var(--text-3)' }}>{when(local)}</div></div>
        {other && <div><b>{other.deviceName}</b><div className="hint" style={{ color: 'var(--text-3)' }}>{other.purge ? 'Deleted this note' : when(other)}</div></div>}
      </div>
      {other?.purge ? (
        <div className="banner" style={{ borderRadius: 6 }}>The other device deleted this note. Keep your version to cancel the deletion, or delete it everywhere.
          <span className="grow" /><button className="btn danger" onClick={() => void resolve({ kind: 'delete' })}>Delete everywhere</button></div>
      ) : (
        <>
          {differing.length > 0 && (
            <fieldset style={{ border: '1px solid var(--border)', borderRadius: 6, marginBottom: 12 }}>
              <legend style={{ padding: '0 6px', fontWeight: 600 }}>Note properties that differ</legend>
              {differing.map(k => (
                <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                  <input type="checkbox" checked={!!props[k]} onChange={e => setProps({ ...props, [k]: e.target.checked })} />
                  <span><b>{k}</b>: {JSON.stringify(lDoc.fm[k] ?? null)} → <b>{JSON.stringify(oDoc.fm[k] ?? null)}</b> <span style={{ color: 'var(--text-3)' }}>(use {other?.deviceName}’s)</span></span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="diff" role="region" aria-label="Differences">
            {ops.map((op, i) => {
              if (op.type === 'same') { inChange = false; return op.lines.length > 6
                ? <div key={i}>{[...op.lines.slice(0, 2), '…', ...op.lines.slice(-2)].map((l, j) => <div key={j} className="diff-line"><span className="mark" /><span style={{ color: 'var(--text-3)' }}>{l}</span></div>)}</div>
                : <div key={i}>{op.lines.map((l, j) => <div key={j} className="diff-line"><span className="mark" /><span style={{ color: 'var(--text-3)' }}>{l}</span></div>)}</div>; }
              const first = !inChange;
              if (first) { hunk++; inChange = true; }
              const h = hunk;
              return (
                <div key={i} className="hunk">
                  {first && (
                    <div className="hunk-bar">
                      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input type="checkbox" checked={!!take[h]} onChange={e => setTake({ ...take, [h]: e.target.checked })} />
                        Use {other?.deviceName}’s change
                      </label>
                    </div>
                  )}
                  {op.lines.map((l, j) => (
                    <div key={j} className={classNames('diff-line', op.type)}><span className="mark">{op.type === 'add' ? '+' : '−'}</span><span>{l || ' '}</span></div>
                  ))}
                </div>
              );
            })}
            {ops.every(o => o.type === 'same') && <div className="empty">The text is identical{differing.length ? '; only note properties differ' : ''}.</div>}
          </div>
          <details style={{ marginTop: 12 }} onToggle={e => { if ((e.target as HTMLDetailsElement).open && manual === null) setManual(picked); }}>
            <summary style={{ cursor: 'pointer' }}>Edit the result by hand</summary>
            <textarea className="input" style={{ marginTop: 8, minHeight: 200, fontFamily: 'ui-monospace, monospace' }} aria-label="Result text"
              value={manual ?? picked} onChange={e => setManual(e.target.value)} />
          </details>
        </>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- version history
export function HistoryDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const app = useApp();
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { void app.api.history(id).then(v => { setVersions(v); setSel(v[0]?.commit ?? null); }); }, [id, app.api]);
  useEffect(() => { if (sel) void app.api.versionText(id, sel).then(setText); }, [sel, id, app.api]);
  return (
    <Dialog title="Version history" wide onClose={onClose} footer={
      <button className="btn primary" disabled={!sel || versions?.find(v => v.commit === sel)?.current} onClick={async () => {
        if (!sel) return;
        await app.run(app.api.restoreVersion(id, sel)); await app.refresh(); app.toast('Version restored'); onClose();
      }}><RotateCcw size={16} /> Restore this version</button>}>
      {!versions ? <div className="empty"><Loader2 className="spin" /></div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 260px) 1fr', gap: 16 }}>
          <div role="listbox" aria-label="Versions" style={{ maxHeight: '55vh', overflow: 'auto' }}>
            {versions.map(v => (
              <button key={v.commit} role="option" aria-selected={sel === v.commit} className="menu-item" style={{ background: sel === v.commit ? 'var(--bg-active)' : undefined }} onClick={() => setSel(v.commit)}>
                <HistoryIcon size={15} />
                <span className="grow"><span style={{ display: 'block' }}>{new Date(v.ts).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{v.deviceName}{v.current ? ' · current' : ''}</span></span>
              </button>
            ))}
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', maxHeight: '55vh', overflow: 'auto', background: 'var(--bg-soft)', padding: 12, borderRadius: 6 }}>{text ?? 'No text for this version.'}</pre>
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- move
export function MoveDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const app = useApp();
  const item = app.byId.get(id);
  const [q, setQ] = useState('');
  const folders = useMemo(() => {
    const byParent = new Map<string | null, typeof app.items>();
    for (const f of app.items.filter(i => i.type === 'folder' && !i.inTrash)) (byParent.get(f.parent) ?? byParent.set(f.parent, []).get(f.parent)!).push(f);
    const out: { f: (typeof app.items)[number]; depth: number }[] = [];
    const walk = (p: string | null, depth: number) => {
      for (const f of (byParent.get(p) ?? []).sort((a, b) => a.title.localeCompare(b.title))) {
        if (f.id === id) continue;
        out.push({ f, depth });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [app.items, id]);
  const go = async (parent: string | null) => { await app.run(app.api.move(id, parent)); await app.refresh(); onClose(); };
  return (
    <Dialog title={`Move “${item?.title ?? ''}”`} onClose={onClose}>
      <input className="input" placeholder="Find a folder" aria-label="Find a folder" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
        {item?.type === 'folder' && <button className="menu-item" onClick={() => void go(null)}>Top level</button>}
        {folders.filter(x => !q || x.f.title.toLowerCase().includes(q.toLowerCase())).map(({ f, depth }) => (
          <button key={f.id} className="menu-item" style={{ paddingLeft: 10 + (q ? 0 : depth * 18) }} onClick={() => void go(f.id)}>{f.title}{item?.parent === f.id && <Check size={14} />}</button>
        ))}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- templates
export function TemplatesDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [list, setList] = useState<typeof app.items | null>(null);
  useEffect(() => { void app.api.templates().then(setList); }, [app.api]);
  return (
    <Dialog title="New note from template" onClose={onClose}>
      {!list ? <div className="empty"><Loader2 className="spin" /></div> : list.length === 0 ? (
        <div className="empty"><h3>No templates yet</h3><p>Open a note and choose “Use as template” from its menu.</p></div>
      ) : list.map(t => (
        <button key={t.id} className="menu-item" style={{ minHeight: 52, alignItems: 'flex-start', paddingTop: 8, flexDirection: 'column', gap: 0 }}
          onClick={async () => {
            const n = await app.run(app.api.createFromTemplate(t.id));
            if (n) { await app.refresh(); onClose(); app.go({ name: 'notes', note: n.id, folder: n.parent ?? undefined }); }
          }}>
          <b>{t.title}</b><span style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{t.snippet.slice(0, 90)}</span>
        </button>
      ))}
    </Dialog>
  );
}

// ---------------------------------------------------------------- new folder / rename
export function NameDialog({ title, initial, cta, onSubmit, onClose }: { title: string; initial?: string; cta: string; onSubmit: (v: string) => Promise<void>; onClose: () => void }) {
  const [v, setV] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!v.trim() || busy} form="name-form">{cta}</button></>}>
      <form id="name-form" onSubmit={async e => { e.preventDefault(); setBusy(true); await onSubmit(v.trim()); setBusy(false); onClose(); }}>
        <div className="field"><label htmlFor="nm">Name</label><input id="nm" className="input" value={v} onChange={e => setV(e.target.value)} autoFocus /></div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- import markdown
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const dir = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const run = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    const items = await Promise.all(Array.from(list).filter(f => /\.(md|markdown|txt)$/i.test(f.name)).map(async f => ({
      path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, content: await f.text(),
    })));
    const r = await app.run(app.api.importMarkdown(items));
    setBusy(false);
    if (r) { setResult(`Imported ${r.notes} note${r.notes === 1 ? '' : 's'} into ${r.folders} new folder${r.folders === 1 ? '' : 's'}.`); await app.refresh(); }
  };
  return (
    <Dialog title="Import Markdown" onClose={onClose}>
      <p style={{ marginTop: 0, color: 'var(--text-2)' }}>Import a folder of Markdown files (Obsidian, Logseq, Notion export). Folders are kept, <code>[[wiki links]]</code> are connected, and front-matter tags are used.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" disabled={busy} onClick={() => dir.current?.click()}><FileUp size={16} /> Choose a folder…</button>
        <button className="btn" disabled={busy} onClick={() => files.current?.click()}>Choose files…</button>
      </div>
      <input ref={dir} type="file" hidden multiple {...({ webkitdirectory: '' } as object)} onChange={e => void run(e.target.files)} />
      <input ref={files} type="file" hidden multiple accept=".md,.markdown,.txt" onChange={e => void run(e.target.files)} />
      {busy && <p><Loader2 size={16} className="spin" /> Importing…</p>}
      {result && <p role="status" style={{ color: 'var(--green-btn)' }}><Check size={16} style={{ verticalAlign: -3 }} /> {result}</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- shortcuts
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['New note', 'Ctrl + N'], ['Search', 'Ctrl + K'], ['Today’s daily note', 'Ctrl + Alt + D'], ['Sync now', 'Ctrl + Shift + S'],
    ['Home', 'g then h'], ['Notes', 'g then n'], ['Tasks', 'g then t'], ['This help', '?'],
    ['Bold / Italic', 'Ctrl + B / I'], ['Insert a block', '/'], ['Link to a note', '[['],
  ];
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <table className="table"><tbody>{rows.map(([a, b]) => <tr key={a}><td className="name">{a}</td><td style={{ textAlign: 'right' }}><kbd>{b}</kbd></td></tr>)}</tbody></table>
    </Dialog>
  );
}

// ---------------------------------------------------------------- settings
export function SettingsDialog({ tab: initialTab, onClose }: { tab?: string; onClose: () => void }) {
  const app = useApp();
  const [tab, setTab] = useState(initialTab ?? 'general');
  const [name, setName] = useState(app.status.deviceName);
  const [store, setStore] = useState<StoreFormState>(() => formFromStore(null));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const folders = app.items.filter(i => i.type === 'folder' && !i.inTrash);
  const remote = app.mode === 'remote';

  useEffect(() => { setName(app.status.deviceName); }, [app.status.deviceName]);

  const saveStore = async () => {
    setBusy(true); setMsg(null);
    try {
      await app.api.setStore(storeFromForm(store) as StoreConfig);
      await app.refresh();
      setMsg('Connected. Your notes are syncing.');
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <Dialog title="Settings" wide onClose={onClose}>
      <div className="tabs" role="tablist" style={{ margin: '0 -8px 14px' }}>
        {[['general', 'General'], ['sync', 'Sync & storage'], ...(remote ? [['agents', 'AI & agents']] : []), ['security', 'Security'], ['data', 'Data']].map(([k, l]) =>
          <button key={k} className="tab" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'general' && (
        <div style={{ maxWidth: 520 }}>
          <div className="field"><label htmlFor="s-name">This device’s name</label>
            <div style={{ display: 'flex', gap: 8 }}><input id="s-name" className="input" value={name} onChange={e => setName(e.target.value)} />
              <button className="btn" onClick={async () => { await app.run(app.api.setDeviceName(name)); await app.refresh(); app.toast('Saved'); }}>Save</button></div>
            <span className="hint">Shown on conflicted revisions so you can tell which device wrote what.</span></div>
          <div className="field"><label htmlFor="s-theme">Appearance</label>
            <select id="s-theme" className="input" value={app.settings.theme} onChange={async e => { await app.run(app.api.setSettings({ theme: e.target.value as 'system' | 'light' | 'dark' })); await app.refresh(); }}>
              <option value="system">Match my system</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
          <div className="field"><label htmlFor="s-cap">New captures go to</label>
            <select id="s-cap" className="input" value={app.settings.captureFolder ?? ''} onChange={async e => { await app.run(app.api.setSettings({ captureFolder: e.target.value || null })); await app.refresh(); }}>
              <option value="">Inbox (created when needed)</option>
              {folders.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}</select>
            <span className="hint">Share-to-app, quick notes and the Scratch Pad all land here.</span></div>
          <div className="field"><label htmlFor="s-daily">Daily notes folder</label>
            <select id="s-daily" className="input" value={app.settings.dailyFolder ?? ''} onChange={async e => { await app.run(app.api.setSettings({ dailyFolder: e.target.value || null })); await app.refresh(); }}>
              <option value="">Areas / Daily</option>
              {folders.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}</select></div>
        </div>
      )}
      {tab === 'sync' && (
        <div style={{ maxWidth: 560 }}>
          {app.status.store && (
            <p style={{ marginTop: 0 }}>Syncing with <b>{app.status.store.label}</b> ({app.status.store.type}).{' '}
              {app.status.lastSyncError ? <span className="error-text">{app.status.lastSyncError}</span> : app.status.lastSyncAt ? `Last synced ${relTime(app.status.lastSyncAt)}.` : ''}</p>
          )}
          <p style={{ color: 'var(--text-2)', marginTop: app.status.store ? 0 : undefined }}>Notes sync through storage you own. Everything is encrypted on this device before it is uploaded, so the storage provider only ever sees ciphertext.</p>
          <StoreForm value={store} onChange={setStore} allowFolder={remote} />
          {msg && <p role="status" className={msg.startsWith('Connected') ? undefined : 'error-text'}>{msg}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" disabled={busy} onClick={() => void saveStore()}>{busy ? <Loader2 size={16} className="spin" /> : <Save size={16} />} {app.status.store ? 'Replace storage' : 'Connect storage'}</button>
            {app.status.store && <button className="btn" onClick={async () => { const r = await app.run(app.api.sync({ full: true })); await app.refresh(); app.toast(r?.error ?? 'Full sync finished', r?.error ? 'error' : 'info'); }}>Sync now (full check)</button>}
            {app.status.store && <button className="btn danger" onClick={async () => { await app.run(app.api.setStore(null)); await app.refresh(); }}>Disconnect</button>}
          </div>
        </div>
      )}
      {tab === 'agents' && remote && <AgentsPanel />}
      {tab === 'security' && (
        <div style={{ maxWidth: 480 }}>
          <h3 style={{ marginTop: 0 }}>Change vault password</h3>
          <div className="field"><label htmlFor="pw-old">Current password</label><input id="pw-old" type="password" className="input" autoComplete="current-password" value={oldPw} onChange={e => setOldPw(e.target.value)} /></div>
          <div className="field"><label htmlFor="pw-new">New password</label><input id="pw-new" type="password" className="input" autoComplete="new-password" value={newPw} onChange={e => setNewPw(e.target.value)} />
            <span className="hint">At least 12 characters. Only the key wrapper changes; your notes are not re-encrypted. Other devices keep working with the old password until they unlock again.</span></div>
          {msg && <p role="status" className={msg === 'Password changed' ? undefined : 'error-text'}>{msg}</p>}
          <button className="btn primary" disabled={!oldPw || !newPw} onClick={async () => {
            try { await app.api.changePassword(oldPw, newPw); setMsg('Password changed'); setOldPw(''); setNewPw(''); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
          }}>Change password</button>
          <hr style={{ margin: '24px 0', border: 0, borderTop: '1px solid var(--border)' }} />
          <button className="btn" onClick={async () => { await app.run(app.api.lock()); location.reload(); }}><LogOut size={16} /> Lock now</button>
          <p className="hint" style={{ color: 'var(--text-3)' }}>Forgetting the password means your notes cannot be recovered; there is no reset.</p>
        </div>
      )}
      {tab === 'data' && (
        <div style={{ maxWidth: 520 }}>
          <button className="btn" onClick={() => { onClose(); app.setDialog({ kind: 'import' }); }}><FileUp size={16} /> Import Markdown files…</button>
          <p className="hint" style={{ color: 'var(--text-3)' }}>Export any note from its Export menu (Markdown, HTML, PDF).</p>
          <button className="btn" onClick={async () => { await app.run(app.api.emptyTrash()); await app.refresh(); app.toast('Trash emptied'); }}>Empty Trash now</button>
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- AI & agents (MCP tokens, server mode)
function AgentsPanel() {
  const app = useApp();
  const [tokens, setTokens] = useState<{ id: string; name: string; created: string; lastUsed: string | null }[]>([]);
  const [name, setName] = useState('Claude');
  const [fresh, setFresh] = useState<string | null>(null);
  const endpoint = new URL('./mcp', location.href).toString();
  const load = async () => { const r = await fetch('./api/tokens', { credentials: 'same-origin' }); if (r.ok) setTokens(await r.json()); };
  useEffect(() => { void load(); }, []);
  const post = async (body: unknown) => (await fetch('./api/tokens', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const snippet = JSON.stringify({ mcpServers: { ergonotes: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${fresh ?? '<token>'}` } } } }, null, 2);
  return (
    <div style={{ maxWidth: 620 }}>
      <p style={{ marginTop: 0, color: 'var(--text-2)' }}>
        Let an AI assistant search, read and write your notes through the Model Context Protocol. Anything you give a token access to can read every note on this server, so create one per agent and revoke it when you stop using it.
      </p>
      <div className="field"><label>MCP endpoint</label><input className="input" readOnly value={endpoint} onFocus={e => e.currentTarget.select()} /></div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input className="input" aria-label="Token name" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn primary" onClick={async () => { const r = await post({ name }); setFresh(r.token); await load(); }}><Bot size={16} /> Create token</button>
      </div>
      {fresh && (
        <div className="banner info" style={{ borderRadius: 6, display: 'block', marginBottom: 14 }} role="status">
          <b>Copy this token now; it is shown only once.</b>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '6px 0' }}>{fresh}</pre>
          <details><summary>Client configuration</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{snippet}</pre></details>
          <button className="btn" onClick={async () => { await navigator.clipboard?.writeText(fresh); app.toast('Token copied'); }}><Copy size={14} /> Copy</button>
        </div>
      )}
      <table className="table"><thead><tr><th>Name</th><th>Created</th><th>Last used</th><th /></tr></thead><tbody>
        {tokens.map(t => (
          <tr key={t.id}><td className="name">{t.name}</td><td>{new Date(t.created).toLocaleDateString()}</td><td>{t.lastUsed ? relTime(t.lastUsed) : 'never'}</td>
            <td style={{ textAlign: 'right' }}><button className="icon-btn" aria-label={`Revoke ${t.name}`} onClick={async () => { await post({ revoke: t.id }); await load(); }}><Trash2 size={16} /></button></td></tr>
        ))}
        {tokens.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--text-3)' }}>No tokens yet.</td></tr>}
      </tbody></table>
    </div>
  );
}
