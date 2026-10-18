import { Reveal } from './motion';

const POINTS: [string, string][] = [
  ['No always-on server', 'Devices exchange sealed objects through a bucket, a WebDAV share or a folder. The optional server peer is just one more device.'],
  ['One password, or none', 'A new vault needs no password to start. Add one in Settings and everything in the vault’s hidden folder is sealed with it.'],
  ['Conflicts you can see', 'History is a commit graph, like Git. Edits made on two devices merge, and a real conflict is shown to you, never silently lost.'],
];

export function Sync() {
  return (
    <section className="section">
      <div className="wrap">
        <Reveal style={{ textAlign: 'center', display: 'grid', gap: 16, justifyItems: 'center' }}>
          <span className="eyebrow">Private by design</span>
          <h2 className="h2">Sync through storage you own</h2>
          <p className="lead">Everything is sealed on your device before it leaves. The storage only ever sees noise.</p>
        </Reveal>
        <Reveal className="sync">
          <svg viewBox="0 0 960 250" role="img" aria-label="Your laptop and your phone exchange encrypted objects through your own storage">
            <path className="wire" d="M170 125 H400" /><path className="wire" d="M560 125 H790" />
            <path className="flow" d="M170 125 H400" /><path className="flow" d="M790 125 H560" />
            <g><rect className="node" x="40" y="70" width="130" height="110" rx="18" /><text x="105" y="118" textAnchor="middle">Laptop</text><text className="sub" x="105" y="140" textAnchor="middle">your notes</text></g>
            <g><rect className="node" x="790" y="70" width="130" height="110" rx="18" /><text x="855" y="118" textAnchor="middle">Phone</text><text className="sub" x="855" y="140" textAnchor="middle">your notes</text></g>
            <g><rect className="node" x="400" y="55" width="160" height="140" rx="22" /><text x="480" y="112" textAnchor="middle">Your storage</text><text className="sub" x="480" y="134" textAnchor="middle">S3 · WebDAV · folder</text><text className="sub" x="480" y="154" textAnchor="middle">sees only noise</text></g>
            <g><circle className="lock" cx="285" cy="125" r="20" /><path d="M278 126v-4a7 7 0 0 1 14 0v4m-17 0h20v12h-20z" fill="none" stroke="var(--green-ink)" strokeWidth="2" strokeLinejoin="round" transform="translate(0 -3)" /></g>
            <g><circle className="lock" cx="675" cy="125" r="20" /><path d="M668 126v-4a7 7 0 0 1 14 0v4m-17 0h20v12h-20z" fill="none" stroke="var(--green-ink)" strokeWidth="2" strokeLinejoin="round" transform="translate(0 -3)" /></g>
          </svg>
          <div className="sync-points">{POINTS.map(([h, t]) => <div key={h}><h3>{h}</h3><p>{t}</p></div>)}</div>
        </Reveal>
      </div>
    </section>
  );
}
