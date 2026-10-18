import { ALSO, STRIP } from '../data';
import { Reveal } from './motion';
import { Story } from './Story';

export function Strip() {
  const items = [...STRIP, ...STRIP];
  return (
    <div className="strip" aria-hidden>
      <div className="strip-track">{items.map(([Icon, label], i) => <span key={i}><Icon /> {label}</span>)}</div>
    </div>
  );
}

export function Features() {
  return (
    <>
      <div className="wrap story-intro">
        <Reveal style={{ textAlign: 'center', display: 'grid', gap: 16, justifyItems: 'center' }}>
          <span className="eyebrow">What stands out</span>
          <h2 className="h2">Seven things Ergonotes is <span className="gradient-text">really good at</span></h2>
          <p className="lead">Scroll to flip through them.</p>
        </Reveal>
      </div>
      <Story />
      <div className="wrap also">
        <Reveal>
          <p className="also-label">And the everyday things</p>
          <ul>{ALSO.map(a => <li key={a}>{a}</li>)}</ul>
        </Reveal>
      </div>
    </>
  );
}
