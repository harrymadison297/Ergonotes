import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'notes'; folder?: string; tag?: string; note?: string; q?: string }
  | { name: 'tasks'; note?: string; task?: number }
  | { name: 'calendar'; note?: string; day?: string }
  | { name: 'files'; file?: string }
  | { name: 'folders' }
  | { name: 'trash'; note?: string }
  | { name: 'conflicts'; note?: string }
  | { name: 'more' };

export function parseHash(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const p = new URLSearchParams(query);
  const seg = path.split('/').filter(Boolean);
  switch (seg[0]) {
    case 'notes': return { name: 'notes', folder: p.get('folder') ?? undefined, tag: p.get('tag') ?? undefined, note: seg[1], q: p.get('q') ?? undefined };
    case 'tasks': return { name: 'tasks', note: seg[1], task: seg[2] !== undefined && /^\d+$/.test(seg[2]) ? Number(seg[2]) : undefined };
    case 'calendar': return { name: 'calendar', note: seg[1], day: p.get('day') ?? undefined };
    case 'files': return { name: 'files', file: seg[1] };
    case 'folders': return { name: 'folders' };
    case 'trash': return { name: 'trash', note: seg[1] };
    case 'conflicts': return { name: 'conflicts', note: seg[1] };
    case 'more': return { name: 'more' };
    default: return { name: 'home' };
  }
}

export function href(r: Route): string {
  const q = new URLSearchParams();
  switch (r.name) {
    case 'home': return '#/';
    case 'notes':
      if (r.folder) q.set('folder', r.folder);
      if (r.tag) q.set('tag', r.tag);
      if (r.q) q.set('q', r.q);
      return `#/notes${r.note ? '/' + r.note : ''}${q.size ? '?' + q.toString() : ''}`;
    case 'tasks': return `#/tasks${r.note ? '/' + r.note : ''}${r.note && r.task !== undefined ? '/' + r.task : ''}`;
    case 'calendar':
      if (r.day) q.set('day', r.day);
      return `#/calendar${r.note ? '/' + r.note : ''}${q.size ? '?' + q.toString() : ''}`;
    case 'files': return `#/files${r.file ? '/' + r.file : ''}`;
    case 'folders': return '#/folders';
    case 'trash': return `#/trash${r.note ? '/' + r.note : ''}`;
    case 'conflicts': return `#/conflicts${r.note ? '/' + r.note : ''}`;
    case 'more': return '#/more';
  }
}

/** Link to a note, opened inside its folder. */
export const noteHref = (n: { id: string; parent: string | null }): string => href({ name: 'notes', note: n.id, folder: n.parent ?? undefined });

export function useRoute(): [Route, (r: Route, replace?: boolean) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (r: Route, replace = false) => {
    const h = href(r);
    if (replace) history.replaceState(null, '', h); else location.hash = h;
    setRoute(r);
  };
  return [route, go];
}
