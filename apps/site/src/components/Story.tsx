import { motion, useAnimationFrame, useMotionValueEvent, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { STORY, type Story as StoryT } from '../data';
import { VISUALS } from './StoryVisuals';

const N = STORY.length;
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const rand = (seed: number) => { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); };

/**
 * Everything on a slide is a function of the scroll position, not of a timer: a swipe moves the words and the picture
 * as far as the finger went, nothing waits for an animation to finish, and nothing restarts when the finger is quick.
 * `t` is where the page is on this slide (0 to 1 while it is the one shown); `enter` and `exit` are the short
 * stretches at either end where it comes in and goes out; `vis` is how much of it can be seen.
 */
interface Phase { t: MotionValue<number>; enter: MotionValue<number>; exit: MotionValue<number>; vis: MotionValue<number> }

function usePhase(p: MotionValue<number>, i: number): Phase {
  const t = useTransform(p, v => v - i);
  const enter = useTransform(t, v => (i === 0 ? 1 : clamp((v + 0.12) / 0.3)));
  const exit = useTransform(t, v => (i === N - 1 ? 0 : clamp((v - 0.88) / 0.3)));
  const vis = useTransform([enter, exit], ([e, x]: number[]) => Math.min(e, 1 - x));
  return { t, enter, exit, vis };
}

/** A block of the copy that rises into place a little after the one before it (`k` is its place in the order). */
function Staged({ ph, k, children, className, as = 'div' }: { ph: Phase; k: number; children: ReactNode; className?: string; as?: 'div' | 'p' | 'ul' | 'span' }) {
  const own = (e: number) => clamp(e * 1.6 - k * 0.14);
  const opacity = useTransform([ph.enter, ph.exit], ([e, x]: number[]) => own(e) * (1 - x));
  const y = useTransform([ph.enter, ph.exit], ([e, x]: number[]) => (1 - own(e)) * 28 - x * 20);
  const M = motion[as] as typeof motion.div;
  return <M className={className} style={{ opacity, y }}>{children}</M>;
}

/** One word of the headline: it flies in from its own direction as the slide comes in. */
function Word({ ph, i, seed, accent, children }: { ph: Phase; i: number; seed: number; accent: boolean; children: string }) {
  const own = (e: number) => clamp(e * 1.9 - i * 0.075);
  const dx = (rand(seed * 31 + i) - 0.5) * 220, dy = 40 + rand(seed * 17 + i) * 60, dr = (rand(seed * 7 + i) - 0.5) * 30;
  const x = useTransform(ph.enter, e => (1 - own(e)) * dx);
  const y = useTransform([ph.enter, ph.exit], ([e, o]: number[]) => (1 - own(e)) * dy - o * 36);
  const rotate = useTransform(ph.enter, e => (1 - own(e)) * dr);
  const opacity = useTransform([ph.enter, ph.exit], ([e, o]: number[]) => own(e) * (1 - o));
  return <motion.span className={accent ? 'gradient-text' : undefined} style={{ display: 'inline-block', marginRight: '0.28em', x, y, rotate, opacity }}>{children}</motion.span>;
}

function Headline({ text, ph, seed }: { text: string; ph: Phase; seed: number }) {
  const words = text.split(/(\*[^*]+\*)/).flatMap(part => (part.startsWith('*') ? part.slice(1, -1).split(' ').map(w => ({ w, a: true })) : part.split(' ').filter(Boolean).map(w => ({ w, a: false }))));
  return <h2 className="story-h">{words.map(({ w, a }, i) => <Word key={i} ph={ph} i={i} seed={seed} accent={a}>{w}</Word>)}</h2>;
}

/** Words that circle the picture. Scrolling turns them; the ones at the back are smaller and sit behind the card. */
function Orbit({ words, ph, seed }: { words: string[]; ph: Phase; seed: number }) {
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
  useAnimationFrame(time => {
    const vis = ph.vis.get();
    if (vis < 0.01) return; // a slide that is not on screen does not move
    const { w, h } = size.current;
    const turn = clamp(ph.t.get(), -0.3, 1.3) * Math.PI * 1.4 + (time / 1000) * 0.14;
    const enter = ph.enter.get(), exit = ph.exit.get();
    words.forEach((_, i) => {
      const el = els.current[i];
      if (!el) return;
      const ring = i % 2; // two rings, so the words do not queue up on one line
      const a = (i / words.length) * Math.PI * 2 + turn * (ring ? -0.8 : 1) + seed;
      const grow = clamp(enter * 1.7 - i * 0.07) * (1 - exit * 0.5);
      const x = Math.cos(a) * w * (ring ? 0.48 : 0.41) * (0.5 + 0.5 * grow);
      const y = Math.sin(a) * h * (ring ? 0.46 : 0.4) * (0.5 + 0.5 * grow);
      const depth = (Math.sin(a) + 1) / 2;
      el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${((0.78 + depth * 0.3) * (0.3 + 0.7 * grow)).toFixed(3)})`;
      el.style.opacity = String((0.66 + depth * 0.34) * grow * (1 - exit));
      el.style.zIndex = depth > 0.5 ? '3' : '0';
    });
  });
  return (
    <div className="orbit" ref={box} aria-hidden>
      {words.map((w, i) => (
        <span key={w} className="orb" ref={el => { els.current[i] = el; }}>
          <i className={`t-${['green', 'indigo', 'purple', 'orange', 'pink'][(i + seed) % 5]}`}>{w}</i>
        </span>
      ))}
    </div>
  );
}

const Slide = memo(function Slide({ s, i, p }: { s: StoryT; i: number; p: MotionValue<number> }) {
  const Visual = VISUALS[s.id];
  const ph = usePhase(p, i);
  const Icon = s.icon;
  const opacity = ph.vis;
  const visibility = useTransform(ph.vis, v => (v > 0.01 ? 'visible' : 'hidden'));
  const scale = useTransform([ph.enter, ph.exit], ([e, x]: number[]) => 0.86 + 0.14 * e - 0.06 * x);
  const y = useTransform([ph.enter, ph.exit, ph.t], ([e, x, t]: number[]) => (1 - e) * 70 - x * 60 - (clamp(t) - 0.5) * 44);
  const rotateY = useTransform(ph.t, t => (clamp(t, -0.3, 1.3) - 0.5) * 18);
  const rotateX = useTransform(ph.t, t => -(clamp(t, -0.3, 1.3) - 0.5) * 8);
  return (
    <motion.div className={`story-slide tone-${s.tone}`} style={{ opacity, visibility }} aria-hidden>
      <div className="story-copy">
        <Staged ph={ph} k={0} as="span" className="story-num">{String(i + 1).padStart(2, '0')}<small>/{String(N).padStart(2, '0')}</small></Staged>
        <Staged ph={ph} k={1} as="span" className="story-kicker"><Icon size={16} aria-hidden /> {s.kicker}</Staged>
        <Headline text={s.headline} ph={ph} seed={i + 1} />
        <Staged ph={ph} k={5} as="p">{s.text}</Staged>
        <Staged ph={ph} k={6} as="ul" className="story-chips">{s.chips.map(c => <li key={c}>{c}</li>)}</Staged>
      </div>
      <div className="story-visual">
        <Orbit words={s.words} ph={ph} seed={i} />
        <motion.div className="story-card" style={{ scale, y, rotateY, rotateX, transformPerspective: 1100 }}><Visual /></motion.div>
      </div>
    </motion.div>
  );
});

function Pinned() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const p = useTransform(scrollYProgress, v => clamp(v) * N);
  const [i, setI] = useState(0);
  useMotionValueEvent(p, 'change', v => { const n = Math.min(N - 1, Math.floor(v)); setI(prev => (prev === n ? prev : n)); });
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
        <div className="wrap story-grid">{STORY.map((s, n) => <Slide key={s.id} s={s} i={n} p={p} />)}</div>
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
