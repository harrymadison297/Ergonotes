// ADR 0004: one random master key, wrapped by an Argon2id key derived from the vault password.
import { argon2id } from 'hash-wasm';
import { dec, enc, fromB64, toB64 } from './util.ts';

export interface KdfParams { alg: 'argon2id'; salt: string; m: number; t: number; p: number }
export interface VaultFile {
  version: 1;
  kdf: KdfParams;
  /** AES-256-GCM(iv|ct|tag) of the master key, base64 */
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

async function derive(password: string, k: KdfParams): Promise<Uint8Array> {
  return argon2id({
    password: enc(password.normalize('NFKC')),
    salt: fromB64(k.salt),
    parallelism: k.p,
    iterations: k.t,
    memorySize: k.m,
    hashLength: 32,
    outputType: 'binary',
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

export async function wrapMasterKey(password: string, masterKey: Uint8Array, params = DEFAULT_KDF, epoch = 1): Promise<VaultFile> {
  const kdf: KdfParams = { alg: 'argon2id', salt: toB64(rand(16)), ...params };
  const kek = await aesKey(await derive(password, kdf), ['encrypt']);
  const wrapped = await sealRaw(kek, masterKey);
  return { version: 1, kdf, wrappedKey: toB64(wrapped), epoch, created: Date.now() };
}

export async function unwrapMasterKey(password: string, file: VaultFile): Promise<Uint8Array> {
  const kek = await aesKey(await derive(password, file.kdf), ['decrypt']);
  try {
    return await openRaw(kek, fromB64(file.wrappedKey));
  } catch {
    throw new WrongPasswordError();
  }
}

/** Per-object sealing with the master key. */
export class Sealer {
  private key: Promise<CryptoKey>;
  constructor(masterKey: Uint8Array) { this.key = aesKey(masterKey, ['encrypt', 'decrypt']); }
  async seal(plain: Uint8Array): Promise<Uint8Array> { return sealRaw(await this.key, plain); }
  async open(blob: Uint8Array): Promise<Uint8Array> { return openRaw(await this.key, blob); }
  async sealJson(v: unknown): Promise<Uint8Array> { return this.seal(enc(JSON.stringify(v))); }
  async openJson<T>(blob: Uint8Array): Promise<T> { return JSON.parse(dec(await this.open(blob))) as T; }
}
