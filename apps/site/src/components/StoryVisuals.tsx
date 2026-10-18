// The pictures of the flagship slides: small made-up screens drawn in HTML, so they stay sharp and can move.
import { Check, ChevronRight, Download, File, Folder, FolderOpen, Heading1, KeyRound, ListChecks, Mic, Pi, Table2, Workflow } from 'lucide-react';
import type { ReactNode } from 'react';

const rnd = (seed: number) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

function Card({ title, right, children, className = '' }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`mk ${className}`}>
      <div className="mk-bar"><i /><i /><i /><span>{title}</span>{right}</div>
      {children}
    </div>
  );
}

export function Write() {
  const items: [ReactNode, string, string][] = [[<Heading1 />, 'Heading', 'indigo'], [<ListChecks />, 'Task list', 'purple'], [<ChevronRight />, 'Toggle', 'orange'], [<Table2 />, 'Table', 'green'], [<Workflow />, 'Mermaid', 'pink'], [<Pi />, 'Formula', 'indigo']];
  return (
    <Card title="Half marathon.md" right={<b className="mk-pill">saved as Markdown</b>}>
      <div className="mk-body mk-note">
        <h4>Half marathon</h4>
        <p>Race day <span className="mk-tag orange">Nov 25</span> · target <span className="mk-tag indigo">1:45:00</span></p>
        <label className="mk-task"><i className="on"><Check size={12} /></i> Long run, 14 km</label>
        <label className="mk-task"><i /> Book the race hotel <span className="mk-tag purple">due Fri</span></label>
        <div className="mk-toggle"><ChevronRight size={14} /> Training plan</div>
        <p className="mk-slash"><span>/</span><em /></p>
        <div className="mk-menu" aria-hidden>
          {items.map(([icon, label, tone], i) => <div key={label} className={i === 0 ? 'on' : ''}><span className={`t-${tone}`}>{icon}</span>{label}</div>)}
        </div>
      </div>
      <pre className="mk-md" aria-hidden><span className="k"># </span>Half marathon{'\n'}- [ ] Book the race hotel <span className="d">@due(2026-10-23)</span></pre>
    </Card>
  );
}

export function Record() {
  const r = rnd(7);
  const bars = Array.from({ length: 44 }, () => 18 + Math.round(r() * 70));
  return (
    <Card title="Meeting · design review" right={<b className="mk-rec"><i /> REC 00:42:17</b>}>
      <div className="mk-body">
        <div className="mk-wave" aria-hidden>{bars.map((h, i) => <i key={i} style={{ ['--h' as string]: `${h}%`, animationDelay: `${(i % 11) * 90}ms` }} />)}</div>
        <div className="mk-timeline" aria-hidden>
          <span className="play" />
          {[12, 38, 66, 86].map((x, i) => <span key={x} className="frame" style={{ left: `${x}%`, ['--c' as string]: ['var(--indigo)', 'var(--green)', 'var(--orange)', 'var(--pink)'][i] }}><Mic size={10} /></span>)}
        </div>
        <ul className="mk-lines">
          <li><time>0:12</time><b>Mai</b> Let us start with the hero and the headline size.</li>
          <li><time>4:40</time><b>Tuan</b> Two labels are grey on grey in dark mode.</li>
          <li className="live"><time>7:05</time><b>Harry</b> I will raise the contrast today and ship tomorrow<em /></li>
        </ul>
      </div>
    </Card>
  );
}

export function Assist() {
  return (
    <Card title="Assistant" right={<b className="mk-pill">canned-replies · Auto</b>}>
      <div className="mk-body mk-chat">
        <p className="me">What is left on the demo plan?</p>
        <div className="tools"><span><i /> Searched notes for “demo plan”</span><span><i /> Read a note</span></div>
        <p className="ai">Two things: a habit check-in clip, due in 2 days, and asking five friends to try it. Launch day is Friday at 10:00<em /></p>
        <div className="mk-ghost"><span>Book the race hotel&nbsp;</span><span className="g">before the prices go up</span><kbd>Tab</kbd></div>
        <div className="mk-review"><b>Review changes</b><span className="add">+ Ask five friends to try it @due(Sun)</span><div><button tabIndex={-1}>Accept</button><button tabIndex={-1} className="ghost">Reject</button></div></div>
      </div>
    </Card>
  );
}

export function Connect() {
  return (
    <Card title="Settings · AI and agents">
      <div className="mk-body mk-conn">
        <ul>
          {[['OpenRouter', 'google/gemma-4-31b-it:free'], ['Anthropic', 'claude-sonnet-5-5'], ['Custom server', 'localhost:11434 · llama3.2']].map(([n, m]) => (
            <li key={n}><span className="dot" /><b>{n}</b><small>{m}</small><i className="sw" /></li>
          ))}
        </ul>
        <pre className="mk-cli" aria-hidden><span className="c"># give an agent your notes</span>{'\n'}claude mcp add --transport http ergonotes \{'\n'}  https://you.example/mcp \{'\n'}  --header "Authorization: Bearer <span className="d">••••••</span>"</pre>
        <div className="mk-files">
          <span><File size={14} /> SKILL.md <small>Ergonotes skill</small> <Download size={13} /></span>
          <span><KeyRound size={14} /> Claude Code <small>token</small> <em>Revoke</em></span>
        </div>
      </div>
    </Card>
  );
}

export function Track() {
  const r = rnd(297);
  const cells = Array.from({ length: 17 * 7 }, (_, i) => (i > 17 * 7 - 3 ? 0 : r() < 0.78 ? (r() < 0.45 ? 2 : 1) : r() < 0.5 ? -1 : 0));
  return (
    <Card title="Habits">
      <div className="mk-body">
        <div className="mk-stats"><span><small>Streak</small><b>6 days</b></span><span><small>Best</small><b>28 days</b></span><span><small>30 days</small><b>80%</b></span></div>
        <div className="mk-heat" aria-hidden>{cells.map((c, i) => <i key={i} className={c === 2 ? 'h2' : c === 1 ? 'h1' : c === -1 ? 'miss' : ''} style={{ animationDelay: `${Math.floor(i / 7) * 30 + (i % 7) * 8}ms` }} />)}</div>
        <ul className="mk-habits">
          {[['Run', '3/3 in 7 days', true], ['Drink 2L of water', '1/1 today', true], ['Read 20 pages', '5/5 in 7 days', true], ['Write the day’s journal', '0/1 today', false]].map(([n, s, d]) => (
            <li key={n as string}><i className={d ? 'on' : ''}>{d && <Check size={13} />}</i><b>{n}</b><small>{s}</small></li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export function Para() {
  const F: [string, string, string, number][] = [['Projects', 'indigo', 'pf-1', 4], ['Areas', 'green', 'pf-2', 6], ['Resources', 'orange', 'pf-3', 9], ['Archive', 'purple', 'pf-4', 12]];
  return (
    <Card title="Folders">
      <div className="mk-body mk-para">
        <div className="mk-inbox"><b>Inbox <em>3</em></b>
          <span className="n n1">Buy trail shoes</span><span className="n n2">Idea: sleep widget</span><span className="n n3">Book the dentist</span>
        </div>
        <div className="mk-folders">
          {F.map(([n, t, c, k]) => <div key={n} className={`${c} t-${t}`}>{n === 'Projects' ? <FolderOpen size={20} /> : <Folder size={20} />}<b>{n}</b><small>{k} notes</small></div>)}
        </div>
      </div>
    </Card>
  );
}

export function Code() {
  return (
    <div className="mk mk-vs">
      <div className="mk-bar"><i /><i /><i /><span>Visual Studio Code · vault</span></div>
      <div className="vs-main">
        <div className="vs-side" aria-hidden>
          <small>EXPLORER</small>
          <p><Folder size={13} /> Inbox</p><p><FolderOpen size={13} /> Projects</p><p className="i"><File size={13} /> Half marathon.md</p><p><Folder size={13} /> Areas</p><p><Folder size={13} /> .habits</p>
        </div>
        <pre className="vs-ed" aria-hidden><span className="c">---</span>{'\n'}<span className="k">tags</span>: [<span className="s">running</span>]{'\n'}<span className="c">---</span>{'\n'}<span className="h"># Half marathon</span>{'\n'}Race day <span className="d">@event(2026-11-25)</span>{'\n'}- [ ] Book the hotel <span className="d">@due(2026-10-23)</span>{'\n'}See [[Running log]]</pre>
        <div className="vs-prev" aria-hidden><h5>Half marathon</h5><p>Race day <span className="mk-tag orange">Nov 25</span></p><label className="mk-task"><i /> Book the hotel</label><p><u>Running log</u></p></div>
      </div>
      <div className="vs-status"><span>main</span><span>Ergonotes</span><span className="ok"><Check size={12} /> Run 3/3</span><span>Ln 6, Col 12</span></div>
    </div>
  );
}

export const VISUALS: Record<string, () => JSX.Element> = { write: Write, record: Record, assist: Assist, connect: Connect, track: Track, para: Para, code: Code };

