// Mermaid text -> the scene of a drawing block (what the Excalidraw board stores).
const FENCE = /^\s*```(?:mermaid)?\s*\n([\s\S]*?)\n```\s*$/;

export async function mermaidToScene(source: string): Promise<{ type: 'excalidraw'; version: 2; elements: unknown[]; appState: Record<string, never>; files: Record<string, unknown> }> {
  const text = (FENCE.exec(source)?.[1] ?? source).trim();
  if (!text) throw new Error('The Mermaid source is empty.');
  const [{ parseMermaidToExcalidraw }, { convertToExcalidrawElements }] = await Promise.all([
    import('@excalidraw/mermaid-to-excalidraw'),
    import('@excalidraw/excalidraw'),
  ]);
  let parsed;
  try { parsed = await parseMermaidToExcalidraw(text, { themeVariables: { fontSize: '16px' } }); }
  catch (e) { throw new Error(`Mermaid could not read that diagram: ${e instanceof Error ? e.message : String(e)}. Fix the syntax and try again.`); }
  const elements = convertToExcalidrawElements(parsed.elements as never, { regenerateIds: false }) as unknown[];
  return { type: 'excalidraw', version: 2, elements, appState: {}, files: (parsed.files ?? {}) as Record<string, unknown> };
}

/** The Markdown block the editor stores for a drawing. */
export const drawingBlock = (scene: unknown): string => '```ergonote-excalidraw\n' + JSON.stringify(scene).replace(/\n/g, ' ') + '\n```';
