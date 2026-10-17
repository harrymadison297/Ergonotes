// ADR 0004: one random master key, wrapped by an Argon2id key derived from the vault password.
import { argon2id } from 'hash-wasm';
import { dec, enc, fromB64, toB64 } from './util.ts';

export interface KdfParams { alg: 'argon2id'; salt: string; m: number; t: number; p: number }
/** ADR 0012: a vault with no password keeps its master key unwrapped, so opening it costs no key derivation. */
export interface NoKdf { alg: 'none' }
export interface VaultFile {
  version: 1;
  kdf: KdfParams | NoKdf;
  /** AES-256-GCM(iv|ct|tag) of the master key, base64; with `kdf.alg === 'none'` the master key itself, base64 */
  wrappedKey: string;
  /** bumps when the master key is rotated */
  epoch: number;
  created: number;
}

/** 64 MiB, 3 passes: about 0.25 s on a desktop (spike measurement). Raise later by re-wrapping. */
export const DEFAULT_KDF = { m: 65536, t: 3, p: 1 };
export const MIN_PASSWORD_LENGTH = 12;

export class WrongPasswordError extends Error {
  constructor() { super('Wrong password'); this.name = 'WrongPasswordError'; }
}

const subtle = () => globalThis.crypto.subtle;
const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function aesKey(raw: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return subtle().importKey('raw', raw as BufferSource, 'AES-GCM', false, usage);
}

export interface Argon2Job { password: Uint8Array; salt: Uint8Array; parallelism: number; iterations: number; memorySize: number }
export type Argon2Runner = (job: Argon2Job) => Promise<Uint8Array>;
const inline: Argon2Runner = job => argon2id({ ...job, hashLength: 32, outputType: 'binary' });
let runArgon2: Argon2Runner = inline;
/** The app runs Argon2 in a Web Worker so that the 64 MB, quarter-second derivation does not freeze the interface. */
export function setArgon2Runner(r: Argon2Runner | null): void { runArgon2 = r ?? inline; }
/** The default way of running Argon2 on this thread, for a worker to call. */
export const argon2Here: Argon2Runner = inline;

async function derive(password: string, k: KdfParams): Promise<Uint8Array> {
  return runArgon2({
    password: enc(password.normalize('NFKC')),
    salt: fromB64(k.salt),
    parallelism: k.p,
    iterations: k.t,
    memorySize: k.m,
  });
}

async function sealRaw(key: CryptoKey, plain: Uint8Array): Promise<Uint8Array> {
  const iv = rand(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

async function openRaw(key: CryptoKey, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.length < 12 + 16) throw new Error('Object too short');
  const iv = blob.subarray(0, 12);
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, blob.subarray(12) as BufferSource);
  return new Uint8Array(pt);
}

export function checkPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters (a passphrase works well).`;
  return null;
}

export async function createVaultFile(password: string, params = DEFAULT_KDF): Promise<{ file: VaultFile; masterKey: Uint8Array }> {
  const masterKey = rand(32);
  const file = await wrapMasterKey(password, masterKey, params, 1);
  return { file, masterKey };
}

/** A new vault with no password (ADR 0012): the master key is stored as it is. */
export function createPasswordlessVaultFile(masterKey: Uint8Array = rand(32), epoch = 1): { file: VaultFile; masterKey: Uint8Array } {
  return { file: { version: 1, kdf: { alg: 'none' }, wrappedKey: toB64(masterKey), epoch, created: Date.now() }, masterKey };
}

export const hasPassword = (file: VaultFile): boolean => file.kdf.alg !== 'none';

export async function wrapMasterKey(password: string, masterKey: Uint8Array, params = DEFAULT_KDF, epoch = 1): Promise<VaultFile> {
  const kdf: KdfParams = { alg: 'argon2id', salt: toB64(rand(16)), ...params };
  const kek = await aesKey(await derive(password, kdf), ['encrypt']);
  const wrapped = await sealRaw(kek, masterKey);
  return { version: 1, kdf, wrappedKey: toB64(wrapped), epoch, created: Date.now() };
}

/** `vault.json` comes from the Store, so its cost parameters are not trusted: bound them before running Argon2. */
function assertSaneKdf(k: KdfParams): void {
  const ok = k.alg === 'argon2id' && Number.isInteger(k.m) && k.m >= 8 && k.m <= 1_048_576
    && Number.isInteger(k.t) && k.t >= 1 && k.t <= 10 && Number.isInteger(k.p) && k.p >= 1 && k.p <= 16;
  if (!ok) throw new Error('This vault uses encryption settings this app does not accept.');
}

export async function unwrapMasterKey(password: string, file: VaultFile): Promise<Uint8Array> {
  if (file.kdf.alg === 'none') {
    const key = fromB64(file.wrappedKey);
    if (key.length !== 32) throw new Error('This vault file is damaged.');
    return key;
  }
  assertSaneKdf(file.kdf);
  const kek = await aesKey(await derive(password, file.kdf), ['decrypt']);
  try {
    return await openRaw(kek, fromB64(file.wrappedKey));
  } catch {
    throw new WrongPasswordError();
  }
}

/**
 * Per-object sealing with the master key. Every object gets a fresh random 96-bit IV under the
 * one key, which AES-GCM tolerates up to about 2^32 objects (NIST SP 800-38D); a vault is nowhere
 * near that, and key rotation (deferred, ADR 0004) is the answer if it ever were.
 */
export class Sealer {
  private key: Promise<CryptoKey>;
  constructor(masterKey: Uint8Array) { this.key = aesKey(masterKey, ['encrypt', 'decrypt']); }
  async seal(plain: Uint8Array): Promise<Uint8Array> { return sealRaw(await this.key, plain); }
  async open(blob: Uint8Array): Promise<Uint8Array> { return openRaw(await this.key, blob); }
  async sealJson(v: unknown): Promise<Uint8Array> { return this.seal(enc(JSON.stringify(v))); }
  async openJson<T>(blob: Uint8Array): Promise<T> { return JSON.parse(dec(await this.open(blob))) as T; }
}
