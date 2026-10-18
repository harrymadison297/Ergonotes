import { useEffect, useState } from 'react';

export const REPO = 'harrymadison297/Ergonotes';
export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const DOWNLOAD = (file: string) => `${REPO_URL}/releases/latest/download/${file}`;
const CACHE = 'ergo-site-stars';

/** The number of stars, or null while unknown or when GitHub does not answer (the buttons then show no number). */
export function useStars(): number | null {
  const [stars, setStars] = useState<number | null>(() => {
    try { const c = JSON.parse(sessionStorage.getItem(CACHE) ?? 'null') as { n: number; t: number } | null; return c && Date.now() - c.t < 600_000 ? c.n : null; } catch { return null; }
  });
  useEffect(() => {
    if (stars !== null) return;
    const ctl = new AbortController();
    fetch(`https://api.github.com/repos/${REPO}`, { signal: ctl.signal, headers: { Accept: 'application/vnd.github+json' } })
      .then(r => (r.ok ? r.json() : null))
      .then((j: { stargazers_count?: number } | null) => {
        if (typeof j?.stargazers_count !== 'number') return;
        setStars(j.stargazers_count);
        try { sessionStorage.setItem(CACHE, JSON.stringify({ n: j.stargazers_count, t: Date.now() })); } catch { /* ignore */ }
      })
      .catch(() => { /* rate limited or offline: no number */ });
    return () => ctl.abort();
  }, [stars]);
  return stars;
}
