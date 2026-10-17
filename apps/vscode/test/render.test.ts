import { describe, expect, it } from 'vitest';
import { renderNote, type RenderEnv } from '../src/render.ts';

const env: RenderEnv = {
  resolveFile: s => `vscode-resource:/${s}`,
  habitChip: href => (href === 'Habits/Run.md' ? { text: '5-day streak · met today', met: true } : null),
};
const html = (md: string) => renderNote(md, env);

describe('the preview of a note', () => {
  it('draws tasks as boxes, done or not', () => {
    const h = html('- [ ] open\n- [x] finished');
    expect(h).toContain('<li class="task"><input type="checkbox" disabled> open');
    expect(h).toContain('<li class="task done"><input type="checkbox" disabled checked> finished');
  });

  it('turns the tokens of Ergonotes into chips, and leaves them alone inside code', () => {
    const h = html('- [ ] call @due(2026-10-20T09:00) @flag\n\nMeet @event(2026-10-21) and `@due(x)`');
    expect(h).toContain('<span class="chip chip-due">Due 2026-10-20 09:00</span>');
    expect(h).toContain('chip-flag');
    expect(h).toContain('<span class="chip chip-event">Event 2026-10-21</span>');
    expect(h).toContain('<code>@due(x)</code>');
  });

  it('shows a check-in line of a habit', () => {
    expect(html('- [x] @done(2026-10-17T07:42) ran')).toContain('chip-done">Done 2026-10-17 07:42');
  });

  it('keeps a link to a note as something to open, and says where a habit stands', () => {
    const h = html('[Plan](Projects/Plan.md) and [Run](Habits/Run.md) and [site](https://example.com)');
    expect(h).toContain('<a href="#" data-open="Projects/Plan.md">Plan</a>');
    expect(h).toMatch(/<a href="#" data-open="Habits\/Run.md" class="habit-chip met" data-habit="5-day streak · met today">Run<\/a>/);
    expect(h).toContain('data-external="1"');
  });

  it('reads [[wiki links]] and [[Title|label]]', () => {
    const h = html('See [[Quarterly report]] and [[Folder/Note|that one]].');
    expect(h).toContain('data-wiki="Quarterly report">Quarterly report</a>');
    expect(h).toContain('data-wiki="Folder/Note">that one</a>');
  });

  it('loads pictures from beside the note, and leaves web ones alone', () => {
    const h = html('![a](attachments/my%20pic.png) ![b](https://example.com/b.png)');
    expect(h).toContain('src="vscode-resource:/attachments/my pic.png"');
    expect(h).toContain('src="https://example.com/b.png"');
  });

  it('keeps a toggle and a page break and nothing else of raw HTML', () => {
    const h = html('<details>\n<summary>More</summary>\n\nInside\n\n</details>\n\n<div style="page-break-after: always;"></div>\n\n<script>alert(1)</script>\n\nText <b onclick="x()">bold</b>');
    expect(h).toContain('<details>');
    expect(h).toContain('<summary>More</summary>');
    expect(h).toContain('<div class="page-break">Page break</div>');
    expect(h).not.toContain('<script>');
    expect(h).not.toContain('<b onclick');
    expect(h).toContain('&lt;script&gt;');
  });

  it('shows the fences only the app can draw as what they are', () => {
    expect(html('```ergonote-excalidraw\n{"a":1}\n```')).toContain('open this note in Ergonotes');
    expect(html('```mermaid\ngraph TD\nA-->B\n```')).toContain('Diagram (Mermaid)');
    expect(html('```ts\nconst a = 1;\n```')).toContain('<code class="language-ts">const a = 1;');
  });

  it('writes formulas as MathML', () => {
    expect(html('$$\nE = mc^2\n$$')).toMatch(/<div class="math"><span class="katex"><math/);
    expect(html('so $x^2$ here')).toContain('<math');
    expect(html('It costs $5 and $6.')).not.toContain('<math');
  });

  it('shows the properties of the frontmatter above the note, but not its identity', () => {
    const h = html('---\nid: 1234\ntags: [work, q4]\nhabit: true\n---\nBody');
    expect(h).toContain('class="tag">work</span>');
    expect(h).toContain('<b>habit</b> true');
    expect(h).not.toContain('1234');
  });

  it('does not run a script written into a link or a picture', () => {
    const h = html('[x](javascript:alert(1)) ![y](data:text/html;base64,AAAA)');
    expect(h).not.toContain('href="javascript:');
  });
});
