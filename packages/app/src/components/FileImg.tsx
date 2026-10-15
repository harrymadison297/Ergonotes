import { useEffect, useState } from 'react';
import { getApi } from '../state/appRef';
import { vaultPathsOf } from '../state/noteCtx';

const cache = new Map<string, string>();
const WEB = /^(?:https?:|data:|blob:)/i;

/** An <img> for what a note embeds: a file of the vault (`attachments/x.png`, as written in the note) or a web address. */
export function FileImg({ src, alt, className }: { src: string; alt?: string; className?: string }) {
  const api = getApi();
  const legacy = /^ergo-file:([0-9a-f-]{36})$/.exec(src)?.[1];
  const direct = WEB.test(src);
  const key = legacy ? `id:${legacy}` : `p:${src}`;
  const [url, setUrl] = useState<string | null>(() => (direct ? src : cache.get(key) ?? null));
  useEffect(() => {
    if (direct) { setUrl(src); return; }
    const hit = cache.get(key);
    if (hit) { setUrl(hit); return; }
    let live = true;
    void (async () => {
      let f = null;
      if (legacy) f = await api?.getFile(legacy);
      else for (const p of vaultPathsOf(src)) { f = await api?.getFileByPath(p) ?? null; if (f) break; }
      if (!f || !live) return;
      const u = `data:${f.mime};base64,${f.data}`;
      cache.set(key, u);
      setUrl(u);
    })();
    return () => { live = false; };
  }, [src, api, key, direct, legacy]);
  if (!url) return <span className="chip">image…</span>;
  return <img src={url} alt={alt ?? ''} className={className} />;
}
