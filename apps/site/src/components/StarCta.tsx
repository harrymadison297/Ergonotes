import { motion, useReducedMotion } from 'motion/react';
import { Star } from 'lucide-react';
import { REPO_URL, useStars } from '../github';
import { Reveal } from './motion';

const SPARKS = [[8, 14, 22], [90, 20, 30], [16, 74, 18], [82, 70, 26], [50, 8, 16], [34, 88, 14], [66, 90, 18]] as const;

export function StarCta() {
  const stars = useStars();
  const reduce = useReducedMotion();
  return (
    <section className="section" style={{ paddingBottom: 0 }}>
      <div className="wrap">
        <Reveal>
          <div className="star-card">
            {SPARKS.map(([x, y, s], i) => <Star key={i} className="sparkle" size={s} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.5}s` }} aria-hidden />)}
            <h2>If Ergonotes helps you, a star helps others find it</h2>
            <p>It is made by one person, in the open, with no ads and no tracking. A star on GitHub is the nicest thank you, and it takes a second.</p>
            <motion.a className="btn" href={REPO_URL} target="_blank" rel="noreferrer" whileHover={reduce ? undefined : { scale: 1.05 }} whileTap={{ scale: 0.97 }}>
              <Star size={20} aria-hidden /> Star Ergonotes on GitHub{stars !== null && <span className="count">{stars}</span>}
            </motion.a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
