import { resolve } from 'node:path';
import { startServer } from './server.ts';

const env = process.env;
const port = Number(env.PORT ?? 8080);
const dataDir = resolve(env.ERGONOTES_DATA ?? './data');
const vaultDir = env.ERGONOTES_VAULT_DIR ? resolve(env.ERGONOTES_VAULT_DIR) : undefined;
const webDir = env.ERGONOTES_WEB ? resolve(env.ERGONOTES_WEB) : resolve(import.meta.dirname, '../../../packages/app/dist');

const running = await startServer({
  port,
  host: env.HOST ?? '0.0.0.0',
  dataDir,
  vaultDir,
  webDir,
  autoUnlockPassword: env.ERGONOTES_PASSWORD,
  allowInsecure: env.ERGONOTES_ALLOW_INSECURE === '1',
  trustProxy: env.ERGONOTES_TRUST_PROXY === '1',
  setupToken: env.ERGONOTES_SETUP_TOKEN || undefined,
  folderStoreRoot: env.ERGONOTES_FOLDER_STORE_ROOT ? resolve(env.ERGONOTES_FOLDER_STORE_ROOT) : undefined,
  log: m => console.log(`[ergonotes] ${m}`),
});
console.log(`[ergonotes] data: ${dataDir}`);
console.log(`[ergonotes] vault: ${vaultDir ?? resolve(dataDir, 'vault')}`);
console.log(`[ergonotes] web:  ${webDir}`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void running.close().then(() => process.exit(0)));
