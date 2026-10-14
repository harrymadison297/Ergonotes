// One-way export of the current notes as plain Markdown files, so the vault is readable outside the app (ADR 0002).
import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Vault } from '@ergonotes/core';

const MARKER = '.ergonotes-mirror';
const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^\.+/, '').trim().slice(0, 120) || 'untitled';

export class Mirror {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private off: (() => void) | null = null;
  private running = false;
  private vault: Vault;
  private dir: string;
  constructor(vault: Vault, dir: string) { this.vault = vault; this.dir = dir; }

  start() {
    if (this.off) return;
    this.off = this.vault.onEvent(e => { if (e.type === 'items') this.schedule(); });
    this.schedule();
  }
  /** Stop watching; resolves once a write in progress has finished. */
  async stop() {
    this.off?.(); this.off = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.running) await new Promise(r => setTimeout(r, 10));
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.write(), 2000);
  }

  private lastDigest = '';

  async write() {
    if (this.running) { this.schedule(); return; }
    this.running = true;
    try {
      const items = (await this.vault.listItems()).filter(i => !i.inTrash);
      const byId = new Map(items.map(i => [i.id, i]));
      const pathOf = (id: string): string => {
        const parts: string[] = [];
        const seen = new Set<string>();
        let cur = byId.get(id)?.parent ?? null;
        while (cur && !seen.has(cur)) { seen.add(cur); const p = byId.get(cur); if (!p) break; parts.unshift(safe(p.title)); cur = p.parent; }
        return parts.join('/');
      };
      // everything is built in memory first, so a failure half way never leaves a half-written mirror behind
      const dirs: string[] = [];
      const files = new Map<string, string>();
      for (const it of items) {
        if (it.type === 'folder') { dirs.push(join(pathOf(it.id), safe(it.title))); continue; }
        const ex = await this.vault.exportNote(it.id, 'md');
        const name = `${safe(ex.filename.replace(/\.md$/, ''))}.md`;
        let rel = join(pathOf(it.id), name);
        for (let n = 2; files.has(rel); n++) rel = join(pathOf(it.id), name.replace(/\.md$/, ` (${n}).md`));
        files.set(rel, ex.content);
      }
      // nothing changed since the last write: leave the folder alone
      const digest = createHash('sha256').update(JSON.stringify([dirs.sort(), [...files].sort()])).digest('hex');
      if (digest === this.lastDigest) return;

      // only ever replace a folder this mirror created (marker file), or an empty one
      const existing = await readdir(this.dir).catch(() => null);
      if (existing && existing.length > 0 && !existing.includes(MARKER)) return;
      const tmp = `${this.dir}.writing-${process.pid}`;
      await rm(tmp, { recursive: true, force: true });
      await mkdir(tmp, { recursive: true });
      await writeFile(join(tmp, MARKER), 'Written by Ergonotes; the contents of this folder are replaced on every change.\n');
      for (const d of dirs) await mkdir(join(tmp, d), { recursive: true });
      for (const [rel, content] of files) {
        const full = join(tmp, rel);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, content);
      }
      await rm(this.dir, { recursive: true, force: true });
      await rename(tmp, this.dir);
      this.lastDigest = digest;
    } catch { /* locked or mid-change: next event retries */ } finally { this.running = false; }
  }
}
