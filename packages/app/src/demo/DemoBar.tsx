import { RotateCcw, Star } from 'lucide-react';

export const REPO_URL = 'https://github.com/harrymadison297/Ergonotes';

/** Clear what this browser remembers about the demo and start it again from Harry's vault. */
function reset() {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('ergo.')) localStorage.removeItem(k); } catch { /* private window */ }
  location.reload();
}

/** The demo's own small bar, over the app: what this is, a way back to the start, and a way to star the project. */
export function DemoBar() {
  return (
    <div className="demo-bar" role="region" aria-label="About this demo">
      <span className="demo-bar-text"><b>Demo</b><span className="demo-bar-long"> · made-up notes, kept in this tab</span></span>
      <button className="demo-bar-btn" onClick={reset} title="Forget your changes and start again"><RotateCcw size={14} aria-hidden /> Reset</button>
      <a className="demo-bar-btn demo-bar-star" href={REPO_URL} target="_blank" rel="noreferrer"><Star size={14} aria-hidden /> Star on GitHub</a>
    </div>
  );
}

/** What a Settings page of the installed apps says in the demo. */
export function DemoNotice({ what }: { what: string }) {
  return (
    <div className="demo-notice" style={{ maxWidth: 520 }}>
      <h3 style={{ marginTop: 0 }}>{what}</h3>
      <p>This part of Settings is in the installed apps, where your notes are files in a folder on your device. Nothing here can be changed in the demo.</p>
      <a className="btn" href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">Get the app</a>
    </div>
  );
}
