import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  asTask, dayOf, eventToken, habitOf, isClock, isDay, minimalEdit, newHabitText, timeOf, withCheckIn, withRemark, withToken, chipFor, type HabitView,
} from './notes';
import { vaultRootFor } from './vault';
import { openPreview } from './preview';

const editorOf = () => vscode.window.activeTextEditor;

async function ask(prompt: string, value: string, validate?: (v: string) => string | undefined): Promise<string | undefined> {
  return vscode.window.showInputBox({ prompt, value, validateInput: validate });
}

/** Replace what is different between the document and `text` with the least change, so the cursor and undo stay where they are. */
async function setText(doc: vscode.TextDocument, text: string): Promise<boolean> {
  const e = minimalEdit(doc.getText(), text);
  if (!e) return true;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text);
  return vscode.workspace.applyEdit(edit);
}

export const habitOfDoc = (doc: vscode.TextDocument): HabitView | null => (doc.languageId === 'markdown' ? habitOf(doc.getText(), dayOf(new Date())) : null);

async function onLine(f: (line: string) => string) {
  const ed = editorOf();
  if (!ed) return;
  await ed.edit(b => {
    for (const sel of ed.selections) {
      const line = ed.document.lineAt(sel.active.line);
      b.replace(line.range, f(line.text));
    }
  });
}

export function registerCommands(ctx: vscode.ExtensionContext, refreshHabit: () => void) {
  const reg = (id: string, fn: () => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('ergonotes.openPreview', () => openPreview(ctx));
  reg('ergonotes.insertTask', () => onLine(asTask));
  reg('ergonotes.insertDue', async () => {
    const v = await ask('Due date (YYYY-MM-DD, optionally THH:MM)', dayOf(new Date()), s => (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s) ? undefined : 'A date such as 2026-10-20 or 2026-10-20T09:00'));
    if (v) await onLine(l => withToken(l, 'due', v));
  });
  reg('ergonotes.insertRemind', async () => {
    const v = await ask('Reminder (YYYY-MM-DDTHH:MM)', `${dayOf(new Date())}T09:00`, s => (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s) ? undefined : 'A date and time such as 2026-10-20T09:00'));
    if (v) await onLine(l => withToken(l, 'remind', v));
  });
  reg('ergonotes.insertEvent', async () => {
    const ed = editorOf();
    if (!ed) return;
    const date = await ask('Event date (YYYY-MM-DD)', dayOf(new Date()), s => (isDay(s) ? undefined : 'A date such as 2026-10-20'));
    if (!date) return;
    const start = await ask('Start time (HH:MM, empty for an all-day event)', '', s => (!s || isClock(s) ? undefined : 'A time such as 09:30'));
    if (start === undefined) return;
    const end = start ? await ask('End time (HH:MM, optional)', '', s => (!s || isClock(s) ? undefined : 'A time such as 10:30')) : '';
    if (end === undefined) return;
    const token = eventToken(date, start || undefined, end || undefined);
    await ed.edit(b => {
      const before = ed.document.lineAt(ed.selection.active).text.slice(0, ed.selection.active.character);
      b.replace(ed.selection, (before && !/\s$/.test(before) ? ' ' : '') + token);
    });
  });

  reg('ergonotes.newHabit', async () => {
    const dir = vscode.window.activeTextEditor ? vaultRootFor(vscode.window.activeTextEditor.document.uri) : vscode.workspace.workspaceFolders?.[0] ? { fsPath: vscode.workspace.workspaceFolders[0].uri.fsPath } : null;
    if (!dir) { void vscode.window.showWarningMessage('Open the vault folder first.'); return; }
    const title = await ask('Name of the habit', '', s => (s.trim() && !/[\\/:*?"<>|]/.test(s) ? undefined : 'A name for the file, without \\ / : * ? " < > |'));
    if (!title) return;
    const target = await ask('How many times', '1', s => (/^\d+$/.test(s) && +s >= 1 && +s <= 99 ? undefined : 'A number from 1 to 99'));
    if (!target) return;
    const per = await vscode.window.showQuickPick(['1 day', '3 days', '5 days', '7 days'], { placeHolder: `${target} time${target === '1' ? '' : 's'} in…` });
    if (!per) return;
    const folder = vscode.workspace.getConfiguration('ergonotes').get<string>('habitFolder', '.habits');
    const uri = vscode.Uri.file(path.join(dir.fsPath, folder, `${title.trim()}.md`));
    try { await vscode.workspace.fs.stat(uri); void vscode.window.showWarningMessage('A note with that name already exists.'); await vscode.window.showTextDocument(uri); return; } catch { /* free */ }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(newHabitText({ title, target: +target, per: parseInt(per, 10) as 1 | 3 | 5 | 7, start: dayOf(new Date()) })));
    await vscode.window.showTextDocument(uri);
  });

  reg('ergonotes.checkIn', async () => {
    const ed = editorOf();
    const h = ed && habitOfDoc(ed.document);
    if (!ed || !h) { void vscode.window.showInformationMessage('Open a habit note to check in.'); return; }
    const now = new Date();
    if (await setText(ed.document, withCheckIn(ed.document.getText(), dayOf(now), timeOf(now)))) {
      refreshHabit();
      const after = habitOfDoc(ed.document);
      if (after) void vscode.window.setStatusBarMessage(`Checked in: ${chipFor(after).text}`, 4000);
    }
  });

  reg('ergonotes.habitRemark', async () => {
    const ed = editorOf();
    if (!ed || !habitOfDoc(ed.document)) { void vscode.window.showInformationMessage('Open a habit note first.'); return; }
    const day = await ask('Which day (YYYY-MM-DD)', dayOf(new Date()), s => (isDay(s) ? undefined : 'A date such as 2026-10-20'));
    if (!day) return;
    const text = await ask('Remark (empty removes it)', '');
    if (text === undefined) return;
    await setText(ed.document, withRemark(ed.document.getText(), day, text));
    refreshHabit();
  });
}
