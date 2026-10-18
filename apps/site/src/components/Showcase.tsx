import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { SLIDES } from '../data';
import { useTheme } from '../theme';
import { Reveal } from './motion';

const SECONDS = 7;

export function Showcase() {
  const [theme] = useTheme();
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  // rotate the tour by itself, unless the visitor chose one, is pointing at it or prefers no motion
  useEffect(() => {
    if (paused || reduce) return;
    const t = setTimeout(() => setI(n => (n + 1) % SLIDES.length), SECONDS * 1000);
    return () => clearTimeout(t);
  }, [i, paused, reduce]);
  const s = SLIDES[i];
  const src = theme === 'dark' && s.dark ? s.dark : s.light;
  return (
    <section className="section" id="showcase">
      <div className="wrap">
        <Reveal style={{ textAlign: 'center', display: 'grid', gap: 16, justifyItems: 'center' }}>
          <span className="eyebrow">A quick tour</span>
          <h2 className="h2">Calm on the surface, deep underneath</h2>
        </Reveal>
        <div className="showcase" onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
          <div className="tabs" role="tablist" aria-label="Tour of Ergonotes">
            {SLIDES.map((t, n) => {
              const Icon = t.icon;
              return (
                <button key={t.id} role="tab" aria-selected={n === i} className={`tab tone-${t.tone}`} style={{ ['--dur' as string]: `${SECONDS}s` }} onClick={() => { setI(n); setPaused(true); }}>
                  <b><Icon aria-hidden /> {t.title}</b>
                  <p>{t.text}</p>
                  <span className="bar" aria-hidden><i key={`${n}-${i}-${paused}`} style={paused ? { width: n === i ? '100%' : 0, animation: 'none' } : undefined} /></span>
                </button>
              );
            })}
          </div>
          <div className="shot" role="tabpanel">
            <AnimatePresence mode="wait">
              <motion.div className="frame" key={s.id + src} initial={reduce ? false : { opacity: 0, scale: 0.97, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, scale: 0.98 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
                <div className="frame-bar"><i /><i /><i /><span>Ergonotes</span></div>
                <img src={`/img/${src}.webp`} alt={s.title} width="1440" height="900" loading="lazy" />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
