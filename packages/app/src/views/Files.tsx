import { useEffect, useMemo, useState } from 'react';
import { AudioLines, Copy, Download, ExternalLink, File as FileIcon, FileSpreadsheet, FileText, Image as ImageIcon, Music, Presentation, Search, Trash2, Video } from 'lucide-react';
import { fmtClock, markdownLink, recordFilePaths, type FileInfo, type RecordInfo } from '@ergonotes/core';
import { useApp } from '../state/app';
import { href } from '../state/router';
import { classNames } from '../state/util';
import { FileImg } from '../components/FileImg';
import { FilePreviewBody, useFilePreview } from '../components/FilePreview';
import { Resizer } from '../components/Resizer';
import { PaneList } from '../components/RecorderPanel';
import { useMenu, type MenuEntry } from '../components/ui';
import { canRevealInFolder, revealInFolder } from '../backend/tauriFs';
import { askConfirm } from '../state/confirm';

type Tab = 'all' | 'media' | 'docs' | 'records';
const isMedia = (f: FileInfo) => /^(image|video|audio)\//.test(f.mime);

export function fileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function kindIcon(f: FileInfo, size = 40) {
  const n = f.name.toLowerCase();
  if (f.mime.startsWith('image/')) return <ImageIcon size={size} strokeWidth={1.25} />;
  if (f.mime.startsWith('video/')) return <Video size={size} strokeWidth={1.25} />;
  if (f.mime.startsWith('audio/')) return <Music size={size} strokeWidth={1.25} />;
  if (/\.(csv|tsv|xlsx)$/.test(n)) return <FileSpreadsheet size={size} strokeWidth={1.25} />;
  if (n.endsWith('.pptx')) return <Presentation size={size} strokeWidth={1.25} />;
  if (/\.(pdf|txt|md|docx?)$/.test(n)) return <FileText size={size} strokeWidth={1.25} />;
  return <FileIcon size={size} strokeWidth={1.25} />;
}

function FilePane({ file }: { file: FileInfo }) {
  const app = useApp();
  const { file: blob, pv, err, save } = useFilePreview(file.id);
  return (
    <div className="editor">
      <div className="editor-top">
        <nav className="crumbs" aria-label="File">
          <span>{file.noteTitle ?? 'Not in a note'}</span><span aria-hidden>›</span><span>{file.name}</span>
        </nav>
        {file.noteId && <button className="btn primary" onClick={() => app.go({ name: 'notes', note: file.noteId! })}>Go to note</button>}
        <button className="icon-btn" title="Download" aria-label="Download" disabled={!blob} onClick={save}><Download size={18} /></button>
      </div>
      <div className="editor-scroll" style={{ padding: 16 }}>
        <FilePreviewBody file={blob} pv={pv} err={err} />
      </div>
    </div>
  );
}

export function FilesView({ fileId }: { fileId?: string }) {
  const app = useApp();
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [records, setRecords] = useState<RecordInfo[]>([]);
  const [reload, setReload] = useState(0);
  const menu = useMenu();
  useEffect(() => {
    let live = true;
    void app.api.listFiles().then(f => { if (live) setFiles(f); });
    void app.api.listRecords().then(r => { if (live) setRecords(r); });
    return () => { live = false; };
  }, [app.api, app.items, reload]);
  const removeRecord = async (r: RecordInfo) => {
    if (!(await askConfirm(`Delete this record for good? Its audio, ${r.frames.length} frame${r.frames.length === 1 ? '' : 's'} and transcript are removed${r.noteTitle ? `, and the player in “${r.noteTitle}” will say it is missing` : ''}.`, { ok: 'Delete', danger: true }))) return;
    await app.run(app.api.removeFiles(recordFilePaths(r)));
    setReload(n => n + 1);
  };

  const reveal = async (path: string) => {
    try { await revealInFolder(path); } catch (e) { app.toast(e instanceof Error ? e.message : String(e), 'error'); }
  };
  const copyText = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); app.toast(`${what} copied`); } catch { app.toast(`Could not copy the ${what.toLowerCase()}`, 'error'); }
  };
  const fileEntries = (f: FileInfo): MenuEntry[] => [
    { label: 'Open', icon: <FileIcon size={16} />, onClick: () => app.go({ name: 'files', file: f.id }) },
    ...(f.noteId ? [{ label: 'Open the note', onClick: () => app.go({ name: 'notes', note: f.noteId! }) }] : []),
    { sep: true },
    { label: 'Copy link', icon: <Copy size={16} />, onClick: () => void copyText(markdownLink(f.name, f.path, f.mime.startsWith('image/')), 'Link') },
    ...(canRevealInFolder() ? [{ label: 'Show in folder', icon: <ExternalLink size={16} />, onClick: () => void reveal(f.path) }] : []),
    { sep: true },
    { label: 'Delete…', icon: <Trash2 size={16} />, danger: true, onClick: async () => {
      if (!(await askConfirm(`Delete “${f.name}” for good?${f.noteId ? ` The note “${f.noteTitle}” uses it and will show it as missing.` : ''}`, { ok: 'Delete', danger: true }))) return;
      await app.run(app.api.removeFiles([f.path]));
      setReload(n => n + 1);
    } },
  ];
  const recordEntries = (r: RecordInfo): MenuEntry[] => [
    ...(r.noteId ? [{ label: 'Open the note', icon: <FileIcon size={16} />, onClick: () => app.go({ name: 'notes', note: r.noteId! }) }, { sep: true } as MenuEntry] : []),
    ...(canRevealInFolder() ? [{ label: 'Show in folder', icon: <ExternalLink size={16} />, onClick: () => void reveal(r.path) }] : []),
    { label: 'Delete…', icon: <Trash2 size={16} />, danger: true, onClick: () => void removeRecord(r) },
  ];

  const shown = useMemo(() => tab === 'records' ? [] : (files ?? []).filter(f =>
    (tab === 'all' || (tab === 'media') === isMedia(f)) && (!q || f.name.toLowerCase().includes(q.toLowerCase()))), [files, tab, q]);
  const total = (files ?? []).reduce((a, f) => a + f.size, 0);
  const current = (files ?? []).find(f => f.id === fileId);

  const list = (
    <PaneList>
      {menu.node}
      <Resizer pane="listW" edge="right" label="Resize list" />
      <div className="list-head files-head">
        <h2><span className="ttl">Files</span><span className="count">{tab === 'records' ? records.length : files?.length ?? 0}</span><span className="grow" /><span className="total">Total size: {fileSize(tab === 'records' ? records.reduce((a, r) => a + r.size, 0) : total)}</span></h2>
        <div className="pills" role="tablist" aria-label="File kinds">
          {([['all', 'Files'], ['media', 'Media'], ['docs', 'Docs'], ['records', 'Records']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <label className="file-search">
          <input aria-label="Search files" placeholder="Search file…" value={q} onChange={e => setQ(e.target.value)} />
          <Search size={16} aria-hidden />
        </label>
      </div>
      {tab === 'records' && (
        <div className="list-scroll">
          {records.length === 0 && <div className="empty"><AudioLines size={32} /><h3>No records</h3><p>Recordings and meetings you make in a note are listed here.</p></div>}
          {records.map(r => (
            <div key={r.path} className="record-row" onContextMenu={e => { e.preventDefault(); menu.open({ currentTarget: e.currentTarget }, recordEntries(r)); }}>
              <AudioLines size={20} aria-hidden />
              <div className="record-row-main">
                <strong>{r.meta?.kind === 'meeting' ? 'Meeting' : 'Recording'} {r.meta?.startedAt ? new Date(r.meta.startedAt).toLocaleString() : r.path.slice(r.path.lastIndexOf('/') + 1)}</strong>
                <span className="file-sub">{fmtClock(r.meta?.seconds ?? 0)} · {r.frames.length} frame{r.frames.length === 1 ? '' : 's'}{r.transcript ? ' · transcript' : ''} · {fileSize(r.size)}</span>
                <span className="file-sub">{r.noteTitle ? <a href={href({ name: 'notes', note: r.noteId! })}>{r.noteTitle}</a> : 'Not in a note'}</span>
              </div>
              <button className="btn" onClick={() => void removeRecord(r)}>Delete</button>
            </div>
          ))}
        </div>
      )}
      <div className="list-scroll file-grid" hidden={tab === 'records'}>
        {files && shown.length === 0 && <div className="empty"><FileIcon size={32} /><h3>No files</h3><p>Attach files from a note’s Insert menu and they show up here.</p></div>}
        {shown.map(f => (
          <a key={f.id} className={classNames('file-card', f.id === fileId && 'active')} href={href({ name: 'files', file: f.id })}
            onContextMenu={e => { e.preventDefault(); menu.open({ currentTarget: e.currentTarget }, fileEntries(f)); }}>
            <span className="file-thumb">{f.mime.startsWith('image/') ? <FileImg src={`ergo-file:${f.id}`} alt="" /> : kindIcon(f)}</span>
            <span className="file-name">{f.name}</span>
            <span className="file-sub">{f.noteTitle ?? 'Not in a note'}</span>
            <span className="file-sub">{fileSize(f.size)}</span>
          </a>
        ))}
      </div>
    </PaneList>
  );

  if (app.isMobile) {
    return (
      <div className="m-content">
        {list}
        {current && <div className="m-note"><button className="btn ghost" style={{ alignSelf: 'flex-start', margin: 8 }} onClick={() => app.go({ name: 'files' })}>Back</button><FilePane file={current} /></div>}
      </div>
    );
  }
  return (
    <div className="split">
      {list}
      <div className="pane-body">
        {current ? <FilePane file={current} /> : <div className="empty" style={{ margin: 'auto' }}><FileIcon size={40} strokeWidth={1.25} /><h3>Select a file</h3><p>Its preview opens here.</p></div>}
      </div>
    </div>
  );
}
