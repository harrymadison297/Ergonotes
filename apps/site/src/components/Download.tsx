import { ArrowDownToLine, Clock } from 'lucide-react';
import { DOWNLOADS } from '../data';
import { DOWNLOAD, RELEASES_URL } from '../github';
import { Reveal } from './motion';

const guessOs = (): 'windows' | 'linux' | 'android' | null => {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return null;
};

export function Download() {
  const os = guessOs();
  return (
    <section className="section" id="download">
      <div className="wrap">
        <Reveal style={{ textAlign: 'center', display: 'grid', gap: 16, justifyItems: 'center' }}>
          <span className="eyebrow">Get Ergonotes</span>
          <h2 className="h2">Every platform, installer or portable</h2>
          <p className="lead">Free, with no account. The apps keep your notes as files on your device and need no password to start.</p>
        </Reveal>
        <div className="dl-grid">
          {DOWNLOADS.map((d, i) => {
            const Icon = d.icon;
            const soon = !d.file;
            const body = (
              <>
                {d.os && d.os === os && <span className="rec">For your device</span>}
                <span className="ico"><Icon aria-hidden /></span>
                <b>{d.title}</b>
                <span>{d.sub}</span>
                {soon ? <span className="go"><Clock aria-hidden /> Coming soon</span> : <span className="go"><ArrowDownToLine aria-hidden /> Download</span>}
              </>
            );
            return (
              <Reveal key={d.title} delay={(i % 4) * 0.06} y={20} style={{ display: 'contents' }}>
                {soon
                  ? <div className={`dl tone-${d.tone} soon`}>{body}</div>
                  : <a className={`dl tone-${d.tone}`} href={DOWNLOAD(d.file!)} rel="noreferrer">{body}</a>}
              </Reveal>
            );
          })}
        </div>
        <p className="dl-note">Checksums are in <a href={DOWNLOAD('SHA256SUMS')} rel="noreferrer">SHA256SUMS</a>. All versions and release notes are on the <a href={RELEASES_URL} target="_blank" rel="noreferrer">releases page</a>.</p>
      </div>
    </section>
  );
}
