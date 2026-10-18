import { AnimatePresence, motion, useAnimationFrame, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { STORY, type Story as StoryT } from '../data';
import { VISUALS } from './StoryVisuals';

const N = STORY.length;
const rand = (seed: number) => { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); };

/** The headline, one word at a time: each flies in from its own direction; `*words*` carry the gradient. */
function FlyWords({ text, seed }: { text: string; seed: number }) {
  const words = useMemo(() => text.split(/(\*[^*]+\*)/).flatMap(part => (part.startsWith('*') ? part.slice(1, -1).split(' ').map(w => ({ w, a: true })) : part.split(' ').filter(Boolean).map(w => ({ w, a: false })))), [text]);
  return (
    <h2 className="story-h">
      {words.map(({ w, a }, i) => (
        <motion.span key={i} className={a ? 'gradient-text' : undefined} style={{ display: 'inline-block', marginRight: '0.28em' }}
          initial={{ opacity: 0, x: (rand(seed * 31 + i) - 0.5) * 220, y: 40 + rand(seed * 17 + i) * 60, rotate: (rand(seed * 7 + i) - 0.5) * 30, filter: 'blur(8px)' }}
          animate={{ opacity: 1, x: 0, y: 0, rotate: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -40, filter: 'blur(6px)', transition: { duration: 0.25, delay: i * 0.015 } }}
          transition={{ type: 'spring', stiffness: 130, damping: 15, delay: 0.05 + i * 0.045 }}>{w}</motion.span>
      ))}
    </h2>
  );
}

/** Words that circle the picture. Scrolling turns them; the ones at the back are smaller and sit behind the card. */
function Orbit({ words, local, seed }: { words: string[]; local: MotionValue<number>; seed: number }) {
  const box = useRef<HTMLDivElement>(null);
  const els = useRef<(HTMLSpanElement | null)[]>([]);
  const size = useRef({ w: 600, h: 500 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { size.current = { w: el.offsetWidth, h: el.offsetHeight }; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useAnimationFrame(t => {
    const { w, h } = size.current;
    const turn = local.get() * Math.PI * 1.4 + (t / 1000) * 0.14;
    words.forEach((_, i) => {
      const el = els.current[i];
      if (!el) return;
      const ring = i % 2; // two rings, so the words do not queue up on one line
      const a = (i / words.length) * Math.PI * 2 + turn * (ring ? -0.8 : 1) + seed;
      const x = Math.cos(a) * w * (ring ? 0.48 : 0.41);
      const y = Math.sin(a) * h * (ring ? 0.46 : 0.4);
      const depth = (Math.sin(a) + 1) / 2;
      el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(0.78 + depth * 0.3).toFixed(3)})`;
      el.style.opacity = String(0.66 + depth * 0.34);
      el.style.zIndex = depth > 0.5 ? '3' : '0';
      el.style.filter = depth < 0.3 ? 'blur(0.8px)' : 'none';
    });
  });
  return (
    <div className="orbit" ref={box} aria-hidden>
      {words.map((w, i) => (
        <span key={w} className="orb" ref={el => { els.current[i] = el; }}>
          <motion.i initial={{ opacity: 0, scale: 0.2 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.4 }} transition={{ type: 'spring', stiffness: 150, damping: 14, delay: 0.3 + i * 0.06 }} className={`t-${['green', 'indigo', 'purple', 'orange', 'pink'][(i + seed) % 5]}`}>{w}</motion.i>
        </span>
      ))}
    </div>
  );
}

function Slide({ s, i, local, scrollTo }: { s: StoryT; i: number; local: MotionValue<number>; scrollTo: (i: number) => void }) {
  const Visual = VISUALS[s.id];
  const rotateY = useTransform(local, [0, 1], [-9, 9]);
  const rotateX = useTransform(local, [0, 1], [4, -4]);
  const y = useTransform(local, [0, 1], [22, -22]);
  const Icon = s.icon;
  return (
    <motion.div className={`story-slide tone-${s.tone}`} key={s.id} exit={{ opacity: 1 }}>
      <div className="story-copy">
        <motion.span className="story-num" initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }} transition={{ duration: 0.5 }}>{String(i + 1).padStart(2, '0')}<small>/{String(N).padStart(2, '0')}</small></motion.span>
        <motion.span className="story-kicker" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: 0.05 }}><Icon size={16} aria-hidden /> {s.kicker}</motion.span>
        <FlyWords text={s.headline} seed={i + 1} />
        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ delay: 0.35, duration: 0.5 }}>{s.text}</motion.p>
        <motion.ul className="story-chips" initial="h" animate="s" exit="x" variants={{ s: { transition: { staggerChildren: 0.08, delayChildren: 0.55 } }, x: {} }}>
          {s.chips.map(c => <motion.li key={c} variants={{ h: { opacity: 0, y: 14, scale: 0.9 }, s: { opacity: 1, y: 0, scale: 1 }, x: { opacity: 0 } }}>{c}</motion.li>)}
        </motion.ul>
      </div>
      <div className="story-visual">
        <Orbit words={s.words} local={local} seed={i} />
        <motion.div className="story-card" style={{ rotateY, rotateX, y, transformPerspective: 1100 }} initial={{ opacity: 0, scale: 0.86, y: 60 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94, y: -50 }} transition={{ type: 'spring', stiffness: 110, damping: 16 }}>
          <Visual />
        </motion.div>
      </div>
      <button className="sr-only" onClick={() => scrollTo(i)}>{s.kicker}</button>
    </motion.div>
  );
}

function Pinned() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const [i, setI] = useState(0);
  const local = useMotionValue(0);
  useMotionValueEvent(scrollYProgress, 'change', v => {
    const x = Math.min(N - 0.001, Math.max(0, v * N));
    const idx = Math.floor(x);
    local.set(x - idx);
    setI(idx);
  });
  const scrollTo = (n: number) => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + ((n + 0.5) / N) * (el.offsetHeight - window.innerHeight), behavior: 'smooth' });
  };
  return (
    <section className="story" ref={ref} id="features" aria-label="What Ergonotes is good at" style={{ ['--n' as string]: N }}>
      <div className="story-stick">
        <div className="story-bg" aria-hidden>{STORY.map((s, n) => <i key={s.id} className={`tone-${s.tone}`} style={{ opacity: n === i ? 1 : 0 }} />)}</div>
        <div className="wrap story-grid">
          <AnimatePresence mode="wait">
            <Slide key={STORY[i].id} s={STORY[i]} i={i} local={local} scrollTo={scrollTo} />
          </AnimatePresence>
        </div>
        <nav className="story-rail" aria-label="Feature slides">
          {STORY.map((s, n) => (
            <button key={s.id} className={n === i ? 'on' : ''} onClick={() => scrollTo(n)} aria-label={s.kicker} aria-current={n === i}><span>{s.kicker}</span><i /></button>
          ))}
        </nav>
        <motion.div className="story-progress" style={{ scaleX: scrollYProgress }} aria-hidden />
      </div>
      <ul className="sr-only">{STORY.map(s => <li key={s.id}><b>{s.kicker}</b>: {s.headline.replace(/\*/g, '')}. {s.text}</li>)}</ul>
    </section>
  );
}

/** For people who ask for less motion: the same slides, one under the other, with nothing pinned or flying. */
function Stacked() {
  return (
    <section className="story-static wrap" id="features" aria-label="What Ergonotes is good at">
      {STORY.map(s => {
        const Visual = VISUALS[s.id];
        const Icon = s.icon;
        return (
          <article key={s.id} className={`story-slide tone-${s.tone}`}>
            <div className="story-copy">
              <span className="story-kicker"><Icon size={16} aria-hidden /> {s.kicker}</span>
              <h2 className="story-h">{s.headline.split(/(\*[^*]+\*)/).map((p, k) => (p.startsWith('*') ? <span key={k} className="gradient-text">{p.slice(1, -1)}</span> : p))}</h2>
              <p>{s.text}</p>
              <ul className="story-chips">{s.chips.map(c => <li key={c}>{c}</li>)}</ul>
            </div>
            <div className="story-visual"><div className="story-card"><Visual /></div></div>
          </article>
        );
      })}
    </section>
  );
}

export function Story() {
  const reduce = useReducedMotion();
  return reduce ? <Stacked /> : <Pinned />;
}
