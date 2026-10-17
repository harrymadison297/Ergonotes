import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, AppOverride } from '../state/app';
import { NoteEditor } from './NoteEditor';
import { ApiKeeper } from '../state/apiKeeper';
import { SCRATCH_ID, bodyForNote, emptyDraft, loadDraft, mentioned, storeDraft, type Draft } from '../state/scratch';
import { scratchApi, scratchSummary } from '../state/scratchApi';
import type { ItemSummary } from '@ergonotes/core';

/**
 * The Scratchpad on Home: the note editor on a draft that is kept on this Device and is not a Note until it is sent (CONTEXT.md).
 * Pictures and files dropped on it are held with the draft and only reach `attachments/` of the Vault when it is sent.
 */
export function ScratchPad() {
  const app = useApp();
  const draft = useRef<Draft>(emptyDraft());
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    void loadDraft().then(d => { if (live) { draft.current = d; setReady(true); } });
    return () => {
      live = false;
      if (timer.current) { clearTimeout(timer.current); void storeDraft(draft.current); }
    };
  }, []);

  const persist = useMemo(() => () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void storeDraft(draft.current); }, 400);
  }, []);
  const api = useMemo(() => scratchApi(app.api, draft, persist), [app.api, persist]);
  const byId = useMemo(() => {
    const m = new Map<string, ItemSummary>();
    m.get = (k: string) => (k === SCRATCH_ID ? scratchSummary() : undefined);
    return m;
  }, []);
  const patch = useMemo(() => ({ api, byId }), [api, byId]);

  const send = async (body: string) => {
    setSending(true);
    try {
      const held = mentioned(body, draft.current.files);
      const vaultPaths: Record<string, string> = {};
      for (const p of held) {
        const f = draft.current.files[p];
        vaultPaths[p] = (await app.api.addFile({ name: f.name, mime: f.mime, data: f.data })).path;
      }
      const inbox = (app.settings.captureFolder ? app.byId.get(app.settings.captureFolder) : undefined) ?? app.items.find(i => i.role === 'inbox');
      const text = bodyForNote(body, vaultPaths, inbox?.filePath ?? 'Inbox');
      await app.api.capture({ text });
      draft.current = emptyDraft();
      await storeDraft(draft.current);
      await app.refresh();
      app.toast('Saved to Inbox');
    } catch (e) {
      app.toast(`Could not send: ${e instanceof Error ? e.message : String(e)}`, 'error');
      throw e;
    } finally { setSending(false); }
  };

  if (!ready) return <div className="scratch-box" aria-busy="true" />;
  return (
    <div className="scratch-box">
      <AppOverride patch={patch}>
        <ApiKeeper api={api} restore={app.api} />
        <NoteEditor id={SCRATCH_ID} scratch={{ send, sending }} />
      </AppOverride>
    </div>
  );
}
