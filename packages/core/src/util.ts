import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

export const sha256hex = (s: string): string => bytesToHex(sha256(utf8ToBytes(s)));
export const newId = (): string => globalThis.crypto.randomUUID();
export const pad = (n: number): string => String(Math.max(0, Math.round(n))).padStart(15, '0');

const te = new TextEncoder();
const td = new TextDecoder();
export const enc = (s: string): Uint8Array => te.encode(s);
export const dec = (b: Uint8Array): string => td.decode(b);

export function toB64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const MIN = 60_000;

export function sortedUnique(a: string[]): string[] {
  return [...new Set(a)].sort();
}

/** Deterministic JSON equality for plain data. */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
