import { lazy, Suspense, useRef } from 'react';
import { Dialog } from './ui';
import '@excalidraw/excalidraw/index.css';

const Excalidraw = lazy(async () => {
  const m = await import('@excalidraw/excalidraw');
  return { default: m.Excalidraw };
});

type Scene = { elements: unknown[]; appState: Record<string, unknown>; files: Record<string, unknown> };

export function DrawingDialog({ initial, onSave, onClose }: { initial: string; onSave: (json: string) => void; onClose: () => void }) {
  const latest = useRef<Scene | null>(null);
  let parsed: Partial<Scene> = {};
  try { if (initial) parsed = JSON.parse(initial) as Partial<Scene>; } catch { /* start empty */ }
  const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
    (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const save = () => {
    const s = latest.current;
    if (!s) return onClose();
    const keep = ['viewBackgroundColor', 'gridSize'];
    const appState: Record<string, unknown> = {};
    for (const k of keep) if (k in s.appState) appState[k] = s.appState[k];
    const elements = (s.elements as { isDeleted?: boolean }[]).filter(e => !e.isDeleted);
    onSave(JSON.stringify({ type: 'excalidraw', version: 2, elements, appState, files: s.files }));
  };

  return (
    <div className="scrim" style={{ padding: 0 }}>
      <div className="dialog wide" style={{ width: '100vw', height: '100dvh', maxHeight: 'none', borderRadius: 0 }} role="dialog" aria-modal="true" aria-label="Drawing">
        <header>
          <h2>Drawing</h2>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Done</button>
        </header>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Suspense fallback={<div className="empty">Loading the drawing board…</div>}>
            <Excalidraw
              initialData={{ elements: (parsed.elements ?? []) as never, appState: { ...(parsed.appState ?? {}), collaborators: new Map() } as never, files: (parsed.files ?? {}) as never }}
              theme={dark ? 'dark' : 'light'}
              onChange={(elements, appState, files) => { latest.current = { elements: elements as unknown[], appState: appState as unknown as Record<string, unknown>, files: files as unknown as Record<string, unknown> }; }}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
void Dialog;
