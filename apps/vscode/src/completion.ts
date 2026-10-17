// `[[` and `@` complete to a link to a note (Habits first after `@`), written as the app writes it: a Markdown link.
import * as vscode from 'vscode';
import { habitFiles, noteRefs, relToRoot, vaultRootFor } from './vault';
import { dirOf, markdownLink, matchNotes } from './notes';

export function registerCompletion(ctx: vscode.ExtensionContext) {
  const provider: vscode.CompletionItemProvider = {
    async provideCompletionItems(doc, pos) {
      const before = doc.lineAt(pos).text.slice(0, pos.character);
      const wiki = /\[\[([^\]\n]*)$/.exec(before);
      const at = wiki ? null : /(?:^|\s)@([^\s@()]*)$/.exec(before);
      const query = wiki?.[1] ?? at?.[1];
      if (query === undefined) return undefined;
      const root = vaultRootFor(doc.uri);
      if (!root) return undefined;
      const here = relToRoot(root, doc.uri);
      const fromDir = dirOf(here);
      // what is replaced: the `[[` and what follows it, or the `@` and what follows it
      const typed = (wiki ? 2 : 1) + query.length;
      const range = new vscode.Range(new vscode.Position(pos.line, pos.character - typed), pos);
      const habits = new Set((await habitFiles(root)).map(h => h.path));
      const notes = matchNotes(await noteRefs(root), query).filter(n => n.path !== here);
      const ordered = wiki ? notes : [...notes.filter(n => habits.has(n.path)), ...notes.filter(n => !habits.has(n.path))];
      return ordered.map((n, i) => {
        const isHabit = habits.has(n.path);
        const it = new vscode.CompletionItem(n.title, isHabit ? vscode.CompletionItemKind.Event : vscode.CompletionItemKind.File);
        it.detail = isHabit ? `Habit · ${n.path}` : n.path;
        it.insertText = markdownLink(fromDir, n);
        it.range = range;
        it.filterText = `${wiki ? '[[' : '@'}${n.title}`;
        it.sortText = String(i).padStart(4, '0');
        return it;
      });
    },
  };
  ctx.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'markdown' }, provider, '[', '@'));
}
