import { describe, expect, it } from 'vitest';
import {
  boundsOf, buildDiagram, checkScene, contactSheet, drawingBlock, drawingsIn, emptyScene, findLibraryItem, libraryItems, placeBeside, placeLibraryItem, replaceDrawing, searchLibraryIndex, summarize, wrap,
  type El, type Scene,
} from '../src/index.ts';

const scene = (elements: El[]): Scene => ({ ...emptyScene(), elements });
const ids = (els: El[]) => els.map(e => e.id);

describe('buildDiagram', () => {
  const spec = {
    nodes: [{ id: 'ui', label: 'Editor', color: 'blue' }, { id: 'store', label: 'Scene store', color: 'green' }, { id: 'file', label: 'Markdown file', color: 'yellow' }],
    links: [{ from: 'ui', to: 'store', label: 'edit' }, { from: 'store', to: 'file' }],
  };

  it('writes a scene that is whole: bound text, two-way arrow bindings, unique ids, nothing missing', () => {
    const { elements, warnings } = buildDiagram(spec, { seed: 1 });
    expect(warnings).toEqual([]);
    expect(checkScene(scene(elements))).toEqual([]);
    expect(new Set(ids(elements)).size).toBe(elements.length);
    const ui = elements.find(e => e.id === 'ui')!;
    const arrow = elements.find(e => e.id === 'link_1_ui_store')!;
    expect(ui.boundElements).toEqual(expect.arrayContaining([{ type: 'text', id: 'ui_t' }, { type: 'arrow', id: arrow.id }]));
    expect(arrow.startBinding).toMatchObject({ elementId: 'ui' });
    expect(arrow.endBinding).toMatchObject({ elementId: 'store' });
    expect(arrow.points[0]).toEqual([0, 0]);
    const text = elements.find(e => e.id === 'ui_t')!;
    expect(text).toMatchObject({ containerId: 'ui', textAlign: 'center', verticalAlign: 'middle', text: 'Editor' });
    expect(text.x).toBeGreaterThan(ui.x); expect(text.x + text.width).toBeLessThan(ui.x + ui.width);
    // the label of a link is text bound to the arrow
    expect(elements.find(e => e.id === `${arrow.id}_t`)).toMatchObject({ containerId: arrow.id, text: 'edit' });
    // every field a loader needs is there
    for (const e of elements) for (const k of ['id', 'type', 'x', 'y', 'width', 'height', 'seed', 'version', 'versionNonce', 'isDeleted', 'groupIds', 'strokeColor', 'backgroundColor']) expect(e).toHaveProperty(k);
  });

  it('is deterministic for a seed, and lays a flow out left to right without overlap', () => {
    expect(buildDiagram(spec, { seed: 3 }).elements).toEqual(buildDiagram(spec, { seed: 3 }).elements);
    const { elements } = buildDiagram(spec, { seed: 1 });
    const [a, b, c] = ['ui', 'store', 'file'].map(i => elements.find(e => e.id === i)!);
    expect(a.x + a.width).toBeLessThan(b.x);
    expect(b.x + b.width).toBeLessThan(c.x);
    const top = buildDiagram({ ...spec, direction: 'TB' }, { seed: 1 }).elements;
    const [ta, tb] = ['ui', 'store'].map(i => top.find(e => e.id === i)!);
    expect(ta.y + ta.height).toBeLessThan(tb.y);
  });

  it('makes arrows touch the edges of their shapes, not their centres', () => {
    const { elements } = buildDiagram({ nodes: [{ id: 'a', label: 'A', x: 0, y: 0, w: 160, h: 80 }, { id: 'b', label: 'B', x: 400, y: 0, w: 160, h: 80 }], links: [{ from: 'a', to: 'b' }] });
    const arrow = elements.find(e => e.type === 'arrow')!;
    expect(arrow.x).toBeCloseTo(164, 0); // right edge of a plus the gap
    expect(arrow.x + arrow.points[1][0]).toBeCloseTo(396, 0); // left edge of b minus the gap
  });

  it('handles cycles, branching and unconnected nodes', () => {
    const cyc = buildDiagram({ nodes: ['a', 'b', 'c'].map(id => ({ id, label: id })), links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }] });
    expect(checkScene(scene(cyc.elements))).toEqual([]);
    expect(cyc.elements.find(e => e.id === 'link_3_c_a')!.points).toHaveLength(3); // the way back bends around b
    expect(cyc.warnings).toEqual([]);
    const fan = buildDiagram({ nodes: ['r', 'x', 'y', 'z'].map(id => ({ id, label: id })), links: [{ from: 'r', to: 'x' }, { from: 'r', to: 'y' }, { from: 'r', to: 'z' }] });
    expect(fan.warnings).toEqual([]);
    const lone = buildDiagram({ nodes: ['p', 'q', 'r', 's', 't'].map(id => ({ id, label: id })) });
    expect(lone.warnings).toEqual([]);
    expect(lone.elements.filter(e => e.type === 'rectangle')).toHaveLength(5);
  });

  it('keeps the way back of a loop off the arrow that goes forward', () => {
    const { elements, warnings } = buildDiagram({
      nodes: [{ id: 'build', label: 'Build' }, { id: 'test', label: 'Test' }],
      links: [{ from: 'build', to: 'test' }, { from: 'test', to: 'build', label: 'fail' }],
    });
    expect(warnings).toEqual([]);
    const [fwd, back] = elements.filter(e => e.type === 'arrow');
    expect(fwd.points).toHaveLength(2);
    expect(back.points).toHaveLength(3);
    // the bend lies well off the straight line between the shapes
    const build = elements.find(e => e.id === 'build')!;
    expect(Math.abs(back.y + back.points[1][1] - (build.y + build.height / 2))).toBeGreaterThan(50);
    expect(checkScene(scene(elements))).toEqual([]);
  });

  it('draws zones behind the nodes, with their label', () => {
    const { elements, warnings } = buildDiagram({
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
      links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
      zones: [{ id: 'z', label: 'Backend', nodes: ['b', 'c'], color: 'violet' }],
    });
    expect(warnings).toEqual([]);
    const z = elements.find(e => e.id === 'zone_z')!;
    expect(elements.indexOf(z)).toBe(0);
    for (const n of ['b', 'c']) { const e = elements.find(x => x.id === n)!; expect(e.x).toBeGreaterThan(z.x); expect(e.x + e.width).toBeLessThan(z.x + z.width); expect(e.y).toBeGreaterThan(z.y); }
    expect(elements.find(e => e.id === 'zone_z_t')).toMatchObject({ containerId: 'zone_z', text: 'Backend', verticalAlign: 'top' });
    expect(elements.find(e => e.id === 'a')!.x + elements.find(e => e.id === 'a')!.width).toBeLessThan(z.x);
  });

  it('says what is wrong instead of drawing it: bad ids, crossing arrows, short arrows, overlaps', () => {
    expect(() => buildDiagram({ nodes: [] })).toThrow('at least one node');
    expect(() => buildDiagram({ nodes: [{ id: 'a' }, { id: 'a' }] })).toThrow('id "a"');
    expect(() => buildDiagram({ nodes: [{ id: 'a' }], links: [{ from: 'a', to: 'zzz' }] })).toThrow('"zzz"');
    expect(() => buildDiagram({ nodes: [{ id: 'a' }], zones: [{ id: 'z', nodes: ['nope'] }] })).toThrow('"nope"');
    // a shape in the way makes the arrow bend; boxed in on every side it can only warn
    const around = buildDiagram({ nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'mid', x: 250, y: 0 }, { id: 'b', x: 600, y: 0 }], links: [{ from: 'a', to: 'b' }] });
    expect(around.warnings).toEqual([]);
    expect(around.elements.find(e => e.type === 'arrow')!.points).toHaveLength(3);
    const crowd = buildDiagram({ nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 20, y: 10 }] });
    expect(crowd.warnings.join(' ')).toContain('overlap');
    const short = buildDiagram({ nodes: [{ id: 'a', x: 0, y: 0, w: 120, h: 60 }, { id: 'b', x: 160, y: 0, w: 120, h: 60 }], links: [{ from: 'a', to: 'b', label: 'a long label here' }] });
    expect(short.warnings.join(' ')).toContain('too short');
    const self = buildDiagram({ nodes: [{ id: 'a' }, { id: 'b' }], links: [{ from: 'a', to: 'a' }] });
    expect(self.warnings.join(' ')).toContain('itself');
  });

  it('sizes shapes to their text, in any language, and wraps long labels', () => {
    expect(wrap('one two three four five six seven eight nine ten eleven', 20).split('\n').every(l => l.length <= 20)).toBe(true);
    const { elements } = buildDiagram({ nodes: [{ id: 'v', label: 'Quản lý ghi chú và thẻ' }, { id: 'j', label: '会議の議事録を作成する' }, { id: 'd', label: 'Sync?', shape: 'diamond' }, { id: 'e', label: 'Done', shape: 'ellipse' }, { id: 't', label: 'free text', shape: 'text' }] });
    for (const id of ['v', 'j', 'd', 'e']) {
      const s = elements.find(e => e.id === id)!, t = elements.find(e => e.id === `${id}_t`)!;
      expect(t.width).toBeLessThanOrEqual(s.width - 10 + 0.01);
      expect(t.height).toBeLessThanOrEqual(s.height);
    }
    expect(elements.find(e => e.id === 't')).toMatchObject({ type: 'text', containerId: null });
  });

  it('gives a title above the diagram and keeps nodes placed by hand where they were put', () => {
    const { elements, bounds } = buildDiagram({ title: 'Architecture', nodes: [{ id: 'a', label: 'A', x: 100, y: 200 }, { id: 'b', label: 'B' }], links: [{ from: 'a', to: 'b' }] });
    expect(elements.find(e => e.id === 'a')).toMatchObject({ x: 100, y: 200 });
    const title = elements.find(e => e.id === 'title')!;
    expect(title.y).toBeLessThan(200);
    expect(bounds.y).toBeCloseTo(title.y, 0);
    // a node left to the layout does not land on the one placed by hand
    const a = elements.find(e => e.id === 'a')!, b = elements.find(e => e.id === 'b')!;
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
  });
});

describe('drawing blocks of a note', () => {
  it('finds, replaces and reads them', () => {
    const one = scene(buildDiagram({ nodes: [{ id: 'a', label: 'A' }] }).elements);
    const two = scene(buildDiagram({ nodes: [{ id: 'b', label: 'B' }] }).elements);
    const body = `# T\n\n${drawingBlock(one)}\n\ntext\n\n${drawingBlock(two)}\n\nend`;
    const found = drawingsIn(body);
    expect(found.map(d => d.n)).toEqual([1, 2]);
    expect(found[1].scene!.elements.some(e => e.id === 'b')).toBe(true);
    const swapped = replaceDrawing(body, 1, scene(buildDiagram({ nodes: [{ id: 'z', label: 'Z' }] }).elements));
    expect(drawingsIn(swapped)[0].scene!.elements.some(e => e.id === 'z')).toBe(true);
    expect(drawingsIn(swapped)[1].scene).toEqual(found[1].scene);
    expect(swapped.startsWith('# T')).toBe(true);
    expect(() => replaceDrawing(body, 3, one)).toThrow('2 drawing(s)');
    expect(drawingsIn('```ergonote-excalidraw\n{broken\n```')[0].scene).toBeNull();
    expect(drawingBlock(one).split('\n')).toHaveLength(3); // fence, one line of JSON, fence
  });

  it('summarises a drawing so an agent can read it', () => {
    const s = summarize(scene(buildDiagram({ nodes: [{ id: 'a', label: 'Client' }, { id: 'b', label: 'Server' }], links: [{ from: 'a', to: 'b', label: 'HTTP' }], title: 'Flow' }).elements));
    expect(s.shapes.map(x => x.label)).toEqual(['Client', 'Server']);
    expect(s.arrows).toEqual([expect.objectContaining({ from: 'Client', to: 'Server', label: 'HTTP' })]);
    expect(s.texts.map(t => t.text)).toEqual(['Flow']);
  });

  it('puts new elements beside the old ones', () => {
    const old = buildDiagram({ nodes: [{ id: 'a', x: 0, y: 0 }] }).elements;
    const added = buildDiagram({ nodes: [{ id: 'b', x: 0, y: 0 }] }).elements;
    const right = placeBeside(old, added, 'right');
    expect(right.find(e => e.id === 'b')!.x).toBeGreaterThan(boundsOf(old)!.x + boundsOf(old)!.w);
    const below = placeBeside(old, added, 'below');
    expect(below.find(e => e.id === 'b')!.y).toBeGreaterThan(boundsOf(old)!.y + boundsOf(old)!.h);
  });
});

describe('Excalidraw libraries', () => {
  // a grouped cylinder with a label, and an arrow bound to a rectangle that is not part of the item
  const item: El[] = [
    { id: 'r', type: 'rectangle', x: 500, y: 300, width: 100, height: 60, groupIds: ['g1'], boundElements: [{ type: 'text', id: 't' }, { type: 'arrow', id: 'ar' }, { type: 'arrow', id: 'outside' }], frameId: null },
    { id: 't', type: 'text', x: 505, y: 320, width: 90, height: 20, fontSize: 20, text: 'DB', containerId: 'r', groupIds: ['g1'] },
    { id: 'ar', type: 'arrow', x: 600, y: 330, width: 50, height: 0, points: [[0, 0], [50, 0]], groupIds: ['g1'], startBinding: { elementId: 'r', focus: 0, gap: 2 }, endBinding: { elementId: 'gone', focus: 0, gap: 2 } },
    { id: 'old', type: 'rectangle', x: 0, y: 0, width: 1, height: 1, isDeleted: true },
  ];

  it('places an item with new ids and its own links intact', () => {
    const placed = placeLibraryItem(item, 10, 20, 1, 5);
    expect(placed).toHaveLength(3);
    expect(placed.some(e => item.some(o => o.id === e.id))).toBe(false);
    expect(new Set(ids(placed)).size).toBe(3);
    const [r, t, ar] = placed;
    expect(boundsOf(placed)).toMatchObject({ x: 10, y: 20 });
    expect(t.containerId).toBe(r.id);
    expect(r.boundElements.map((b: El) => b.id)).toEqual([t.id, ar.id]); // the arrow that left the item is dropped
    expect(ar.startBinding.elementId).toBe(r.id);
    expect(ar.endBinding).toBeNull();
    expect(r.groupIds[0]).toBe(t.groupIds[0]);
    expect(r.groupIds[0]).not.toBe('g1');
    expect(item[0].id).toBe('r'); // the source is not changed
    expect(checkScene(scene(placed))).toEqual([]);
  });

  it('scales everything together', () => {
    const half = placeLibraryItem(item, 0, 0, 0.5, 5);
    expect(half[0]).toMatchObject({ width: 50, height: 30 });
    expect(half[1].fontSize).toBe(10);
    expect(half[2].points[1]).toEqual([25, 0]);
  });

  it('lays items out on a numbered sheet so they can be looked at and chosen', () => {
    const sheet = contactSheet([item, item, item], 4, 2);
    expect(sheet.filter(e => e.type === 'text' && /^sheet_n/.test(e.id)).map(e => e.text)).toEqual(['5', '6', '7']);
    expect(new Set(ids(sheet)).size).toBe(sheet.length);
    const b = boundsOf(sheet)!;
    expect(b.w).toBeLessThanOrEqual(2 * 220); expect(b.h).toBeLessThanOrEqual(2 * 220);
  });

  it('searches the index, reads both file versions and finds an item by name', () => {
    const index = [
      { name: 'AWS Architecture Icons', description: 'Cloud icons', source: 'a/aws.excalidrawlib', itemNames: ['S3', 'Lambda'] },
      { name: 'UML', description: 'class and sequence', source: 'b/uml.excalidrawlib' },
      { name: 'Aws extra', description: 'more', source: 'c/x.excalidrawlib' },
    ];
    expect(searchLibraryIndex(index, 'aws').map(l => l.source)).toEqual(['a/aws.excalidrawlib', 'c/x.excalidrawlib']);
    expect(searchLibraryIndex(index, 'lambda aws').map(l => l.source)).toEqual(['a/aws.excalidrawlib']);
    expect(searchLibraryIndex(index, '  ')).toEqual([]);
    const v2 = libraryItems({ type: 'excalidrawlib', version: 2, libraryItems: [{ id: '1', name: 'Topic Simple', elements: item }, { id: '2', name: 'Topic Wide', elements: item }] });
    const v1 = libraryItems({ type: 'excalidrawlib', version: 1, library: [item, item] });
    expect(v2).toHaveLength(2); expect(v1).toHaveLength(2);
    expect(findLibraryItem(v2, 'topic simple')).toMatchObject({ id: '1' });
    expect(findLibraryItem(v2, 'topic')).toEqual({ choices: ['1. Topic Simple', '2. Topic Wide'] });
    expect(findLibraryItem(v2, '2')).toMatchObject({ id: '2' });
    expect(findLibraryItem(v1, '2')).toMatchObject({ id: 'v1-1' });
    expect(findLibraryItem(v1, 'x')).toEqual({ choices: ['1. (no name)', '2. (no name)'] });
    expect(() => libraryItems({ type: 'excalidraw' })).toThrow('not an Excalidraw library');
  });
});
