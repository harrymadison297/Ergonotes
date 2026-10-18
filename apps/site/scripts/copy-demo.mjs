// Put the built web demo (packages/app, `vite build --mode demo`) at /demo/ of the site.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../../../packages/app/dist-demo', import.meta.url));
const to = fileURLToPath(new URL('../dist/demo', import.meta.url));
if (!existsSync(from)) {
  console.error('The web demo is not built. Run `npm run build:site` from the repo root (it builds the demo first).');
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log('demo copied to', to);
