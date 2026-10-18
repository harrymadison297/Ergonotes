// A question the person answers with Cancel or OK, drawn by the app. The browser's own `confirm` cannot be used: the desktop and
// Android shells replace it with an asynchronous one that returns a Promise (always truthy) and, without permission for the
// dialog plugin, fails; a destructive action would then go ahead without having asked.
import { useEffect, useState } from 'react';
import { Dialog } from '../components/ui';

export interface ConfirmOptions { ok?: string; cancel?: string; title?: string; /** the action cannot be undone: Cancel has the focus */ danger?: boolean }
interface Ask extends ConfirmOptions { message: string; done: (yes: boolean) => void }

let show: ((a: Ask) => void) | null = null;

/** Ask a question; resolves true on OK and false on Cancel, Esc or a click outside. */
export function askConfirm(message: string, o: ConfirmOptions = {}): Promise<boolean> {
  return new Promise(resolve => {
    if (show) show({ message, ...o, done: resolve });
    else resolve(false); // no host on screen (a test, a screen before the app): never go ahead unasked
  });
}

/** Mount once, near the root. */
export function ConfirmHost() {
  const [queue, setQueue] = useState<Ask[]>([]);
  useEffect(() => {
    show = a => setQueue(q => [...q, a]);
    return () => { show = null; };
  }, []);
  const cur = queue[0];
  if (!cur) return null;
  const answer = (yes: boolean) => { cur.done(yes); setQueue(q => q.slice(1)); };
  return (
    <Dialog title={cur.title ?? (cur.danger ? 'Are you sure?' : 'Please confirm')} onClose={() => answer(false)}
      footer={<>
        <button className="btn" onClick={() => answer(false)}>{cur.cancel ?? 'Cancel'}</button>
        <button className={cur.danger ? 'btn danger' : 'btn primary'} onClick={() => answer(true)}>{cur.ok ?? 'OK'}</button>
      </>}>
      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{cur.message}</p>
    </Dialog>
  );
}
