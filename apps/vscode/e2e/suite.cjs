const vscode = require('vscode');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 8000) { const end = Date.now() + ms; for (;;) { const v = await f(); if (v) return v; if (Date.now() > end) return v; await sleep(150); } }

exports.run = async function run() {
  const results = [];
  const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
  const ws = vscode.workspace.workspaceFolders[0].uri.fsPath;

  const ext = vscode.extensions.getExtension('ergonotes.ergonotes-vscode');
  check('the extension is found', !!ext);
  const planDoc = await vscode.workspace.openTextDocument(path.join(ws, 'Plan.md'));
  await vscode.window.showTextDocument(planDoc);
  await ext.activate();
  const cmds = await vscode.commands.getCommands(true);
  const mine = cmds.filter(c => c.startsWith('ergonotes.'));
  check('its commands are registered', mine.length >= 8, mine.join(', '));

  // completion after [[ gives the notes of the vault, as Markdown links
  const ed = vscode.window.activeTextEditor;
  await ed.edit(b => b.insert(new vscode.Position(planDoc.lineCount, 0), '\nSee [[Ru'));
  const pos = new vscode.Position(planDoc.lineCount - 1, planDoc.lineAt(planDoc.lineCount - 1).text.length);
  const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', planDoc.uri, pos);
  const labels = list.items.map(i => (typeof i.label === 'string' ? i.label : i.label.label));
  const run = list.items.find(i => (typeof i.label === 'string' ? i.label : i.label.label) === 'Run');
  check('[[ offers the notes of the vault', labels.includes('Run'), labels.join(','));
  check('the completion is a relative Markdown link', run && run.insertText === '[Run](Habits/Run.md)', run && String(run.insertText));
  const at = await (async () => {
    await ed.edit(b => b.replace(new vscode.Range(pos.line, 0, pos.line, 999), 'Did @Ru'));
    const p2 = new vscode.Position(pos.line, 7);
    const l = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', planDoc.uri, p2);
    return l.items.map(i => (typeof i.label === 'string' ? i.label : i.label.label));
  })();
  check('@ offers habits first', at[0] === 'Run', at.join(','));

  // a task and a due date on a line
  await ed.edit(b => b.replace(new vscode.Range(pos.line, 0, pos.line, 999), 'buy milk'));
  ed.selection = new vscode.Selection(pos.line, 0, pos.line, 0);
  await vscode.commands.executeCommand('ergonotes.insertTask');
  check('Insert Task makes a task of the line', planDoc.lineAt(pos.line).text === '- [ ] buy milk', planDoc.lineAt(pos.line).text);

  // the habit note: status context and check-in
  const habit = await vscode.workspace.openTextDocument(path.join(ws, 'Habits', 'Run.md'));
  await vscode.window.showTextDocument(habit);
  await sleep(300);
  await vscode.commands.executeCommand('ergonotes.checkIn');
  const ok = await until(() => /@done\(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\)/.test(habit.getText()));
  check('Check In writes a done line into the log', !!ok, habit.getText().split('\n').slice(-4).join(' | '));
  const before = habit.getText();
  assert.ok(before.startsWith('---\nhabit: true'));
  await vscode.commands.executeCommand('ergonotes.checkIn');
  await sleep(300);
  check('a second check-in adds another line', (habit.getText().match(/@done\(/g) || []).length === 2);

  // the preview opens beside the editor
  await vscode.window.showTextDocument(planDoc);
  await vscode.commands.executeCommand('ergonotes.openPreview');
  await sleep(1200);
  const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs.map(t => t.label));
  check('the preview panel is open', tabs.some(t => /Preview/.test(t)), tabs.join(','));

  fs.writeFileSync(process.env.ERGO_E2E_RESULTS || path.join(require('node:os').tmpdir(), 'ergonotes-vscode-e2e.txt'), results.join('\n'));
  if (results.some(r => r.startsWith('FAIL'))) throw new Error(results.filter(r => r.startsWith('FAIL')).join('\n'));
};
