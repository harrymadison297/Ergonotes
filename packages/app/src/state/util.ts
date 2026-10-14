export function relTime(iso: string | number | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 45) return 'a few seconds ago';
  if (s < 90) return '1 min ago';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h > 1 ? 's' : ''} ago`;
  const d = new Date(t);
  const today = new Date(now);
  const y = new Date(now - 86400e3);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  const opts: Intl.DateTimeFormatOptions = d.getFullYear() === today.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
  return d.toLocaleDateString('en', opts);
}

export function dueLabel(due: string, now = new Date()): { text: string; overdue: boolean; today: boolean } {
  const d = new Date(due.length <= 10 ? due + 'T23:59:59' : due);
  if (Number.isNaN(d.getTime())) return { text: due, overdue: false, today: false };
  const hasTime = due.length > 10;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - startToday.getTime()) / 86400e3);
  const time = hasTime ? d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) : '';
  const overdue = d.getTime() < now.getTime() && !(dayDiff === 0 && !hasTime);
  if (dayDiff === 0) return { text: `Due today${time ? ', ' + time : ''}`, overdue, today: true };
  if (dayDiff === -1) return { text: 'Due yesterday', overdue: true, today: false };
  if (dayDiff === 1) return { text: `Due tomorrow${time ? ', ' + time : ''}`, overdue: false, today: false };
  return { text: `Due ${d.toLocaleDateString('en', { month: 'short', day: 'numeric' })}${time ? ', ' + time : ''}`, overdue: dayDiff < 0, today: false };
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): ((...a: A) => void) & { flush(): void; cancel(): void } {
  let t: ReturnType<typeof setTimeout> | null = null;
  let last: A | null = null;
  const run = () => { t = null; if (last) { const a = last; last = null; fn(...a); } };
  const d = ((...a: A) => { last = a; if (t) clearTimeout(t); t = setTimeout(run, ms); }) as ((...a: A) => void) & { flush(): void; cancel(): void };
  d.flush = () => { if (t) { clearTimeout(t); run(); } };
  d.cancel = () => { if (t) clearTimeout(t); t = null; last = null; };
  return d;
}

export function isoDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function download(filename: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function classNames(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}
