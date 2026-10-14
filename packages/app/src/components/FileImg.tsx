import { useEffect, useState } from 'react';
import { getApi } from '../state/appRef';

const cache = new Map<string, string>();

/** An <img> that understands `ergo-file:<id>` attachment URLs. */
export function FileImg({ src, alt, className }: { src: string; alt?: string; className?: string }) {
  const api = getApi();
  const m = /^ergo-file:([0-9a-f-]{36})$/.exec(src);
  const [url, setUrl] = useState<string | null>(() => (m ? cache.get(m[1]) ?? null : src));
  useEffect(() => {
    if (!m) { setUrl(src); return; }
    const id = m[1];
    const hit = cache.get(id);
    if (hit) { setUrl(hit); return; }
    let live = true;
    void api?.getFile(id).then(f => {
      if (!f || !live) return;
      const u = `data:${f.mime};base64,${f.data}`;
      cache.set(id, u);
      setUrl(u);
    });
    return () => { live = false; };
  }, [src, api, m?.[1]]);
  if (!url) return <span className="chip">image…</span>;
  return <img src={url} alt={alt ?? ''} className={className} />;
}
