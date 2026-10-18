import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import { ArrowRight, Download, FileText, Lock, Star, Wifi } from 'lucide-react';
import { useRef } from 'react';
import { REPO_URL, useStars } from '../github';
import { useTheme } from '../theme';

const IMG = (n: string) => `/img/${n}.webp`;

export function Hero() {
  const [theme] = useTheme();
  const stars = useStars();
  const reduce = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: stage, offset: ['start 90%', 'start 20%'] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [reduce ? 0 : 14, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0.92, 1]);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-1, 1], [reduce ? 0 : 3, reduce ? 0 : -3]), { stiffness: 120, damping: 18 });
  const ry = useSpring(useTransform(mx, [-1, 1], [reduce ? 0 : -4, reduce ? 0 : 4]), { stiffness: 120, damping: 18 });
  const phoneY = useTransform(scrollYProgress, [0, 1], [reduce ? 0 : 60, 0]);
  const onMove = (e: React.PointerEvent) => {
    const r = stage.current!.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
    my.set(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const rise = (i: number) => ({ initial: reduce ? false : { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.8, delay: 0.1 + i * 0.1, ease: [0.22, 1, 0.36, 1] as const } });
  return (
    <section className="section hero" id="top">
      <div className="aurora" aria-hidden><i className="blob a" /><i className="blob b" /><i className="blob c" /><i className="blob d" /></div>
      <div className="wrap">
        <div className="hero-copy">
          <motion.span className="eyebrow" {...rise(0)}><Lock size={14} aria-hidden /> Free, open source and offline first</motion.span>
          <motion.h1 {...rise(1)}>Your notes, on every device, <span className="gradient-text">readable by nobody else.</span></motion.h1>
          <motion.p className="lead" {...rise(2)}>A folder of Markdown files, a fast editor, habits, tasks and a Home you arrange. Synced end to end encrypted through storage you own. No account, no always-on server.</motion.p>
          <motion.div className="cta-row" {...rise(3)}>
            <a className="btn btn-primary" href="#demo">Try the live demo <ArrowRight size={18} aria-hidden /></a>
            <a className="btn" href="#download"><Download size={18} aria-hidden /> Download</a>
            <a className="btn btn-star" href={REPO_URL} target="_blank" rel="noreferrer"><Star size={18} aria-hidden /> Star on GitHub{stars !== null && <span className="count">{stars}</span>}</a>
          </motion.div>
          <motion.p className="hero-note" {...rise(4)}>Windows · Linux · Android · Web · VS Code</motion.p>
        </div>
        <div className="stage" ref={stage} onPointerMove={onMove} onPointerLeave={() => { mx.set(0); my.set(0); }}>
          <motion.div style={{ rotateX, scale, transformPerspective: 1600 }}>
            <motion.div className="frame" style={{ rotateX: rx, rotateY: ry }}>
              <div className="frame-bar"><i /><i /><i /><span>Ergonotes</span></div>
              <img src={IMG(theme === 'dark' ? 'home-dark' : 'home-light')} alt="Ergonotes Home: tasks due, habits today, upcoming events, notes, a scratch pad and charts" width="1440" height="900" fetchPriority="high" />
            </motion.div>
          </motion.div>
          <motion.div className="phone" style={{ y: phoneY }} aria-hidden><img src={IMG(theme === 'dark' ? 'phone-home-dark' : 'phone-home')} alt="" width="390" height="844" loading="lazy" /></motion.div>
          <motion.span className="chip" style={{ left: '-1%', top: '18%' }} animate={reduce ? undefined : { y: [0, -10, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}><FileText style={{ color: 'var(--green-ink)' }} aria-hidden /> Plain .md files</motion.span>
          <motion.span className="chip" style={{ right: '22%', top: '-4%' }} animate={reduce ? undefined : { y: [0, 10, 0] }} transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}><Lock style={{ color: 'var(--purple)' }} aria-hidden /> End-to-end encrypted</motion.span>
          <motion.span className="chip" style={{ left: '4%', bottom: '8%' }} animate={reduce ? undefined : { y: [0, -8, 0] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}><Wifi style={{ color: 'var(--indigo-ink)' }} aria-hidden /> Works offline</motion.span>
        </div>
      </div>
    </section>
  );
}
