// Runs suite.cjs inside a real VS Code (downloaded by @vscode/test-electron) with the extension loaded.
// usage: node run.cjs   (tools/e2e-vscode.sh does it in the Playwright image, with a virtual display)
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { runTests } = require('@vscode/test-electron');

(async () => {
  const dev = path.resolve(__dirname, '..');
  // the suite edits the notes it opens: it works on a copy
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ergonotes-ws-'));
  fs.cpSync(path.join(__dirname, 'workspace'), ws, { recursive: true });
  fs.mkdirSync(path.join(ws, '.ergonotes'), { recursive: true });
  try {
    await runTests({
      version: 'stable', extensionDevelopmentPath: dev, extensionTestsPath: path.join(__dirname, 'suite.cjs'),
      launchArgs: [ws, '--disable-extensions', '--no-sandbox', '--disable-gpu', '--disable-workspace-trust', `--user-data-dir=${path.join(os.tmpdir(), 'ergonotes-vsc-user')}`],
    });
    console.log(fs.readFileSync(process.env.ERGO_E2E_RESULTS || path.join(os.tmpdir(), 'ergonotes-vscode-e2e.txt'), 'utf8'));
  } catch (e) { console.error('FAILED', e.message); process.exit(1); }
})();
