// Drawing for agents. An agent describes a diagram as nodes and links (and, if it wants, zones); this file lays it out and writes
// the Excalidraw scene of a drawing block (`ergonote-excalidraw`) with every field set, the text bound to its shapes and the
// arrows bound to both ends, so the scene loads and edits like one a person drew. It needs no DOM and no fonts: text is sized
// by an estimate that errs on the roomy side. The same file places an item of an Excalidraw library into a scene.
// The app (packages/app/src/editor/drawingTools.ts) adds what needs a browser: restoring legacy fields, rendering a preview.

export type ColorName = 'red' | 'pink' | 'grape' | 'violet' | 'blue' | 'cyan' | 'teal' | 'green' | 'yellow' | 'orange' | 'gray';
/** Excalidraw's own open-color shades: a pastel fill and the darker stroke of the same hue. */
export const PALETTE: Record<ColorName, { fill: string; stroke: string }> = {
  red: { fill: '#ffc9c9', stroke: '#e03131' }, pink: { fill: '#fcc2d7', stroke: '#c2255c' }, grape: { fill: '#eebefa', stroke: '#9c36b5' },
  violet: { fill: '#d0bfff', stroke: '#6741d9' }, blue: { fill: '#a5d8ff', stroke: '#1971c2' }, cyan: { fill: '#99e9f2', stroke: '#0c8599' },
  teal: { fill: '#96f2d7', stroke: '#099268' }, green: { fill: '#b2f2bb', stroke: '#2f9e44' }, yellow: { fill: '#ffec99', stroke: '#f08c00' },
  orange: { fill: '#ffd8a8', stroke: '#e8590c' }, gray: { fill: '#e9ecef', stroke: '#343a40' },
};
const INK = '#1e1e1e';

export interface DrawNode {
  id: string;
  /** the text in the shape; `\n` breaks a line, long text is wrapped */
  label?: string;
  shape?: 'rectangle' | 'ellipse' | 'diamond' | 'text';
  /** a colour name, or `#rrggbb` for the fill */
  color?: ColorName | string;
  /** give x and y to place it yourself; leave both out to let the layout do it */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}
export interface DrawLink { from: string; to: string; label?: string; style?: 'solid' | 'dashed' | 'dotted'; arrow?: 'end' | 'both' | 'none'; color?: ColorName | string }
export interface DrawZone { id: string; label?: string; nodes: string[]; color?: ColorName | string }
export interface DrawSpec {
  nodes: DrawNode[];
  links?: DrawLink[];
  zones?: DrawZone[];
  /** a heading above the diagram */
  title?: string;
  /** which way the flow runs: left to right (default) or top to bottom */
  direction?: 'LR' | 'TB';
  /** hand-drawn look instead of clean lines */
  sketchy?: boolean;
}

export type El = Record<string, any>;
export interface Scene { type: 'excalidraw'; version: 2; source: string; elements: El[]; appState: Record<string, unknown>; files: Record<string, unknown> }
export interface Built { elements: El[]; warnings: string[]; bounds: { x: number; y: number; w: number; h: number } }

const FONT = 5; // Excalifont
const LINE = 1.25;
const FS = 20;
const FS_LINK = 16;

// ---------------------------------------------------------------- text

/** Estimated width of one line: wide for CJK, narrow for thin letters; a little generous so text does not touch the border. */
export function textWidth(s: string, fontSize: number): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    w += (c > 0x2e80 ? 1 : /[A-Z]/.test(ch) ? 0.68 : /[ilj.,;:!'|]/.test(ch) ? 0.3 : ch === ' ' ? 0.3 : 0.6) * fontSize;
  }
  return w * 1.05;
}

export function wrap(text: string, max: number): string {
  return text.split('\n').map(line => {
    const words = line.split(/\s+/).filter(Boolean);
    const out: string[] = [];
    let cur = '';
    for (const w of words) {
      if (cur && (cur + ' ' + w).length > max) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) out.push(cur);
    return out.join('\n');
  }).join('\n');
}

const linesOf = (t: string) => t.split('\n');
const textBox = (t: string, fs: number) => ({ w: Math.max(...linesOf(t).map(l => textWidth(l, fs)), 1), h: linesOf(t).length * fs * LINE });

// ---------------------------------------------------------------- elements

function rng(seed = 7) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function maker(sketchy: boolean, seed?: number) {
  const r = rng(seed);
  const rint = () => Math.floor(r() * 2 ** 31);
  const base = (type: string, id: string, x: number, y: number, w: number, h: number, o: El = {}): El => ({
    id, type, x, y, width: w, height: h, angle: 0, strokeColor: INK, backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid',
    roughness: sketchy ? 1 : 0, opacity: 100, groupIds: [], frameId: null, index: null, roundness: null, seed: rint(), version: 1, versionNonce: rint(),
    isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, ...o,
  });
  const text = (id: string, x: number, y: number, t: string, fs: number, o: El = {}): El => {
    const b = textBox(t, fs);
    return base('text', id, x, y, o.width ?? b.w, o.height ?? b.h, {
      text: t, originalText: t, fontSize: fs, fontFamily: FONT, textAlign: 'left', verticalAlign: 'top', containerId: null, lineHeight: LINE, autoResize: true, ...o,
    });
  };
  return { base, text, rint };
}

const colorOf = (c: string | undefined, fallback: ColorName) => {
  if (c && c in PALETTE) return PALETTE[c as ColorName];
  if (c && /^#[0-9a-f]{6}$/i.test(c)) return { fill: c, stroke: INK };
  return PALETTE[fallback];
};

interface Placed extends DrawNode { w: number; h: number; x: number; y: number; fixed: boolean; label: string }

/** Where the line from a shape's centre toward a point leaves the shape, pushed `gap` px outward. */
function edgePoint(n: { x: number; y: number; w: number; h: number; shape?: string }, toward: { x: number; y: number }, gap: number) {
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  const len = Math.hypot(dx, dy) || 1;
  const hw = n.w / 2, hh = n.h / 2;
  let t: number;
  if (n.shape === 'ellipse') t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2 || 1);
  else if (n.shape === 'diamond') t = 1 / ((Math.abs(dx) / hw + Math.abs(dy) / hh) || 1);
  else t = Math.min(Math.abs(dx) < 1e-9 ? Infinity : hw / Math.abs(dx), Math.abs(dy) < 1e-9 ? Infinity : hh / Math.abs(dy));
  return { x: cx + dx * t + (dx / len) * gap, y: cy + dy * t + (dy / len) * gap };
}

const hitsBox = (a: { x: number; y: number }, b: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) => {
  // does the segment a-b cross the rectangle r (shrunk a little so touching an edge does not count)?
  const m = 4, x0 = r.x + m, y0 = r.y + m, x1 = r.x + r.w - m, y1 = r.y + r.h - m;
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]] as const) {
    if (p === 0) { if (q < 0) return false; } else { const t = q / p; if (p < 0) { if (t > t1) return false; t0 = Math.max(t0, t); } else { if (t < t0) return false; t1 = Math.min(t1, t); } }
  }
  return t0 < t1;
};

// ---------------------------------------------------------------- layout

function layered(nodes: Placed[], links: DrawLink[], dir: 'LR' | 'TB', labelled: boolean) {
  const ids = nodes.map(n => n.id);
  const idx = new Map(ids.map((id, i) => [id, i] as const));
  const out = new Map<string, string[]>(ids.map(id => [id, []]));
  const state = new Map<string, number>();
  const dag: [string, string][] = [];
  // forward edges only: a cycle is cut where the walk meets it again
  const walk = (id: string) => {
    state.set(id, 1);
    for (const l of links) if (l.from === id && idx.has(l.to)) {
      if (state.get(l.to) === 1) continue;
      dag.push([l.from, l.to]);
      if (!state.has(l.to)) walk(l.to);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (!state.has(id)) walk(id);
  const preds = new Map<string, string[]>(ids.map(id => [id, []]));
  for (const [a, b] of dag) { out.get(a)!.push(b); preds.get(b)!.push(a); }
  const rank = new Map<string, number>();
  const rk = (id: string): number => {
    if (!rank.has(id)) rank.set(id, 0);
    const v = preds.get(id)!.length ? Math.max(...preds.get(id)!.map(rk)) + 1 : 0;
    rank.set(id, v);
    return v;
  };
  for (const id of ids) rk(id);
  const maxRank = Math.max(...rank.values());
  const rows: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const id of ids) rows[rank.get(id)!].push(id);
  const pos = new Map<string, number>();
  const settle = () => rows.forEach(r => r.forEach((id, i) => pos.set(id, i)));
  settle();
  const bary = (id: string, adj: Map<string, string[]>) => { const a = adj.get(id)!; return a.length ? a.reduce((s, x) => s + pos.get(x)!, 0) / a.length : pos.get(id)!; };
  for (let pass = 0; pass < 3; pass++) {
    for (let r = 1; r <= maxRank; r++) { rows[r].sort((a, b) => bary(a, preds) - bary(b, preds) || idx.get(a)! - idx.get(b)!); settle(); }
    for (let r = maxRank - 1; r >= 0; r--) { rows[r].sort((a, b) => bary(a, out) - bary(b, out) || idx.get(a)! - idx.get(b)!); settle(); }
  }
  const by = new Map(nodes.map(n => [n.id, n] as const));
  const along = dir === 'LR' ? (n: Placed) => n.w : (n: Placed) => n.h;
  const across = dir === 'LR' ? (n: Placed) => n.h : (n: Placed) => n.w;
  const gapRank = dir === 'LR' ? (labelled ? 170 : 120) : (labelled ? 120 : 90);
  const gapAcross = dir === 'LR' ? 50 : 60;
  let cursor = 0;
  const colSpan = rows.map(r => r.reduce((s, id, i) => s + across(by.get(id)!) + (i ? gapAcross : 0), 0));
  const widest = Math.max(...colSpan);
  rows.forEach((r, ri) => {
    const thick = Math.max(...r.map(id => along(by.get(id)!)));
    let c = (widest - colSpan[ri]) / 2;
    for (const id of r) {
      const n = by.get(id)!;
      const a = cursor + (thick - along(n)) / 2;
      if (dir === 'LR') { n.x = a; n.y = c; } else { n.x = c; n.y = a; }
      c += across(n) + gapAcross;
    }
    cursor += thick + gapRank;
  });
}

function grid(nodes: Placed[]) {
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const cw = Math.max(...nodes.map(n => n.w)) + 60, rh = Math.max(...nodes.map(n => n.h)) + 50;
  nodes.forEach((n, i) => { n.x = (i % cols) * cw + (cw - 60 - n.w) / 2; n.y = Math.floor(i / cols) * rh + (rh - 50 - n.h) / 2; });
}

// ---------------------------------------------------------------- the diagram

export function buildDiagram(spec: DrawSpec, opts: { seed?: number } = {}): Built {
  const warnings: string[] = [];
  if (!Array.isArray(spec.nodes) || spec.nodes.length === 0) throw new Error('Give at least one node.');
  if (spec.nodes.length > 60) throw new Error('A drawing with more than 60 nodes cannot be read; split it into several drawings.');
  const seen = new Set<string>();
  for (const n of spec.nodes) {
    if (!n.id || typeof n.id !== 'string') throw new Error('Every node needs an id.');
    if (seen.has(n.id)) throw new Error(`Two nodes have the id "${n.id}".`);
    seen.add(n.id);
  }
  const links = spec.links ?? [];
  for (const l of links) {
    for (const end of [l.from, l.to]) if (!seen.has(end)) throw new Error(`A link points at "${end}", which is not a node. Nodes: ${[...seen].join(', ')}.`);
  }
  const zones = spec.zones ?? [];
  for (const z of zones) for (const m of z.nodes ?? []) if (!seen.has(m)) throw new Error(`Zone "${z.id}" lists "${m}", which is not a node.`);
  const dir = spec.direction === 'TB' ? 'TB' : 'LR';
  const { base, text } = maker(spec.sketchy === true, opts.seed);

  // sizes
  const placed: Placed[] = spec.nodes.map(n => {
    const shape = n.shape ?? 'rectangle';
    const label = shape === 'text' ? (n.label ?? '') : wrap(n.label ?? '', 26);
    const tb = textBox(label || ' ', FS);
    let w = Math.min(Math.max(tb.w + 44, 120), 340), h = Math.max(tb.h + 36, 60);
    if (shape === 'diamond') { w = Math.max(w * 1.5, 160); h = Math.max(h * 1.6, 100); }
    if (shape === 'ellipse') { w = Math.max(w * 1.2, 130); h = Math.max(h * 1.3, 70); }
    if (shape === 'text') { w = tb.w; h = tb.h; }
    const ow = n.w ?? w, oh = n.h ?? h;
    if (shape !== 'text' && label && tb.w > ow - 10) warnings.push(`The text of "${n.id}" is wider than its shape; make it wider or shorten the label.`);
    return { ...n, shape, label, w: ow, h: oh, x: n.x ?? 0, y: n.y ?? 0, fixed: n.x !== undefined && n.y !== undefined };
  });

  // layout of the nodes that were not placed by hand
  const free = placed.filter(n => !n.fixed);
  if (free.length) {
    const ids = new Set(free.map(n => n.id));
    const inner = links.filter(l => ids.has(l.from) && ids.has(l.to) && l.from !== l.to);
    if (inner.length) layered(free, inner, dir, inner.some(l => l.label)); else grid(free);
    const fixed = placed.filter(n => n.fixed);
    const minX = Math.min(...free.map(n => n.x)), minY = Math.min(...free.map(n => n.y));
    const offX = fixed.length ? Math.max(...fixed.map(n => n.x + n.w)) + 120 : 0;
    const offY = fixed.length ? Math.min(...fixed.map(n => n.y)) : 0;
    for (const n of free) { n.x = n.x - minX + offX; n.y = n.y - minY + offY; }
  }
  const byId = new Map(placed.map(n => [n.id, n] as const));
  const snap = (v: number) => Math.round(v / 10) * 10;
  for (const n of placed) if (!n.fixed) { n.x = snap(n.x); n.y = snap(n.y); }

  const els: El[] = [];
  const nodeEl = new Map<string, El>();

  // zones first, so they sit behind everything
  const zoneEls: El[] = [];
  zones.forEach(z => {
    const m = (z.nodes ?? []).map(id => byId.get(id)!).filter(Boolean);
    if (!m.length) return;
    const pad = 28, head = z.label ? 34 : 0;
    const x0 = Math.min(...m.map(n => n.x)) - pad, y0 = Math.min(...m.map(n => n.y)) - pad - head;
    const x1 = Math.max(...m.map(n => n.x + n.w)) + pad, y1 = Math.max(...m.map(n => n.y + n.h)) + pad;
    const c = colorOf(z.color, 'gray');
    const rect = base('rectangle', `zone_${z.id}`, x0, y0, x1 - x0, y1 - y0, { backgroundColor: c.fill, strokeColor: c.stroke, strokeStyle: 'dashed', opacity: 45, strokeWidth: 1, roundness: { type: 3 } });
    zoneEls.push(rect);
    for (const o of placed) {
      if (m.includes(o)) continue;
      if (o.x < x1 && o.x + o.w > x0 && o.y < y1 && o.y + o.h > y0) warnings.push(`"${o.id}" lies inside zone "${z.id}" but is not listed in it.`);
    }
    if (z.label) {
      const t = text(`zone_${z.id}_t`, x0 + 10, y0 + 8, wrap(z.label, 40), FS_LINK + 2, { containerId: rect.id, width: x1 - x0 - 20, strokeColor: c.stroke });
      rect.boundElements = [{ type: 'text', id: t.id }];
      zoneEls.push(t);
    }
  });
  els.push(...zoneEls);

  // shapes and their text
  for (const n of placed) {
    const c = colorOf(n.color, 'blue');
    if (n.shape === 'text') {
      const t = text(n.id, n.x, n.y, n.label, FS, { width: n.w, height: n.h });
      els.push(t); nodeEl.set(n.id, t);
      continue;
    }
    const shape = base(n.shape!, n.id, n.x, n.y, n.w, n.h, { backgroundColor: c.fill, strokeColor: c.stroke, roundness: n.shape === 'rectangle' ? { type: 3 } : n.shape === 'diamond' ? { type: 2 } : null, boundElements: [] });
    els.push(shape); nodeEl.set(n.id, shape);
    if (n.label) {
      const tb = textBox(n.label, FS);
      const t = text(`${n.id}_t`, n.x + 5, n.y + (n.h - tb.h) / 2, n.label, FS, { containerId: n.id, textAlign: 'center', verticalAlign: 'middle', width: n.w - 10, height: tb.h });
      shape.boundElements.push({ type: 'text', id: t.id });
      els.push(t);
    }
  }

  // arrows
  links.forEach((l, i) => {
    if (l.from === l.to) { warnings.push(`A link from "${l.from}" to itself was left out.`); return; }
    const a = byId.get(l.from)!, b = byId.get(l.to)!;
    const gap = 4;
    const centre = (n: Placed) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
    const others = placed.filter(o => o !== a && o !== b);
    const straight = { s: edgePoint(a, centre(b), gap), e: edgePoint(b, centre(a), gap) };
    // a straight arrow that would run through another shape bends around it instead; so does a second arrow between the same
    // two shapes (the way back of a loop), or it would lie on top of the first
    const twin = links.slice(0, i).some(o => (o.from === l.from && o.to === l.to) || (o.from === l.to && o.to === l.from));
    let way: { x: number; y: number } | null = null;
    let s = straight.s, e = straight.e;
    if (twin || others.some(o => hitsBox(s, e, o))) {
      const m = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
      const len = Math.hypot(e.x - s.x, e.y - s.y) || 1;
      const n = { x: -(e.y - s.y) / len, y: (e.x - s.x) / len };
      // the reverse link has the opposite normal, so a positive distance puts a pair on opposite sides
      detour: for (const d of twin ? [80, 140, -80, -140] : [90, -90, 160, -160, 240, -240]) {
        const w = { x: m.x + n.x * d, y: m.y + n.y * d };
        const s2 = edgePoint(a, w, gap), e2 = edgePoint(b, w, gap);
        if (!others.some(o => hitsBox(s2, w, o) || hitsBox(w, e2, o))) { way = w; s = s2; e = e2; break detour; }
      }
    }
    const id = `link_${i + 1}_${l.from}_${l.to}`;
    const c = colorOf(l.color, 'gray');
    const head = l.arrow ?? 'end';
    const pts: number[][] = way ? [[0, 0], [way.x - s.x, way.y - s.y], [e.x - s.x, e.y - s.y]] : [[0, 0], [e.x - s.x, e.y - s.y]];
    const px = pts.map(p => p[0]), py = pts.map(p => p[1]);
    const arrow = base('arrow', id, s.x, s.y, Math.max(...px) - Math.min(...px), Math.max(...py) - Math.min(...py), {
      points: pts, strokeColor: l.color ? c.stroke : INK, strokeStyle: l.style ?? 'solid', roundness: { type: 2 },
      startBinding: a.shape === 'text' ? null : { elementId: a.id, focus: 0, gap }, endBinding: b.shape === 'text' ? null : { elementId: b.id, focus: 0, gap },
      startArrowhead: head === 'both' ? 'arrow' : null, endArrowhead: head === 'none' ? null : 'arrow', elbowed: false, lastCommittedPoint: null, boundElements: [],
    });
    for (const [n, node] of [[a, nodeEl.get(a.id)!], [b, nodeEl.get(b.id)!]] as const) if (n.shape !== 'text') node.boundElements.push({ type: 'arrow', id });
    els.push(arrow);
    if (l.label) {
      const lab = wrap(l.label, 22);
      const tb = textBox(lab, FS_LINK);
      const mid = way ?? { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
      const run = way ? Math.hypot(way.x - s.x, way.y - s.y) + Math.hypot(e.x - way.x, e.y - way.y) : Math.hypot(e.x - s.x, e.y - s.y);
      if (run < tb.w + 24) warnings.push(`The arrow ${l.from} -> ${l.to} is too short for its label; make the gap larger or the label shorter.`);
      const t = text(`${id}_t`, mid.x - tb.w / 2, mid.y - tb.h / 2, lab, FS_LINK, { containerId: id, textAlign: 'center', verticalAlign: 'middle', width: tb.w, height: tb.h });
      arrow.boundElements.push({ type: 'text', id: t.id });
      els.push(t);
    }
    if (others.some(o => hitsBox(s, e, o)) && !way) warnings.push(`The arrow ${l.from} -> ${l.to} passes through another shape; move the shapes or change the order.`);
  });

  // overlaps
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const p = placed[i], q = placed[j];
    if (p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y) warnings.push(`"${p.id}" and "${q.id}" overlap.`);
  }

  const all = placed.map(n => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  for (const el of zoneEls) if (el.type === 'rectangle') all.push({ x: el.x, y: el.y, w: el.width, h: el.height });
  const bx0 = Math.min(...all.map(r => r.x));
  let by0 = Math.min(...all.map(r => r.y));
  const bx1 = Math.max(...all.map(r => r.x + r.w)), by1 = Math.max(...all.map(r => r.y + r.h));
  if (spec.title?.trim()) {
    const t = wrap(spec.title.trim(), 60);
    const tb = textBox(t, 28);
    els.push(text('title', bx0, by0 - tb.h - 36, t, 28, {}));
    by0 -= tb.h + 36;
  }
  return { elements: els, warnings, bounds: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 } };
}

// ---------------------------------------------------------------- scenes and the drawing blocks of a note

export const emptyScene = (source = 'ergonotes'): Scene => ({ type: 'excalidraw', version: 2, source, elements: [], appState: {}, files: {} });

/** The Markdown block the editor stores for a drawing. */
export const drawingBlock = (scene: unknown): string => '```ergonote-excalidraw\n' + JSON.stringify(scene).replace(/\n/g, ' ') + '\n```';

export interface DrawingRef { /** 1-based, in reading order */ n: number; start: number; end: number; scene: Scene | null }

/** The drawing blocks of a note body; `scene` is null for one whose JSON cannot be read. */
export function drawingsIn(body: string): DrawingRef[] {
  const out: DrawingRef[] = [];
  const re = /```ergonote-excalidraw\n([\s\S]*?)\n```/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    let scene: Scene | null = null;
    try { const j = JSON.parse(m[1]); if (j && Array.isArray(j.elements)) scene = j as Scene; } catch { /* unreadable */ }
    out.push({ n: out.length + 1, start: m.index, end: m.index + m[0].length, scene });
  }
  return out;
}

export function replaceDrawing(body: string, n: number, scene: Scene): string {
  const d = drawingsIn(body).find(x => x.n === n);
  if (!d) throw new Error(`The note has ${drawingsIn(body).length} drawing(s); there is no drawing ${n}.`);
  return body.slice(0, d.start) + drawingBlock(scene) + body.slice(d.end);
}

export function boundsOf(elements: El[]): { x: number; y: number; w: number; h: number } | null {
  const live = elements.filter(e => !e.isDeleted);
  if (!live.length) return null;
  const xs: number[] = [], ys: number[] = [];
  for (const e of live) {
    if (Array.isArray(e.points)) for (const [px, py] of e.points) { xs.push(e.x + px); ys.push(e.y + py); }
    xs.push(e.x, e.x + (e.width ?? 0)); ys.push(e.y, e.y + (e.height ?? 0));
  }
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Move `added` so it sits beside `existing` (to the right, or below), leaving 120 px between. */
export function placeBeside(existing: El[], added: El[], side: 'right' | 'below' = 'right'): El[] {
  const eb = boundsOf(existing), ab = boundsOf(added);
  if (!eb || !ab) return added;
  const dx = side === 'right' ? eb.x + eb.w + 120 - ab.x : eb.x - ab.x;
  const dy = side === 'right' ? eb.y - ab.y : eb.y + eb.h + 120 - ab.y;
  return added.map(e => ({ ...e, x: e.x + dx, y: e.y + dy }));
}

// ---------------------------------------------------------------- libraries (libraries.excalidraw.com)

export interface LibraryEntry { name: string; description?: string; source: string; authors?: { name: string; url?: string }[]; itemNames?: string[]; version?: number }
export interface LibraryItem { id?: string; name?: string; elements: El[] }

/** Libraries whose name, description or item names contain every word of the query. */
export function searchLibraryIndex(index: LibraryEntry[], query: string, limit = 8): LibraryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return index
    .map(l => {
      const hay = [l.name, l.description ?? '', ...(l.itemNames ?? [])].join(' ').toLowerCase();
      return { l, hits: words.filter(w => hay.includes(w)).length, name: l.name.toLowerCase().includes(words[0]) ? 1 : 0 };
    })
    .filter(x => x.hits === words.length)
    .sort((a, b) => b.name - a.name)
    .slice(0, limit)
    .map(x => x.l);
}

/** The items of a downloaded `.excalidrawlib`, version 1 (`library`: lists of elements) or 2 (`libraryItems`). */
export function libraryItems(file: unknown): LibraryItem[] {
  const f = (file ?? {}) as { type?: string; library?: unknown; libraryItems?: unknown };
  if (f.type !== 'excalidrawlib') throw new Error('That file is not an Excalidraw library.');
  if (Array.isArray(f.libraryItems)) return f.libraryItems.filter((i: any) => Array.isArray(i?.elements)) as LibraryItem[];
  if (Array.isArray(f.library)) return (f.library as unknown[]).map((els, i) => ({ id: `v1-${i}`, elements: els as El[] }));
  return [];
}

/** An item by its name, or by its number (1-based) when the library names none or the agent saw a contact sheet. */
export function findLibraryItem(items: LibraryItem[], name: string): LibraryItem | { choices: string[] } {
  const want = name.trim().toLowerCase();
  const exact = items.find(i => (i.name ?? '').toLowerCase() === want);
  if (exact) return exact;
  if (/^\d+$/.test(want) && items[Number(want) - 1]) return items[Number(want) - 1];
  const some = want ? items.filter(i => (i.name ?? '').toLowerCase().includes(want)) : [];
  if (some.length === 1) return some[0];
  return { choices: (some.length ? some : items).map((i, k) => `${k + 1}. ${i.name ?? '(no name)'}`).slice(0, 40) };
}

/**
 * The items of a library laid out on a grid, each shrunk to fit its cell and numbered, so an agent can look at a picture of
 * them and choose. `start` is the number of the first item (0-based) so a second page continues the count.
 */
export function contactSheet(items: El[][], start = 0, cols = 4, cell = 220): El[] {
  const { text } = maker(false, 11);
  const out: El[] = [];
  items.forEach((els, i) => {
    const b = boundsOf(els.filter(e => !e.isDeleted));
    if (!b) return;
    const k = Math.min(1, (cell - 50) / Math.max(b.w, b.h, 1));
    const cx = (i % cols) * cell, cy = Math.floor(i / cols) * cell;
    out.push(...placeLibraryItem(els, cx + (cell - b.w * k) / 2, cy + (cell - 40 - b.h * k) / 2, k, 100 + i));
    out.push(text(`sheet_n${start + i + 1}`, cx + cell / 2 - 14, cy + cell - 34, String(start + i + 1), 24, { strokeColor: '#e03131' }));
  });
  return out;
}

/**
 * A copy of a library item with its top-left corner at (ox, oy): new ids everywhere, group ids, text containers, bound
 * elements, arrow bindings and frames remapped (links that leave the item are dropped), new seeds. The elements should have
 * been restored first (legacy fields migrated); `scale` is uniform.
 */
export function placeLibraryItem(item: El[], ox: number, oy: number, scale = 1, seed?: number): El[] {
  const r = rng(seed ?? Math.floor(Math.random() * 2 ** 31));
  const rid = () => 'lib' + Math.floor(r() * 36 ** 8).toString(36).padStart(8, '0') + Math.floor(r() * 36 ** 4).toString(36).padStart(4, '0');
  const rint = () => Math.floor(r() * 2 ** 31);
  const src = item.filter(e => !e.isDeleted);
  const b = boundsOf(src);
  if (!b) return [];
  const ids = new Map<string, string>(), groups = new Map<string, string>();
  for (const e of src) ids.set(e.id, rid());
  const has = (id: string) => ids.has(id);
  return src.map(e => {
    const c: El = JSON.parse(JSON.stringify(e));
    c.id = ids.get(e.id)!;
    c.x = ox + (e.x - b.x) * scale; c.y = oy + (e.y - b.y) * scale;
    c.width = (e.width ?? 0) * scale; c.height = (e.height ?? 0) * scale;
    if (Array.isArray(e.points)) c.points = e.points.map(([px, py]: number[]) => [px * scale, py * scale]);
    if (e.type === 'text') c.fontSize = e.fontSize * scale;
    c.seed = rint(); c.version = 1; c.versionNonce = rint(); c.updated = 1; c.index = null;
    c.groupIds = (e.groupIds ?? []).map((g: string) => { if (!groups.has(g)) groups.set(g, rid()); return groups.get(g)!; });
    if (c.containerId) c.containerId = has(c.containerId) ? ids.get(c.containerId) : null;
    if (c.boundElements) c.boundElements = c.boundElements.filter((x: El) => has(x.id)).map((x: El) => ({ ...x, id: ids.get(x.id) }));
    for (const k of ['startBinding', 'endBinding']) if (c[k]) c[k] = has(c[k].elementId) ? { ...c[k], elementId: ids.get(c[k].elementId), gap: (c[k].gap ?? 0) * scale } : null;
    if (c.frameId) c.frameId = has(c.frameId) ? ids.get(c.frameId) : null;
    return c;
  });
}

// ---------------------------------------------------------------- reading a drawing

export interface DrawingSummary {
  elements: number;
  bounds: { x: number; y: number; w: number; h: number } | null;
  shapes: { id: string; type: string; label: string; x: number; y: number; w: number; h: number }[];
  arrows: { id: string; from: string | null; to: string | null; label: string }[];
  texts: { id: string; text: string; x: number; y: number }[];
  other: Record<string, number>;
  /** where it was drawn from, when a library item was used */
  source: string;
}

export function summarize(scene: Scene): DrawingSummary {
  const els = scene.elements.filter(e => !e.isDeleted);
  const byId = new Map(els.map(e => [e.id, e] as const));
  const labelOf = (e: El): string => {
    const t = (e.boundElements ?? []).map((b: El) => b.type === 'text' ? byId.get(b.id) : null).find(Boolean);
    return t ? String(t.text ?? '').replace(/\n/g, ' ') : '';
  };
  const out: DrawingSummary = { elements: els.length, bounds: boundsOf(els), shapes: [], arrows: [], texts: [], other: {}, source: String(scene.source ?? '') };
  const r = (n: number) => Math.round(n);
  for (const e of els) {
    if (['rectangle', 'ellipse', 'diamond'].includes(e.type)) out.shapes.push({ id: e.id, type: e.type, label: labelOf(e), x: r(e.x), y: r(e.y), w: r(e.width), h: r(e.height) });
    else if (e.type === 'arrow') out.arrows.push({ id: e.id, from: e.startBinding ? labelOf(byId.get(e.startBinding.elementId) ?? {}) || e.startBinding.elementId : null, to: e.endBinding ? labelOf(byId.get(e.endBinding.elementId) ?? {}) || e.endBinding.elementId : null, label: labelOf(e) });
    else if (e.type === 'text') { if (!e.containerId) out.texts.push({ id: e.id, text: String(e.text ?? '').replace(/\n/g, ' '), x: r(e.x), y: r(e.y) }); }
    else out.other[e.type] = (out.other[e.type] ?? 0) + 1;
  }
  return out;
}

/** Problems a person would notice: references to elements that are not there. */
export function checkScene(scene: Scene): string[] {
  const els = scene.elements.filter(e => !e.isDeleted);
  const ids = new Set(els.map(e => e.id));
  const bad: string[] = [];
  if (ids.size !== els.length) bad.push('Some element ids are used twice.');
  for (const e of els) {
    if (e.containerId && !ids.has(e.containerId)) bad.push(`Text ${e.id} sits in ${e.containerId}, which is missing.`);
    for (const b of e.boundElements ?? []) if (!ids.has(b.id)) bad.push(`${e.id} lists ${b.id} as bound, but it is missing.`);
    for (const k of ['startBinding', 'endBinding']) if (e[k] && !ids.has(e[k].elementId)) bad.push(`Arrow ${e.id} is bound to ${e[k].elementId}, which is missing.`);
    if ((e.type === 'arrow' || e.type === 'line') && !Array.isArray(e.points)) bad.push(`${e.type} ${e.id} has no points.`);
  }
  return bad;
}
