// Settings → Keyboard: every Command with its keys, and a way to change them. The keys are the person's own, kept on
// this device (prefs.keys); a Command that was never touched keeps the keys it came with.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RotateCcw, X } from 'lucide-react';
import { COMMANDS, boundCommands, commandById, keysFor, type Command, type CommandGroup } from '../state/commands';
import { chordOf, conflicts, formatBinding, normalizeBinding, reasonNotAllowed } from '../state/keymap';
import { setPrefs, usePrefs } from '../state/prefs';

const GROUPS: CommandGroup[] = ['General', 'Navigate', 'View', 'Items'];
const GROUP_LABEL: Record<CommandGroup, string> = { General: 'General', Navigate: 'Go to', View: 'View', Items: 'Notes and folders in a list' };
const sameKeys = (a: string[], b: string[]) => a.length === b.length && a.every(k => b.includes(k));

interface Pending { id: string; binding: string; others: string[] }

export function KeyboardSettings() {
  const prefs = usePrefs();
  const [q, setQ] = useState('');
  const [recording, setRecording] = useState<string | null>(null);
  const [first, setFirst] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRef = useRef<string | null>(null);

  const keysOf = (c: Command) => keysFor(c, prefs.keys);
  const setKeys = (c: Command, keys: string[], keys2: Record<string, string[]> = prefs.keys) => {
    const next = { ...keys2 };
    if (sameKeys(keys.map(normalizeBinding), c.keys.map(normalizeBinding))) delete next[c.id]; else next[c.id] = keys;
    setPrefs({ keys: next });
  };

  const finish = (c: Command, binding: string) => {
    setRecording(null);
    setFirst(null);
    firstRef.current = null;
    const b = normalizeBinding(binding);
    const bad = reasonNotAllowed(b);
    if (bad) { setProblem(bad); return; }
    const clash = conflicts(b, boundCommands(prefs.keys), c.id);
    if (clash.length) { setPending({ id: c.id, binding: b, others: clash }); setProblem(''); return; }
    setProblem('');
    setKeys(c, [...new Set([...keysOf(c), b])]);
  };

  // while a key is being asked for, the keyboard belongs to this list
  useEffect(() => {
    if (!recording) return;
    const c = commandById(recording);
    if (!c) return;
    const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { clearTimer(); setRecording(null); setFirst(null); firstRef.current = null; return; }
      const chord = chordOf(e);
      if (!chord) return;
      clearTimer();
      if (/^(Mod|Alt)\+/.test(chord)) { finish(c, chord); return; }
      // a bare key: a second one may follow ("g h"); if none does, it stands alone
      if (firstRef.current) { const f = firstRef.current; finish(c, `${f} ${chord}`); return; }
      firstRef.current = chord;
      setFirst(chord);
      timer.current = setTimeout(() => { const f = firstRef.current; if (f) finish(c, f); }, 1100);
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); clearTimer(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, prefs.keys]);

  const shown = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return COMMANDS.filter(c => terms.every(t => `${c.title} ${c.keywords ?? ''} ${GROUP_LABEL[c.group]} ${keysFor(c, prefs.keys).map(k => formatBinding(k)).join(' ')}`.toLowerCase().includes(t)));
  }, [q, prefs.keys]);

  const reassign = () => {
    if (!pending) return;
    const c = commandById(pending.id)!;
    // the others lose these keys, then the Command gets them
    const next = { ...prefs.keys };
    for (const id of pending.others) {
      const o = commandById(id)!;
      const kept = keysFor(o, next).filter(k => { const n = normalizeBinding(k); return !(n === pending.binding || n.startsWith(`${pending.binding} `) || pending.binding.startsWith(`${n} `)); });
      if (sameKeys(kept, o.keys.map(normalizeBinding))) delete next[id]; else next[id] = kept;
    }
    const mine = [...new Set([...keysFor(c, next), pending.binding])];
    if (sameKeys(mine, c.keys.map(normalizeBinding))) delete next[c.id]; else next[c.id] = mine;
    setPrefs({ keys: next });
    setPending(null);
  };

  const changed = Object.keys(prefs.keys).length;
  const nameOf = (id: string) => commandById(id)?.title ?? id;

  return (
    <div className="kbd-settings">
      <div className="kbd-head">
        <input className="input" type="search" placeholder="Find a command or a key" aria-label="Find a command or a key" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn" disabled={!changed} onClick={() => { if (confirm('Put every shortcut back the way it came?')) setPrefs({ keys: {} }); }}><RotateCcw size={15} /> Reset all</button>
      </div>
      <p className="hint">Click “Add key”, then press the keys. A key with Ctrl or Alt works anywhere, even while writing; two plain keys one after the other (like <kbd>g</kbd> then <kbd>h</kbd>) work when you are not typing. These are kept on this device.</p>
      {problem && <p role="alert" className="error-text">{problem}</p>}
      {pending && (
        <div role="alertdialog" aria-label="Keys already in use" className="kbd-clash">
          <span><kbd>{formatBinding(pending.binding)}</kbd> already belongs to {pending.others.map(nameOf).join(', ')}.</span>
          <button className="btn primary" onClick={reassign}>Use it here instead</button>
          <button className="btn" onClick={() => setPending(null)}>Cancel</button>
        </div>
      )}
      <div className="kbd-list">
        {GROUPS.map(g => {
          const rows = shown.filter(c => c.group === g);
          if (!rows.length) return null;
          return (
            <section key={g} aria-label={GROUP_LABEL[g]}>
              <h4>{GROUP_LABEL[g]}</h4>
              {rows.map(c => {
                const keys = keysOf(c);
                const own = prefs.keys[c.id] !== undefined && !sameKeys(keys, c.keys.map(normalizeBinding));
                const active = recording === c.id;
                return (
                  <div key={c.id} className="kbd-row" data-command={c.id}>
                    <span className="kbd-name">{c.title}</span>
                    <span className="kbd-keys">
                      {keys.length === 0 && <span className="hint">no keys</span>}
                      {keys.map(k => (
                        <span key={k} className="kbd-chip"><kbd>{formatBinding(k)}</kbd>
                          <button type="button" aria-label={`Remove ${formatBinding(k)} from ${c.title}`} onClick={() => setKeys(c, keys.filter(x => x !== k))}><X size={12} /></button>
                        </span>
                      ))}
                      {active
                        ? <span className="kbd-listening" role="status">{first ? `${formatBinding(first)} … then?` : 'Press the keys…'}</span>
                        : <button type="button" className="btn ghost" aria-label={`Add a key to ${c.title}`} onClick={() => { setProblem(''); setPending(null); setFirst(null); setRecording(c.id); }}><Plus size={14} /> Add key</button>}
                      {own && !active && <button type="button" className="btn ghost" aria-label={`Put the keys of ${c.title} back`} onClick={() => setKeys(c, c.keys)}><RotateCcw size={14} /> Reset</button>}
                    </span>
                  </div>
                );
              })}
            </section>
          );
        })}
        {shown.length === 0 && <p className="hint">No command matches “{q}”.</p>}
      </div>
    </div>
  );
}
