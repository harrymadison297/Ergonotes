// Line diff for the conflict UI (git-style hunks). Notes are small, so a plain LCS is enough.
export type DiffOp = { type: 'same' | 'del' | 'add'; lines: string[] };

export function lineDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length, m = b.length;
  // trim common prefix / suffix first: most diffs are local
  let s = 0;
  while (s < n && s < m && a[s] === b[s]) s++;
  let e = 0;
  while (e < n - s && e < m - s && a[n - 1 - e] === b[m - 1 - e]) e++;
  const A = a.slice(s, n - e), B = b.slice(s, m - e);
  const ops: DiffOp[] = [];
  const push = (type: DiffOp['type'], line: string) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.lines.push(line); else ops.push({ type, lines: [line] });
  };
  for (let i = 0; i < s; i++) push('same', a[i]);
  if (A.length * B.length > 4_000_000) {
    for (const l of A) push('del', l);
    for (const l of B) push('add', l);
  } else {
    const L: number[][] = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
    for (let i = A.length - 1; i >= 0; i--) {
      for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
    let i = 0, j = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) { push('same', A[i]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) push('del', A[i++]);
      else push('add', B[j++]);
    }
    while (i < A.length) push('del', A[i++]);
    while (j < B.length) push('add', B[j++]);
  }
  for (let i = n - e; i < n; i++) push('same', a[i]);
  return ops;
}

/** Group diff ops into hunks of changes with the unchanged context around them. */
export interface Hunk { id: number; del: string[]; add: string[] }
export function toHunks(ops: DiffOp[]): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  for (const op of ops) {
    if (op.type === 'same') { cur = null; continue; }
    if (!cur) { cur = { id: hunks.length, del: [], add: [] }; hunks.push(cur); }
    if (op.type === 'del') cur.del.push(...op.lines); else cur.add.push(...op.lines);
  }
  return hunks;
}

/**
 * Build a text from `local` and `other` taking each hunk from `other` when `takeOther[hunkId]` is true.
 * Hunks are those of lineDiff(local, other).
 */
export function applyHunks(local: string[], other: string[], takeOther: Record<number, boolean>): string[] {
  const out: string[] = [];
  let hunk = -1;
  let inChange = false;
  for (const op of lineDiff(local, other)) {
    if (op.type === 'same') { out.push(...op.lines); inChange = false; continue; }
    if (!inChange) { hunk++; inChange = true; }
    const take = takeOther[hunk] === true;
    if (op.type === 'del' && !take) out.push(...op.lines);
    if (op.type === 'add' && take) out.push(...op.lines);
  }
  return out;
}
