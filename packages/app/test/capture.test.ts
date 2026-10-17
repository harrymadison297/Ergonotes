// What every capture of sound shares: the format it asks the browser for and the level the meter shows.
import { describe, expect, it } from 'vitest';
import { peakLevel, pickAudioMime } from '../src/record/capture';

describe('the format of a capture', () => {
  it('takes the best one the browser can write', () => {
    expect(pickAudioMime(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickAudioMime(t => t === 'audio/webm' || t === 'audio/mp4')).toBe('audio/webm');
    expect(pickAudioMime(t => t === 'audio/mp4')).toBe('audio/mp4');
  });
  it('leaves the choice to the browser when it supports none of them', () => {
    expect(pickAudioMime(() => false)).toBeUndefined();
  });
});

describe('the level of a capture', () => {
  it('is zero for silence, which a time-domain buffer holds as 128', () => {
    expect(peakLevel(new Uint8Array(256).fill(128))).toBe(0);
  });
  it('follows the loudest sample, on either side of silence', () => {
    expect(peakLevel(Uint8Array.from([128, 128 + 16, 128 - 32, 128]))).toBe(0.5);
    expect(peakLevel(Uint8Array.from([128, 128 + 8]))).toBe(0.125);
  });
  it('stops at one however loud it gets', () => {
    expect(peakLevel(Uint8Array.from([0, 255]))).toBe(1);
  });
});
