// One-way export of the current notes as plain Markdown files, so the vault is readable outside the app (ADR 0002).
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
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
  stop() { this.off?.(); this.off = null; if (this.timer) clearTimeout(this.timer); }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.write(), 2000);
  }

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
      // only ever wipe a folder this mirror created (marker file), or an empty one
      const marker = join(this.dir, MARKER);
      const existing = await readdir(this.dir).catch(() => null);
      if (existing && existing.length > 0 && !existing.includes(MARKER)) return;
      await rm(this.dir, { recursive: true, force: true });
      await mkdir(this.dir, { recursive: true });
      await writeFile(marker, 'Written by Ergonotes; the contents of this folder are replaced on every change.\n');
      const used = new Set<string>();
      for (const it of items) {
        if (it.type === 'folder') { await mkdir(join(this.dir, pathOf(it.id), safe(it.title)), { recursive: true }); continue; }
        const ex = await this.vault.exportNote(it.id, 'md');
        let rel = join(pathOf(it.id), ex.filename);
        for (let n = 2; used.has(rel); n++) rel = join(pathOf(it.id), ex.filename.replace(/\.md$/, ` (${n}).md`));
        used.add(rel);
        const full = join(this.dir, rel);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, ex.content);
      }
    } catch { /* locked or mid-change: next event retries */ } finally { this.running = false; }
  }
}
