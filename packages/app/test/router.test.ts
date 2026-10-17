// The addresses of the app: a Habit has a page of its own, `#/habits/<id>`.
import { describe, expect, it } from 'vitest';
import { habitHref, href, parseHash } from '../src/state/router';
import { tabFor } from '../src/state/tabs';

describe('the address of a habit', () => {
  it('is written and read back', () => {
    expect(href({ name: 'habits' })).toBe('#/habits');
    expect(habitHref('abc-1')).toBe('#/habits/abc-1');
    expect(parseHash('#/habits')).toEqual({ name: 'habits', habit: undefined });
    expect(parseHash('#/habits/abc-1')).toEqual({ name: 'habits', habit: 'abc-1' });
  });
  it('is not a tab', () => {
    expect(tabFor(parseHash('#/habits/abc-1'))).toBeNull();
  });
});
