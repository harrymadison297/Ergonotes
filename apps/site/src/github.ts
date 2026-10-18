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

const RELEASE_CACHE = 'ergo-site-release';
export interface LatestRelease { tag: string; sizes: Record<string, number> }

/** The latest release's version and the size of each file, or null while unknown or when GitHub does not answer (the page then shows neither). */
export function useLatestRelease(): LatestRelease | null {
  const [rel, setRel] = useState<LatestRelease | null>(() => {
    try { const c = JSON.parse(sessionStorage.getItem(RELEASE_CACHE) ?? 'null') as { r: LatestRelease; t: number } | null; return c && Date.now() - c.t < 600_000 ? c.r : null; } catch { return null; }
  });
  useEffect(() => {
    if (rel) return;
    const ctl = new AbortController();
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { signal: ctl.signal, headers: { Accept: 'application/vnd.github+json' } })
      .then(r => (r.ok ? r.json() : null))
      .then((j: { tag_name?: string; assets?: { name: string; size: number }[] } | null) => {
        if (!j?.tag_name || !Array.isArray(j.assets)) return;
        const r: LatestRelease = { tag: j.tag_name.replace(/^v/, ''), sizes: Object.fromEntries(j.assets.map(a => [a.name, a.size])) };
        setRel(r);
        try { sessionStorage.setItem(RELEASE_CACHE, JSON.stringify({ r, t: Date.now() })); } catch { /* ignore */ }
      })
      .catch(() => { /* rate limited or offline */ });
    return () => ctl.abort();
  }, [rel]);
  return rel;
}

export const formatSize = (bytes: number | undefined): string => (bytes ? (bytes >= 1e8 ? `${Math.round(bytes / 1e6)} MB` : `${(bytes / 1e6).toFixed(1)} MB`) : '');
