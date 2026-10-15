import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { fromB64, type FileBlob } from '@ergonotes/core';
import { downloadBlob } from '../state/util';
import { useApp } from '../state/app';
import { Dialog } from './ui';


/** RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const head = text.split('\n', 1)[0] ?? '';
  const count = (c: string) => head.split(c).length - 1;
  const delim = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export type Preview =
  | { kind: 'table'; sheets: { name: string; rows: string[][] }[] }
  | { kind: 'slides'; slides: string[][] }
  | { kind: 'image' | 'pdf'; url: string }
  | { kind: 'text'; text: string }
  | { kind: 'none' };

export async function buildPreview(f: FileBlob): Promise<Preview> {
  const name = f.name.toLowerCase();
  const bytes = fromB64(f.data);
  if (f.mime.startsWith('image/')) return { kind: 'image', url: `data:${f.mime};base64,${f.data}` };
  if (f.mime === 'application/pdf' || name.endsWith('.pdf')) return { kind: 'pdf', url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })) };
  if (name.endsWith('.csv') || name.endsWith('.tsv') || f.mime === 'text/csv') return { kind: 'table', sheets: [{ name: f.name, rows: parseCsv(new TextDecoder().decode(bytes)) }] };
  if (name.endsWith('.xlsx')) {
    const { default: readXlsxFile, readSheetNames } = await import('read-excel-file');
    const blob = new Blob([bytes as BlobPart]);
    const names: string[] = await readSheetNames(blob);
    const sheets = [];
    for (const n of names.slice(0, 8)) {
      const rows = await readXlsxFile(blob, { sheet: n });
      sheets.push({ name: n, rows: rows.map(r => r.map(c => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c)))) });
    }
    return { kind: 'table', sheets };
  }
  if (name.endsWith('.pptx')) {
    const { unzipSync, strFromU8 } = await import('fflate');
    const files = unzipSync(bytes);
    const slideNames = Object.keys(files).filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    const slides = slideNames.map(k => {
      const xml = strFromU8(files[k]);
      return [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")).filter(Boolean);
    });
    return { kind: 'slides', slides };
  }
  if (f.mime.startsWith('text/') || /\.(txt|md|json|log)$/.test(name)) return { kind: 'text', text: new TextDecoder().decode(bytes) };
  return { kind: 'none' };
}

const MAX_FILE_TEXT = 60_000;

/** The text of an attachment for the assistant: spreadsheets as rows, slides as text; null for images, PDFs and the rest. */
export async function fileToText(f: FileBlob): Promise<string | null> {
  const pv = await buildPreview(f);
  let text: string | null = null;
  if (pv.kind === 'text') text = pv.text;
  else if (pv.kind === 'table') text = pv.sheets.map(s => `## ${s.name}\n${s.rows.map(r => r.join(' | ')).join('\n')}`).join('\n\n');
  else if (pv.kind === 'slides') text = pv.slides.map((l, i) => `Slide ${i + 1}: ${l.join(' / ')}`).join('\n');
  if (text === null) return null;
  return text.length > MAX_FILE_TEXT ? text.slice(0, MAX_FILE_TEXT) + '\n…(cut)' : text;
}

/** Loads one attachment and builds its preview. */
export function useFilePreview(id: string) {
  const app = useApp();
  const [file, setFile] = useState<FileBlob | null | undefined>(undefined);
  const [pv, setPv] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setFile(undefined); setPv(null); setErr(null);
    void app.api.getFile(id).then(async f => {
      if (!live) return;
      setFile(f);
      if (f) try { setPv(await buildPreview(f)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setPv({ kind: 'none' }); }
    });
    return () => { live = false; };
  }, [id, app.api]);
  const save = () => {
    if (!file) return;
    downloadBlob(file.name, new Blob([fromB64(file.data) as BlobPart], { type: file.mime }));
  };
  return { file, pv, err, save };
}

/** The preview itself, without a frame: used by the dialog and by the Files page. */
export function FilePreviewBody({ file, pv, err }: { file: FileBlob | null | undefined; pv: Preview | null; err: string | null }) {
  const [sheet, setSheet] = useState(0);
  return (
    <>
      {file === undefined && <div className="empty"><Loader2 className="spin" /></div>}
      {file === null && <div className="empty"><h3>This file is not on this device yet</h3><p>Sync, then try again.</p></div>}
      {file && !pv && <div className="empty"><Loader2 className="spin" /></div>}
      {pv?.kind === 'image' && <img src={pv.url} alt={file?.name} style={{ maxWidth: '100%' }} />}
      {pv?.kind === 'pdf' && <iframe title={file?.name} src={pv.url} style={{ width: '100%', height: '64vh', border: 0 }} />}
      {pv?.kind === 'text' && <pre style={{ whiteSpace: 'pre-wrap' }}>{pv.text}</pre>}
      {pv?.kind === 'table' && (
        <>
          {pv.sheets.length > 1 && <div className="seg" role="group" aria-label="Sheets" style={{ marginBottom: 10 }}>{pv.sheets.map((s, i) => <button key={s.name} aria-pressed={sheet === i} onClick={() => setSheet(i)}>{s.name}</button>)}</div>}
          <div style={{ overflow: 'auto', maxHeight: '60vh', border: '1px solid var(--border)', borderRadius: 6 }}>
            <table className="table" aria-label={pv.sheets[sheet]?.name}>
              <tbody>{(pv.sheets[sheet]?.rows ?? []).slice(0, 500).map((r, i) => (
                <tr key={i}>{r.map((c, j) => i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
          {(pv.sheets[sheet]?.rows.length ?? 0) > 500 && <p className="hint">Showing the first 500 rows.</p>}
        </>
      )}
      {pv?.kind === 'slides' && (
        <ol style={{ paddingLeft: 20 }}>
          {pv.slides.map((s, i) => <li key={i} style={{ marginBottom: 14 }}><b>{s[0] ?? `Slide ${i + 1}`}</b>{s.slice(1).map((l, j) => <div key={j}>{l}</div>)}</li>)}
        </ol>
      )}
      {pv?.kind === 'none' && <div className="empty"><h3>Couldn’t preview file</h3><p>{err ?? 'Preview is not supported for this file type. Download it to open it in another app.'}</p></div>}
    </>
  );
}

export function FilePreviewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { file, pv, err, save } = useFilePreview(id);
  return (
    <Dialog title={file?.name ?? 'File'} wide onClose={onClose} footer={<button className="btn" disabled={!file} onClick={save}><Download size={16} /> Download</button>}>
      <FilePreviewBody file={file} pv={pv} err={err} />
    </Dialog>
  );
}
