// The Markdown a person types for a link: what counts as a whole link, and what an address is made of.
import { describe, expect, it } from 'vitest';
import { cleanHref, isTableRule, linkMarkdown, parseMarkdownLink, tableCells } from '../src/editor/markdownInput.ts';

describe('a Markdown link written by hand', () => {
  it('reads text and address', () => {
    expect(parseMarkdownLink('[Anthropic](https://anthropic.com)')).toEqual({ label: 'Anthropic', href: 'https://anthropic.com' });
  });
  it('keeps a title', () => {
    expect(parseMarkdownLink('[x](https://a.b "hello there")')).toEqual({ label: 'x', href: 'https://a.b', title: 'hello there' });
  });
  it('is not a link until it has text and an address', () => {
    expect(parseMarkdownLink('[text]()')).toBeNull();
    expect(parseMarkdownLink('[](https://a.b)')).toBeNull();
    expect(parseMarkdownLink('[ ](https://a.b)')).toBeNull();
  });
  it('is not a link when it is only part of the line', () => {
    expect(parseMarkdownLink('see [a](b)')).toBeNull();
    expect(parseMarkdownLink('[a](b) and more')).toBeNull();
    expect(parseMarkdownLink('[a](b c)')).toBeNull();
  });
  it('reads the path of a note of the vault as it is written', () => {
    expect(parseMarkdownLink('[Plan](Projects/Plan.md)')?.href).toBe('Projects/Plan.md');
    expect(parseMarkdownLink('[top](#top)')?.href).toBe('#top');
  });
  it('turns a bare www address into a web address and leaves the rest alone', () => {
    expect(cleanHref('www.example.com')).toBe('https://www.example.com');
    expect(cleanHref('https://example.com')).toBe('https://example.com');
    expect(cleanHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(cleanHref('Plan.md')).toBe('Plan.md');
  });
  it('shows a link as the Markdown that spells it, and reads that back as the same link', () => {
    const md = linkMarkdown('Back', 'https://back.io', 'home');
    expect(md).toBe('[Back](https://back.io "home")');
    expect(parseMarkdownLink(md)).toEqual({ label: 'Back', href: 'https://back.io', title: 'home' });
    expect(linkMarkdown('a [b]', 'x')).toBe('[a  b ](x)');
  });
});

describe('a table written by hand', () => {
  it('reads the cells of a header line', () => {
    expect(tableCells('| a | b |')).toEqual(['a', 'b']);
    expect(tableCells('a | b | c')).toEqual(['a', 'b', 'c']);
    expect(tableCells('just words')).toBeNull();
    expect(tableCells('|  |')).toBeNull();
  });
  it('knows the line under the header', () => {
    expect(isTableRule('|---|---|')).toBe(true);
    expect(isTableRule('| :--- | ---: |')).toBe(true);
    expect(isTableRule('---|---')).toBe(true);
    expect(isTableRule('---')).toBe(true); // one column; a lone "---" is a divider, which the table rule only takes after a header line
    expect(isTableRule('| a | b |')).toBe(false);
    expect(isTableRule('|--|')).toBe(false);
  });
});
