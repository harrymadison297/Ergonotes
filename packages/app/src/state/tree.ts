/** Folders from the top level down to `parent`, for breadcrumbs and search paths. */
export function folderChain(byId: Map<string, { id: string; title: string; parent: string | null }>, parent: string | null | undefined): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  const seen = new Set<string>();
  let cur = parent ?? null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const f = byId.get(cur);
    if (!f) break;
    out.unshift({ id: f.id, title: f.title });
    cur = f.parent;
  }
  return out;
}
