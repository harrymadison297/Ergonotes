import { ExternalLink, Play, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTheme } from '../theme';
import { Reveal } from './motion';

export function Demo() {
  const [theme] = useTheme();
  const [on, setOn] = useState(false);
  return (
    <section className="section demo" id="demo">
      <div className="wrap">
        <Reveal style={{ textAlign: 'center', display: 'grid', gap: 16, justifyItems: 'center' }}>
          <span className="eyebrow">No sign-up, no install</span>
          <h2 className="h2">Try the real app, right here</h2>
          <p className="lead">This is the actual Ergonotes, running in your browser with the notes of a made-up person, Harry. Tick a habit, edit a note, ask the assistant. Nothing leaves this tab.</p>
        </Reveal>
        <Reveal className="demo-frame">
          <div className="frame">
            <div className="frame-bar"><i /><i /><i /><span>ergonotes demo</span></div>
            <div className="demo-body">
              {on
                ? <iframe src="/demo/" title="Ergonotes interactive demo" allow="clipboard-read; clipboard-write" />
                : <>
                    <img src={`/img/${theme === 'dark' ? 'home-dark' : 'home-light'}.webp`} alt="" width="1440" height="900" loading="lazy" />
                    <div className="demo-cover"><button className="btn btn-primary" onClick={() => setOn(true)}><i className="pulse" aria-hidden /><Play size={20} aria-hidden /> Launch the interactive demo</button></div>
                  </>}
            </div>
          </div>
          <div className="demo-foot">
            <a href="/demo/" target="_blank" rel="noreferrer"><ExternalLink size={14} style={{ display: 'inline', verticalAlign: '-2px' }} aria-hidden /> Open it full screen</a>
            <span><RotateCcw size={14} style={{ display: 'inline', verticalAlign: '-2px' }} aria-hidden /> A Reset button inside starts it over</span>
            <span>Sync and the assistant’s real models need the installed apps</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
