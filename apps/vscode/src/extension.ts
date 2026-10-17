import * as vscode from 'vscode';
import { registerCommands, habitOfDoc } from './commands';
import { registerCompletion } from './completion';
import { followEditor } from './preview';
import { chipFor } from './notes';

/** A habit note shows where it stands in the status bar; a click checks in. */
function habitStatusBar(ctx: vscode.ExtensionContext): () => void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.command = 'ergonotes.checkIn';
  ctx.subscriptions.push(item);
  const refresh = () => {
    const ed = vscode.window.activeTextEditor;
    const h = ed && vscode.workspace.getConfiguration('ergonotes').get<boolean>('showHabitInStatusBar', true) ? habitOfDoc(ed.document) : null;
    void vscode.commands.executeCommand('setContext', 'ergonotes.isHabit', !!(ed && habitOfDoc(ed.document)));
    if (!h) { item.hide(); return; }
    item.text = `$(check) ${chipFor(h).text}`;
    item.tooltip = h.nudge ?? 'Click to check in';
    item.show();
  };
  ctx.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.workspace.onDidChangeTextDocument(e => { if (e.document === vscode.window.activeTextEditor?.document) refresh(); }),
  );
  refresh();
  return refresh;
}

export function activate(ctx: vscode.ExtensionContext) {
  const refresh = habitStatusBar(ctx);
  registerCommands(ctx, refresh);
  registerCompletion(ctx);
  followEditor(ctx);
}

export function deactivate() { /* nothing is kept */ }
