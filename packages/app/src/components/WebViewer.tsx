import { useState } from 'react';
import { Copy, ExternalLink, Loader2, RotateCw } from 'lucide-react';
import { Dialog, IconBtn } from './ui';
import { useApp } from '../state/app';
import { isWebUrl, openInBrowser } from '../state/util';

/**
 * A web page or a PDF at a web address, shown inside the app, so a link in a note can be read without leaving it.
 * Pages that forbid being framed (many do) show the browser's own refusal; the button beside the address opens them in the browser.
 */
export function WebViewer({ url, onClose }: { url: string; onClose: () => void }) {
  const app = useApp();
  const [loading, setLoading] = useState(true);
  const [round, setRound] = useState(0);
  const ok = isWebUrl(url);
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })();
  const out = () => { void openInBrowser(url).catch(e => app.toast(`Could not open the browser: ${e instanceof Error ? e.message : String(e)}`, 'error')); };
  const copy = () => { void navigator.clipboard?.writeText(url).then(() => app.toast('Address copied'), () => app.toast('Could not copy the address', 'error')); };
  return (
    <Dialog title={host} wide onClose={onClose}>
      <div className="webview-bar">
        <span className="webview-url" title={url}>{url}</span>
        <IconBtn label="Reload" icon={<RotateCw size={16} />} onClick={() => { setLoading(true); setRound(r => r + 1); }} />
        <IconBtn label="Copy the address" icon={<Copy size={16} />} onClick={copy} />
        <button type="button" className="btn" onClick={out}><ExternalLink size={14} /> Open in browser</button>
      </div>
      {ok ? (
        <div className="webview-frame">
          {loading && <div className="webview-loading" aria-hidden><Loader2 className="spin" /></div>}
          <iframe key={round} title={host} src={url} referrerPolicy="no-referrer" onLoad={() => setLoading(false)}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-presentation" allow="fullscreen" />
        </div>
      ) : <p className="error-text" role="alert">This address cannot be shown here.</p>}
      <p className="hint webview-hint">If the page stays empty, the site does not allow being shown inside another app: use “Open in browser”.</p>
    </Dialog>
  );
}
