import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform, type HTMLMotionProps } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';

/** Fades and lifts its children in the first time they scroll into view. */
export function Reveal({ children, delay = 0, y = 28, ...rest }: { children: ReactNode; delay?: number; y?: number } & Omit<HTMLMotionProps<'div'>, 'children'>) {
  const reduce = useReducedMotion();
  return (
    <motion.div {...rest} initial={reduce ? false : { opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '0px 0px -80px 0px' }} transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}

/** A number that counts up when it scrolls into view. */
export function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const v = useMotionValue(reduce ? to : 0);
  const text = useTransform(v, n => `${Math.round(n)}${suffix}`);
  useEffect(() => {
    if (!inView || reduce) return;
    const c = animate(v, to, { duration: 1.6, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [inView, reduce, to, v]);
  return <motion.b ref={ref}>{text}</motion.b>;
}
