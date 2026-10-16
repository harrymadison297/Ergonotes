// What the right-click menu of a Note or a Folder offers: one list for every place an item is shown (the Explorer, the
// sidebar tree, the note list, the cards), so they never disagree.
import { FilePlus2, FolderOpen, FolderPlus, Link2, Pin, PinOff, Trash2, Copy, ExternalLink } from 'lucide-react';
import type { ItemSummary } from '@ergonotes/core';
import type { MenuEntry } from '../components/ui';
import { canRevealInFolder, revealInFolder } from '../backend/tauriFs';
import { useApp } from './app';

/** `[Title](Folder/Note.md)`: the standard Markdown link the app itself writes (spaces escaped). */
export const markdownLinkTo = (it: Pick<ItemSummary, 'title' | 'filePath' | 'type'>): string =>
  it.type === 'note' ? `[${it.title}](${it.filePath.split('/').map(encodeURIComponent).join('/')})` : it.filePath;

export function useItemMenu() {
  const app = useApp();
  const open = (it: ItemSummary) => {
    if (it.type === 'folder') app.go({ name: 'notes', folder: it.id });
    else app.go({ name: 'notes', note: it.id, folder: it.parent ?? undefined });
  };
  const copyText = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); app.toast(`${what} copied`); } catch { app.toast(`Could not copy the ${what.toLowerCase()}`, 'error'); }
  };
  const showInFolder = async (it: ItemSummary) => {
    try { await revealInFolder(it.filePath); } catch (e) { app.toast(e instanceof Error ? e.message : String(e), 'error'); }
  };
  const duplicate = async (it: ItemSummary) => {
    const copy = await app.run(app.api.duplicate(it.id));
    if (!copy) return;
    await app.refresh();
    app.toast(`Duplicated “${it.title}”`, 'info', { label: 'Open', run: () => open(copy) });
  };

  return (it: ItemSummary): MenuEntry[] => {
    const folder = it.type === 'folder';
    return [
      { label: 'Open', icon: <FolderOpen size={16} />, onClick: () => open(it) },
      ...(folder ? [
        { label: 'New note here', icon: <FilePlus2 size={16} />, onClick: () => void app.newNote({ parent: it.id }) },
        { label: 'New subfolder', icon: <FolderPlus size={16} />, onClick: () => app.setDialog({ kind: 'newFolder', parent: it.id }) },
      ] : []),
      { sep: true },
      { label: 'Rename…', onClick: () => app.setDialog({ kind: 'rename', id: it.id }) },
      { label: 'Move to…', onClick: () => app.setDialog({ kind: 'move', id: it.id }) },
      { label: 'Duplicate', icon: <Copy size={16} />, onClick: () => void duplicate(it) },
      { sep: true },
      { label: folder ? 'Copy path' : 'Copy link', icon: <Link2 size={16} />, onClick: () => void copyText(markdownLinkTo(it), folder ? 'Path' : 'Link') },
      ...(canRevealInFolder() ? [{ label: 'Show in folder', icon: <ExternalLink size={16} />, onClick: () => void showInFolder(it) }] : []),
      ...(folder ? [{ label: 'Use for new captures', onClick: async () => { await app.run(app.api.setSettings({ captureFolder: it.id })); await app.refresh(); app.toast(`New captures go to “${it.title}”`); } }] : []),
      ...(!folder ? [{ label: it.pinned ? 'Unpin' : 'Pin to sidebar', icon: it.pinned ? <PinOff size={16} /> : <Pin size={16} />,
        onClick: async () => { await app.run(app.api.setPinned(it.id, !it.pinned)); await app.refresh(); } }] : []),
      { sep: true },
      { label: 'Move to trash', icon: <Trash2 size={16} />, danger: true, onClick: () => void app.trashItem(it.id) },
    ];
  };
}
