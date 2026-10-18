import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { FEATURES, STRIP, type Feature } from '../data';
import { CountUp, Reveal } from './motion';

function Card({ f, i }: { f: Feature; i: number }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rx = useSpring(useTransform(y, [-0.5, 0.5], [reduce ? 0 : 5, reduce ? 0 : -5]), { stiffness: 200, damping: 20 });
  const ry = useSpring(useTransform(x, [-0.5, 0.5], [reduce ? 0 : -6, reduce ? 0 : 6]), { stiffness: 200, damping: 20 });
  const Icon = f.icon;
  return (
    <motion.article
      className={`card tone-${f.tone}${f.size ? ' ' + f.size : ''}`}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      initial={reduce ? false : { opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '0px 0px -60px 0px' }} transition={{ duration: 0.6, delay: (i % 3) * 0.08, ease: [0.22, 1, 0.36, 1] }}
      onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); x.set((e.clientX - r.left) / r.width - 0.5); y.set((e.clientY - r.top) / r.height - 0.5); }}
      onPointerLeave={() => { x.set(0); y.set(0); }}
    >
      <span className="ico"><Icon aria-hidden /></span>
      <h3>{f.title}</h3>
      <p>{f.text}</p>
      {f.tag && <span className="tag">{f.tag}</span>}
    </motion.article>
  );
}

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
    <section className="section" id="features">
      <div className="wrap">
        <Reveal className="center" style={{ textAlign: 'center', display: 'grid', gap: 16, justifyItems: 'center' }}>
          <span className="eyebrow">What is in it</span>
          <h2 className="h2">Everything a notebook needs, nothing it does not</h2>
          <p className="lead">Quiet, dependable and tidy: a well-made paper notebook with a green ribbon, that happens to sync.</p>
        </Reveal>
        <div className="bento">{FEATURES.map((f, i) => <Card key={f.title} f={f} i={i} />)}</div>
        <Reveal className="stats">
          <div className="stat"><CountUp to={18} /><span>widgets for Home</span></div>
          <div className="stat"><CountUp to={5} /><span>platforms, one set of files</span></div>
          <div className="stat"><CountUp to={4} /><span>export formats</span></div>
          <div className="stat"><CountUp to={0} /><span>accounts to create</span></div>
        </Reveal>
      </div>
    </section>
  );
}
