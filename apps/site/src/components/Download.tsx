import { useMemo } from 'react';
import { ArrowDownToLine, Clock, Globe, ShieldCheck } from 'lucide-react';
import { DOWNLOADS } from '../data';
import { DOWNLOAD, formatSize, RELEASES_URL, useLatestRelease } from '../github';
import { currentPlatform, OS_NAME, recommendedFile } from '../platform';
import { Reveal } from './motion';

export function Download() {
  const platform = useMemo(currentPlatform, []);
  const rel = useLatestRelease();
  const file = recommendedFile(platform);
  const main = file ? DOWNLOADS.find(d => d.file === file) : undefined;
  const others = DOWNLOADS.filter(d => d.file !== file);
  const size = formatSize(file ? rel?.sizes[file] : undefined);
  const Icon = main?.icon;

  return (
    <section className="section" id="download">
      <div className="wrap">
        <Reveal style={{ textAlign: 'center', display: 'grid', gap: 16, justifyItems: 'center' }}>
          <span className="eyebrow">Get Ergonotes</span>
          <h2 className="h2">Download Ergonotes</h2>
          <p className="lead">Free, with no account. The apps keep your notes as files on your device and need no password to start.</p>
        </Reveal>

        <Reveal y={20}>
          {main && Icon ? (
            <div className={`dl-main tone-${main.tone}`}>
              <span className="ico"><Icon aria-hidden /></span>
              <div className="copy">
                <b>Ergonotes for {OS_NAME[platform.os]}</b>
                <span>{main.sub}{rel ? ` · version ${rel.tag}` : ''}{size ? ` · ${size}` : ''}</span>
                {platform.os === 'windows' && (
                  <span className="trust"><ShieldCheck aria-hidden /><span>Open source. The installer is not code-signed yet, so Windows may ask you to confirm: choose <i>More info</i>, then <i>Run anyway</i>. Checksums are in <a href={DOWNLOAD('SHA256SUMS')} rel="noreferrer">SHA256SUMS</a>.</span></span>
                )}
              </div>
              <a className="btn btn-primary btn-xl" href={DOWNLOAD(file!)} rel="noreferrer"><ArrowDownToLine aria-hidden /> Download now</a>
            </div>
          ) : (
            <div className="dl-main tone-indigo">
              <span className="ico"><Globe aria-hidden /></span>
              <div className="copy">
                <b>{platform.os === 'other' ? 'Choose your download' : `Ergonotes is not built for ${OS_NAME[platform.os]}${platform.arm ? ' on ARM' : ''} yet`}</b>
                <span>{platform.os === 'other' ? 'We could not tell which system you use. Pick yours below.' : 'You can try it in your browser, or use the server peer or the VS Code extension below.'}</span>
              </div>
              <a className="btn btn-primary btn-xl" href="#demo"><Globe aria-hidden /> Try it in your browser</a>
            </div>
          )}
        </Reveal>

        <h3 className="dl-sub" id="other-downloads">{main ? 'Other downloads' : 'All downloads'}</h3>
        <div className="dl-grid">
          {others.map((d, i) => {
            const I = d.icon;
            const soon = !d.file;
            const sz = formatSize(d.file ? rel?.sizes[d.file] : undefined);
            const body = (
              <>
                <span className="ico"><I aria-hidden /></span>
                <b>{d.title}</b>
                <span>{d.sub}</span>
                {soon ? <span className="go"><Clock aria-hidden /> Coming soon</span> : <span className="dl-btn"><ArrowDownToLine aria-hidden /> Download{sz ? ` · ${sz}` : ''}</span>}
              </>
            );
            return (
              <Reveal key={d.title} delay={(i % 4) * 0.06} y={20} style={{ display: 'contents' }}>
                {soon
                  ? <div className={`dl tone-${d.tone} soon`}>{body}</div>
                  : <a className={`dl tone-${d.tone}`} href={DOWNLOAD(d.file!)} rel="noreferrer" aria-label={`Download ${d.title}`}>{body}</a>}
              </Reveal>
            );
          })}
        </div>
        <p className="dl-note">Checksums are in <a href={DOWNLOAD('SHA256SUMS')} rel="noreferrer">SHA256SUMS</a>. All versions and release notes are on the <a href={RELEASES_URL} target="_blank" rel="noreferrer">releases page</a>.</p>
      </div>
    </section>
  );
}
