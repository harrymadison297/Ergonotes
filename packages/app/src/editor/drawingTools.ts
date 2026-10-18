// The drawing tools the desktop app adds to its MCP endpoint (ADR 0015): they need what only a browser has (Excalidraw's
// own restore and renderer), so they run here and not in the core. An agent describes a diagram (core `buildDiagram`),
// or asks for a shape from an Excalidraw library, and gets back a picture of the result to check its own work.
import {
  boundsOf, buildDiagram, buildTools, checkScene, contactSheet, drawingBlock, drawingsIn, emptyScene, findLibraryItem, libraryItems, placeBeside, placeLibraryItem, replaceDrawing,
  searchLibraryIndex, summarize,
  type DrawSpec, type El, type LibraryEntry, type McpExtraTool, type McpVault, type RichResult, type Scene,
} from '@ergonotes/core';
import { mermaidToScene } from './diagram';

const LIBRARIES = 'https://libraries.excalidraw.com';
// `author/name.excalidrawlib`: no segment may start with a dot, so `..` cannot walk out of /libraries/
const LIBRARY_PATH = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.excalidrawlib$/;
const NOT_FOUND = 'Note not found';

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' };
const noteId = { type: 'string', description: 'Note id (from search_notes).' };
const where = { type: 'string', description: 'Put a new drawing at the end of this section; otherwise at the end of the note.' };
const drawingNo = { type: 'number', description: 'Which drawing of the note, counting from 1 in reading order.' };
const json = (o: unknown) => JSON.stringify(o, null, 2);

// ---------------------------------------------------------------- excalidraw, loaded when first needed

async function excalidraw() { return import('@excalidraw/excalidraw'); }

/** Excalidraw's own restore: migrates old fields, fills what is missing, repairs bindings, gives every element its order. */
async function restored(elements: El[]): Promise<El[]> {
  const { restoreElements } = await excalidraw();
  return restoreElements(elements as never, null, { repairBindings: true }) as unknown as El[];
}

/** A PNG of a scene, at most `max` px on its long side: what the agent looks at to see what it drew. */
export async function previewOf(scene: Scene, max = 960): Promise<{ data: string; mimeType: string } | null> {
  try {
    const live = scene.elements.filter(e => !e.isDeleted);
    if (!live.length) return null;
    const { exportToSvg } = await excalidraw();
    const svg = await exportToSvg({
      elements: live as never, files: (scene.files ?? {}) as never, exportPadding: 24,
      appState: { ...(scene.appState ?? {}), exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false } as never,
    });
    const w = parseFloat(svg.getAttribute('width') ?? '0') || 800, h = parseFloat(svg.getAttribute('height') ?? '0') || 600;
    const k = Math.min(1.5, max / Math.max(w, h));
    const img = new Image();
    const loaded = new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('The drawing could not be rendered.')); });
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''), mimeType: 'image/png' };
  } catch { return null; }
}

// ---------------------------------------------------------------- the library index

let indexCache: { at: number; list: LibraryEntry[] } | null = null;

async function libraryIndex(fetchImpl: typeof fetch): Promise<LibraryEntry[]> {
  if (indexCache && Date.now() - indexCache.at < 60 * 60 * 1000) return indexCache.list;
  const r = await fetchImpl(`${LIBRARIES}/libraries.json`);
  if (!r.ok) throw new Error(`Could not reach the library list (${r.status}). Check the internet connection.`);
  const list = (await r.json()) as LibraryEntry[];
  indexCache = { at: Date.now(), list };
  return list;
}

const fileCache = new Map<string, unknown>();

/** One downloaded library file (the last few are kept, as browsing is followed by importing). */
async function libraryFile(fetchImpl: typeof fetch, lib: string): Promise<unknown> {
  if (!LIBRARY_PATH.test(lib)) throw new Error('`library` must be the value search_libraries gave, like "author/name.excalidrawlib".');
  if (fileCache.has(lib)) return fileCache.get(lib);
  const r = await fetchImpl(`${LIBRARIES}/libraries/${lib}`);
  if (!r.ok) throw new Error(`Could not download that library (${r.status}).`);
  const file = await r.json();
  if (fileCache.size >= 4) fileCache.delete(fileCache.keys().next().value as string);
  fileCache.set(lib, file);
  return file;
}

// ---------------------------------------------------------------- the tools

export function createDrawingTools(vault: McpVault, fetchImpl: typeof fetch = fetch.bind(globalThis)): McpExtraTool[] {
  const notes = buildTools({ vault, scope: { kind: 'vault' } });
  const tool = (name: string) => notes.find(t => t.spec.name === name)!;

  const read = async (id: unknown) => {
    const n = typeof id === 'string' ? await vault.getNote(id) : null;
    if (!n || n.private || n.type !== 'note') throw new Error(NOT_FOUND);
    return n;
  };
  const wanted = (a: Record<string, unknown>) => (a.drawing === undefined ? undefined : Math.max(1, Math.floor(Number(a.drawing))));

  /** Write a scene into a note: replacing drawing `n`, or as a new block. Returns the number of the drawing. */
  const put = async (id: string, scene: Scene, n: number | undefined, afterHeading: string): Promise<number> => {
    const note = await read(id);
    if (n !== undefined) { await vault.saveNote(id, { body: replaceDrawing(note.body, n, scene) }); return n; }
    const block = drawingBlock(scene);
    await (afterHeading ? tool('insert_after_heading').run({ id, heading: afterHeading, markdown: block }) : tool('append_to_note').run({ id, text: block }));
    return drawingsIn((await read(id)).body).length;
  };

  const show = async (scene: Scene, lead: Record<string, unknown>): Promise<RichResult> => {
    const png = await previewOf(scene);
    return { text: json({ ...lead, ...(png ? {} : { preview: 'A picture could not be made; check the drawing in the app.' }) }), images: png ? [png] : undefined };
  };

  const draw: McpExtraTool = {
    spec: {
      name: 'draw',
      description:
        'Draw a diagram in a note as an Excalidraw drawing the user can keep editing. Describe nodes and links; the layout, the text inside shapes and the arrows are made for you. ' +
        'Without x and y on its nodes it lays the diagram out left to right (direction "TB" for top to bottom). Keep it to 6-12 nodes with short labels (3 lines at most), colour by meaning ' +
        '(blue = ours, green = ok/data, yellow = external, orange = warning, red = risk, violet = people, gray = neutral), and use zones to group nodes. ' +
        'It returns a picture of the result and any problems found (overlaps, arrows through shapes, labels too long): look at it and call again with `drawing` and `replace` to fix it. ' +
        'With `drawing` and no `replace`, the new diagram is added beside that drawing. Use insert_diagram instead only for a quick Mermaid you already have.',
      parameters: obj({
        id: noteId, title: { ...str, description: 'A heading above the diagram.' },
        direction: { type: 'string', enum: ['LR', 'TB'] }, sketchy: { type: 'boolean', description: 'Hand-drawn look instead of clean lines.' },
        nodes: {
          type: 'array', items: obj({
            id: { ...str, description: 'Short unique id, used by links and zones.' }, label: str, shape: { type: 'string', enum: ['rectangle', 'ellipse', 'diamond', 'text'] },
            color: { ...str, description: 'red, pink, grape, violet, blue, cyan, teal, green, yellow, orange or gray (or #rrggbb).' },
            x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
          }, ['id']),
        },
        links: { type: 'array', items: obj({ from: str, to: str, label: str, style: { type: 'string', enum: ['solid', 'dashed', 'dotted'] }, arrow: { type: 'string', enum: ['end', 'both', 'none'] }, color: str }, ['from', 'to']) },
        zones: { type: 'array', items: obj({ id: str, label: str, nodes: { type: 'array', items: str }, color: str }, ['id', 'nodes']) },
        after_heading: where, drawing: drawingNo, replace: { type: 'boolean', description: 'With `drawing`: replace that drawing instead of adding beside it.' },
      }, ['id', 'nodes']),
    },
    run: async () => { throw new Error('unused'); },
    runRich: async a => {
      const id = String(a.id ?? '');
      const note = await read(id);
      const built = buildDiagram({ nodes: a.nodes, links: a.links, zones: a.zones, title: a.title, direction: a.direction, sketchy: a.sketchy } as unknown as DrawSpec);
      const els = await restored(built.elements);
      const n = wanted(a);
      let scene: Scene;
      if (n !== undefined) {
        const old = drawingsIn(note.body).find(d => d.n === n);
        if (!old?.scene) throw new Error(`The note has no readable drawing ${n}.`);
        scene = a.replace === true ? { ...old.scene, elements: els } : { ...old.scene, elements: [...old.scene.elements, ...placeBeside(old.scene.elements, els)] };
      } else scene = { ...emptyScene(), elements: els };
      const problems = checkScene(scene);
      if (problems.length) throw new Error(`The drawing is inconsistent: ${problems.slice(0, 5).join(' ')}`);
      const at = await put(id, scene, n, typeof a.after_heading === 'string' ? a.after_heading : '');
      return show(scene, { drawing: at, elements: scene.elements.length, warnings: built.warnings, tip: built.warnings.length ? 'Fix the warnings with draw (drawing + replace).' : 'Look at the picture; if something is cramped or unclear, redraw with replace.' });
    },
  };

  const insertDiagram: McpExtraTool = {
    spec: {
      name: 'insert_diagram',
      description: 'Draw a Mermaid diagram (flowchart, sequenceDiagram, classDiagram, erDiagram, stateDiagram, mindmap) into a note as an editable drawing. Quick, but the layout is Mermaid\'s; for a designed diagram use draw.',
      parameters: obj({ id: noteId, mermaid: { ...str, description: 'Mermaid source, without code fences.' }, after_heading: where }, ['id', 'mermaid']),
    },
    run: async () => { throw new Error('unused'); },
    runRich: async a => {
      const id = String(a.id ?? '');
      await read(id);
      const m = await mermaidToScene(String(a.mermaid ?? ''));
      const els = m.elements as El[];
      if (els.length > 0 && els.every(e => e.type === 'image')) throw new Error('Mermaid turned this diagram into a plain picture that cannot be edited. Use draw to describe it instead.');
      const scene: Scene = { type: 'excalidraw', version: 2, source: 'ergonotes', elements: await restored(els), appState: {}, files: m.files };
      const at = await put(id, scene, undefined, typeof a.after_heading === 'string' ? a.after_heading : '');
      return show(scene, { drawing: at, elements: scene.elements.length });
    },
  };

  const readDrawing: McpExtraTool = {
    spec: {
      name: 'read_drawing',
      description: 'Look at a drawing of a note: its shapes with their text, what each arrow connects, free text, and a picture. Use it before changing a drawing and to check one you made.',
      parameters: obj({ id: noteId, drawing: drawingNo }, ['id']),
    },
    run: async () => { throw new Error('unused'); },
    runRich: async a => {
      const note = await read(a.id);
      const all = drawingsIn(note.body);
      if (!all.length) return { text: 'This note has no drawings.' };
      const d = all.find(x => x.n === (wanted(a) ?? 1));
      if (!d) throw new Error(`The note has ${all.length} drawing(s); there is no drawing ${wanted(a)}.`);
      if (!d.scene) throw new Error(`Drawing ${d.n} cannot be read. Leave it as it is.`);
      return show(d.scene, { drawing: d.n, of: all.length, ...summarize(d.scene), problems: checkScene(d.scene) });
    },
  };

  const searchLibraries: McpExtraTool = {
    spec: {
      name: 'search_libraries',
      description: 'Search the public Excalidraw libraries (libraries.excalidraw.com: icons, UML, cloud architecture, wireframes, ...) for ready-made shapes. Returns libraries and some of their item names; then look at one with browse_library and use import_library_item.',
      parameters: obj({ query: { ...str, description: 'Words, e.g. "aws", "uml", "database".' } }, ['query']),
    },
    run: async a => {
      const hits = searchLibraryIndex(await libraryIndex(fetchImpl), String(a.query ?? ''));
      if (!hits.length) return 'No library matches. Try a shorter or more general word.';
      return json(hits.map(l => ({ library: l.source, name: l.name, description: l.description, authors: (l.authors ?? []).map(x => x.name), items: (l.itemNames ?? []).slice(0, 30) })));
    },
  };

  const browseLibrary: McpExtraTool = {
    spec: {
      name: 'browse_library',
      description: 'Look at the items of one Excalidraw library: a picture with every item numbered (12 to a page) and their names. Choose by number or name for import_library_item.',
      parameters: obj({ library: { ...str, description: 'The "library" value from search_libraries.' }, page: { type: 'number', description: 'Page of 12 items, from 1.' } }, ['library']),
    },
    run: async () => { throw new Error('unused'); },
    runRich: async a => {
      const items = libraryItems(await libraryFile(fetchImpl, String(a.library ?? '')));
      const per = 12, pages = Math.max(1, Math.ceil(items.length / per));
      const page = Math.min(pages, Math.max(1, Math.floor(Number(a.page ?? 1)) || 1));
      const slice = items.slice((page - 1) * per, page * per);
      const els: El[][] = [];
      for (const it of slice) els.push(await restored(it.elements));
      const scene: Scene = { ...emptyScene(), elements: contactSheet(els, (page - 1) * per) };
      const png = await previewOf(scene, 1100);
      return {
        text: json({ library: a.library, page, pages, items: slice.map((it, i) => ({ n: (page - 1) * per + i + 1, name: it.name ?? null })) }),
        images: png ? [png] : undefined,
      };
    },
  };

  const importItem: McpExtraTool = {
    spec: {
      name: 'import_library_item',
      description:
        'Put one shape from an Excalidraw library into a note\'s drawing (a new drawing, or beside an existing one with `drawing`). Give the `library` from search_libraries and the `item` (its name, or its number from browse_library); ' +
        'if it is not found the choices are listed. The library and its authors are recorded in the drawing (MIT licence). Returns a picture. Do not use brand logos unless the user asked.',
      parameters: obj({
        id: noteId, library: { ...str, description: 'The "library" value from search_libraries, e.g. "author/name.excalidrawlib".' }, item: { ...str, description: 'Name of the item in that library.' },
        drawing: drawingNo, position: { type: 'string', enum: ['right', 'below'], description: 'Where to put it relative to the existing drawing (default right).' },
        scale: { type: 'number', description: 'Size factor, 1 = as the author drew it.' }, after_heading: where,
      }, ['id', 'library', 'item']),
    },
    run: async () => { throw new Error('unused'); },
    runRich: async a => {
      const id = String(a.id ?? '');
      const lib = String(a.library ?? '');
      const note = await read(id);
      const found = findLibraryItem(libraryItems(await libraryFile(fetchImpl, lib)), String(a.item ?? ''));
      if ('choices' in found) throw new Error(`No single item matches "${String(a.item)}". Give its number or name; browse_library shows a picture of them. Items: ${found.choices.join(' | ')}`);
      const scale = Math.min(4, Math.max(0.2, Number(a.scale ?? 1) || 1));
      const placed = placeLibraryItem(await restored(found.elements), 0, 0, scale);
      if (!placed.length) throw new Error('That item is empty.');
      const index = (await libraryIndex(fetchImpl).catch(() => [])).find(l => l.source === lib);
      const credit = `Excalidraw library "${index?.name ?? lib}" by ${(index?.authors ?? []).map(x => x.name).join(', ') || 'its authors'} (${LIBRARIES}/libraries/${lib}, MIT)`;
      const n = wanted(a);
      let scene: Scene;
      if (n !== undefined) {
        const old = drawingsIn(note.body).find(d => d.n === n)?.scene;
        if (!old) throw new Error(`The note has no readable drawing ${n}.`);
        const side = a.position === 'below' ? 'below' : 'right';
        scene = { ...old, source: old.source && old.source !== 'ergonotes' && !old.source.includes(credit) ? `${old.source}; ${credit}` : credit, elements: [...old.elements, ...placeBeside(old.elements, placed, side)] };
      } else scene = { ...emptyScene(credit), elements: placed };
      const at = await put(id, scene, n, typeof a.after_heading === 'string' ? a.after_heading : '');
      const b = boundsOf(placed);
      return show(scene, { drawing: at, added: placed.length, size: b ? { w: Math.round(b.w), h: Math.round(b.h) } : null, credit });
    },
  };

  // the core's `run` is what a client without images would call; these tools always answer through `runRich`
  return [draw, insertDiagram, readDrawing, searchLibraries, browseLibrary, importItem].map(t => (t.runRich ? { ...t, run: async (a: Record<string, unknown>) => (await t.runRich!(a)).text } : t));
}
