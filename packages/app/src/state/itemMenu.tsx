// What the right-click menu of a Note or a Folder offers: one list for every place an item is shown (the Explorer, the
// sidebar tree, the note list, the cards), so they never disagree.
import { ClipboardPaste, Copy, CopyPlus, ExternalLink, FilePlus2, FolderOpen, FolderPlus, Link2, Pin, PinOff, Scissors, Trash2 } from 'lucide-react';
import { markdownLink, type ItemSummary } from '@ergonotes/core';
import type { MenuEntry } from '../components/ui';
import { canRevealInFolder, revealInFolder } from '../backend/tauriFs';
import { useApp } from './app';
import { useItemClip, useItemOps } from './itemClipboard';
import { useCommands } from './commands';

/** `[Title](Folder/Note.md)`: the standard Markdown link the app itself writes; a folder is just its path. */
export const markdownLinkTo = (it: Pick<ItemSummary, 'title' | 'filePath' | 'type'>): string =>
  it.type === 'note' ? markdownLink(it.title, it.filePath) : it.filePath;

export function useItemMenu() {
  const app = useApp();
  const ops = useItemOps();
  const clip = useItemClip();
  const cmds = useCommands();
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
  /** `selected`: the items picked in the view; when the one clicked is among several, the menu is about all of them. */
  return (it: ItemSummary, selected?: ItemSummary[]): MenuEntry[] => {
    const folder = it.type === 'folder';
    if (selected && selected.length > 1 && selected.some(x => x.id === it.id)) {
      const ids = selected.map(x => x.id);
      return [
        { title: `${selected.length} items` },
        { label: 'Copy', icon: <Copy size={16} />, kbd: cmds.hint('item.copy'), onClick: () => ops.copy(ids) },
        { label: 'Cut', icon: <Scissors size={16} />, kbd: cmds.hint('item.cut'), onClick: () => ops.cut(ids) },
        { label: 'Duplicate', icon: <CopyPlus size={16} />, onClick: () => void ops.duplicate(selected) },
        { sep: true },
        { label: 'Move to trash', icon: <Trash2 size={16} />, danger: true, onClick: () => void ops.trash(selected) },
      ];
    }
    return [
      { label: 'Open', icon: <FolderOpen size={16} />, onClick: () => open(it) },
      ...(folder ? [
        { label: 'New note here', icon: <FilePlus2 size={16} />, onClick: () => void app.newNote({ parent: it.id }) },
        { label: 'New subfolder', icon: <FolderPlus size={16} />, onClick: () => app.setDialog({ kind: 'newFolder', parent: it.id }) },
      ] : []),
      { sep: true },
      { label: 'Rename…', onClick: () => app.setDialog({ kind: 'rename', id: it.id }) },
      { label: 'Move to…', onClick: () => app.setDialog({ kind: 'move', id: it.id }) },
      { label: 'Duplicate', icon: <CopyPlus size={16} />, onClick: () => void ops.duplicate([it]) },
      { sep: true },
      { label: 'Copy', icon: <Copy size={16} />, kbd: cmds.hint('item.copy'), onClick: () => ops.copy([it.id]) },
      { label: 'Cut', icon: <Scissors size={16} />, kbd: cmds.hint('item.cut'), onClick: () => ops.cut([it.id]) },
      ...(folder ? [{ label: 'Paste here', icon: <ClipboardPaste size={16} />, kbd: cmds.hint('item.paste'), disabled: !clip, onClick: () => void ops.paste(it.id) }] : []),
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
