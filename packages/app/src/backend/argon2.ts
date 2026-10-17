import { setArgon2Runner, argon2Here, type Argon2Job } from '@ergonotes/core';

/** Route the core's Argon2 through a Web Worker; if a worker cannot be made the work is done on this thread as before. */
export function routeArgon2ToWorker(): void {
  if (typeof Worker === 'undefined') return;
  let worker: Worker | null = null;
  let seq = 0;
  const pending = new Map<number, { ok: (v: Uint8Array) => void; fail: (e: Error) => void }>();
  const make = () => {
    const w = new Worker(new URL('./argon2.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; out?: Uint8Array; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.out) p.ok(e.data.out); else p.fail(new Error(e.data.error ?? 'Key derivation failed'));
    };
    w.onerror = () => { worker = null; for (const p of pending.values()) p.fail(new Error('The key derivation worker stopped')); pending.clear(); };
    return w;
  };
  setArgon2Runner(async (job: Argon2Job) => {
    try {
      worker ??= make();
      const id = ++seq;
      const w = worker;
      return await new Promise<Uint8Array>((ok, fail) => { pending.set(id, { ok, fail }); w.postMessage({ id, job }); });
    } catch {
      return argon2Here(job);
    }
  });
}
