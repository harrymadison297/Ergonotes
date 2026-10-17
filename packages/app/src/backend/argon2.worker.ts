// Runs the key derivation off the interface thread (ADR 0012 keeps it for vaults that have a password).
import { argon2Here, type Argon2Job } from '@ergonotes/core';

self.onmessage = async (e: MessageEvent<{ id: number; job: Argon2Job }>) => {
  const { id, job } = e.data;
  try {
    const out = await argon2Here(job);
    (self as unknown as Worker).postMessage({ id, out }, [out.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
