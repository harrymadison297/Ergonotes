import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Download, Loader2, Trash2, X } from 'lucide-react';
import { deleteModel, downloadModel, localModels, onChoice, readChoice, writeChoice, type LocalModel, type LocalProgress } from '../backend/localWhisper';
import { classNames } from '../state/util';

const LANGUAGES: [string, string][] = [
  ['', 'Recognise it'], ['vi', 'Vietnamese'], ['en', 'English'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'],
  ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['th', 'Thai'], ['id', 'Indonesian'],
];

const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

/** Whether this device can run speech models itself (the desktop app), found by asking it once. */
export function useLocalModels(): { models: LocalModel[] | null; reload: () => Promise<void> } {
  const [models, setModels] = useState<LocalModel[] | null>(null);
  const reload = async () => setModels(await localModels());
  useEffect(() => { void reload(); }, []);
  return { models, reload };
}

/** The models to download and use on this computer, and the language to expect. Nothing here is sent anywhere. */
export function LocalSpeechSettings({ models, reload, onError }: { models: LocalModel[]; reload: () => Promise<void>; onError: (text: string) => void }) {
  const choice = useSyncExternalStore(onChoice, () => JSON.stringify(readChoice()));
  const { model: using, language } = JSON.parse(choice) as ReturnType<typeof readChoice>;
  const [progress, setProgress] = useState<LocalProgress | null>(null);
  const stop = useRef<AbortController | null>(null);

  const get = async (m: LocalModel) => {
    const ctl = new AbortController();
    stop.current = ctl;
    setProgress({ id: m.id, received: 0, total: m.size });
    try {
      await downloadModel(m.id, setProgress, ctl.signal);
      await reload();
      // the first model downloaded is the one in use: that is why it was asked for
      if (!readChoice().model) writeChoice({ model: m.id, language: readChoice().language });
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (text !== 'Cancelled') onError(text);
    }
    stop.current = null;
    setProgress(null);
  };

  const remove = async (m: LocalModel) => {
    try {
      await deleteModel(m.id);
      if (readChoice().model === m.id) writeChoice({ model: '', language: readChoice().language });
      await reload();
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div>
      <div role="radiogroup" aria-label="Speech model on this computer" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {models.map(m => {
          const on = using === m.id;
          const busy = progress?.id === m.id;
          const pct = busy && progress.total ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;
          return (
            <div key={m.id} className={classNames('input', on && 'on')} role="radio" aria-checked={on} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', height: 'auto', borderColor: on ? 'var(--green-fill)' : undefined }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{m.label}</div>
                <div className="hint" style={{ margin: 0 }}>
                  {busy ? `Downloading… ${pct}% of ${mb(m.size)}` : m.downloaded ? `${mb(m.size)} on this computer` : `${mb(m.size)} to download`}
                </div>
                {busy && <progress value={pct} max={100} style={{ width: '100%' }} aria-label={`Downloading ${m.label}`} />}
              </div>
              {busy
                ? <button type="button" className="btn" onClick={() => stop.current?.abort()}><X size={15} /> Cancel</button>
                : m.downloaded
                  ? <>
                    {on ? <span style={{ color: 'var(--green-ink)', display: 'flex', alignItems: 'center', gap: 4 }}><Check size={15} /> In use</span>
                      : <button type="button" className="btn" onClick={() => writeChoice({ model: m.id, language })}>Use</button>}
                    <button type="button" className="icon-btn" title={`Delete ${m.label} from this computer`} aria-label={`Delete ${m.label}`} onClick={() => void remove(m)}><Trash2 size={15} /></button>
                  </>
                  : <button type="button" className="btn" disabled={!!progress} onClick={() => void get(m)}>{progress ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Download</button>}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <label htmlFor="local-speech-lang">Language</label>
        <select id="local-speech-lang" className="input" style={{ width: 'auto' }} value={language} onChange={e => writeChoice({ model: using, language: e.target.value })}>
          {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </div>
    </div>
  );
}
