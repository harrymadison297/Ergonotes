// The preview panel: a note as the app shows it. It follows the editor and opens the notes a link points at.
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { renderNote } from './render';
import { chipFor, dayOf, habitOf } from './notes';
import { relToRoot, vaultRootFor } from './vault';

let panel: vscode.WebviewPanel | undefined;
let shown: vscode.Uri | undefined;

function html(webview: vscode.Webview, ctx: vscode.ExtensionContext, doc: vscode.TextDocument): string {
  const root = vaultRootFor(doc.uri);
  const dir = path.dirname(doc.uri.fsPath);
  const css = webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, 'media', 'preview.css'));
  const nonce = Math.random().toString(36).slice(2);
  const body = renderNote(doc.getText(), {
    resolveFile: src => webview.asWebviewUri(vscode.Uri.file(path.resolve(dir, src))).toString(),
    habitChip: href => {
      try {
        const target = path.resolve(dir, href);
        if (!root || !target.startsWith(root.fsPath)) return null;
        const h = habitOf(fs.readFileSync(target, 'utf8'), dayOf(new Date()));
        return h ? chipFor(h) : null;
      } catch { return null; }
    },
  });
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; media-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}"></head><body><article class="note">${body}</article>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.addEventListener('click', e => {
  const a = e.target.closest('a'); if (!a) return;
  e.preventDefault();
  if (a.dataset.open) vscode.postMessage({ open: a.dataset.open });
  else if (a.dataset.wiki) vscode.postMessage({ wiki: a.dataset.wiki });
  else if (a.dataset.external) vscode.postMessage({ external: a.href });
});
</script></body></html>`;
}

export function openPreview(ctx: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') { void vscode.window.showInformationMessage('Open a Markdown note first.'); return; }
  if (!panel) {
    panel = vscode.window.createWebviewPanel('ergonotesPreview', 'Preview', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media'), ...(vscode.workspace.workspaceFolders?.map(f => f.uri) ?? []), vscode.Uri.file(path.dirname(editor.document.uri.fsPath))] });
    panel.onDidDispose(() => { panel = undefined; shown = undefined; }, null, ctx.subscriptions);
    panel.webview.onDidReceiveMessage(async (m: { open?: string; wiki?: string; external?: string }) => {
      const base = shown ? path.dirname(shown.fsPath) : undefined;
      if (m.open && base) {
        const target = vscode.Uri.file(path.resolve(base, m.open));
        if (/\.md$/i.test(target.fsPath)) await vscode.window.showTextDocument(target, { viewColumn: vscode.ViewColumn.One });
        else await vscode.commands.executeCommand('vscode.open', target);
      } else if (m.wiki) {
        const root = shown ? vaultRootFor(shown) : null;
        const hits = root ? await vscode.workspace.findFiles(new vscode.RelativePattern(root.fsPath, `**/${m.wiki.split('/').pop()}.md`), '**/{.ergonotes,.trash,node_modules}/**', 5) : [];
        if (hits[0]) await vscode.window.showTextDocument(hits[0], { viewColumn: vscode.ViewColumn.One });
        else void vscode.window.showInformationMessage(`There is no note called “${m.wiki}” in this vault.`);
      } else if (m.external) void vscode.env.openExternal(vscode.Uri.parse(m.external));
    }, null, ctx.subscriptions);
  }
  update(ctx, editor.document);
  panel.reveal(undefined, true);
}

function update(ctx: vscode.ExtensionContext, doc: vscode.TextDocument) {
  if (!panel) return;
  shown = doc.uri;
  panel.title = `Preview: ${path.basename(doc.uri.fsPath)}`;
  panel.webview.html = html(panel.webview, ctx, doc);
}

export function followEditor(ctx: vscode.ExtensionContext) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const later = (doc: vscode.TextDocument) => { if (t) clearTimeout(t); t = setTimeout(() => update(ctx, doc), 150); };
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => { if (panel && shown && e.document.uri.toString() === shown.toString()) later(e.document); }),
    vscode.window.onDidChangeActiveTextEditor(e => { if (panel && e && e.document.languageId === 'markdown') update(ctx, e.document); }),
  );
}

export { relToRoot };
