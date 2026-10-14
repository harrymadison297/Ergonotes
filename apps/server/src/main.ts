import { resolve } from 'node:path';
import { startServer } from './server.ts';

const env = process.env;
const port = Number(env.PORT ?? 8080);
const dataDir = resolve(env.ERGONOTES_DATA ?? './data');
const webDir = env.ERGONOTES_WEB ? resolve(env.ERGONOTES_WEB) : resolve(import.meta.dirname, '../../../packages/app/dist');

const running = await startServer({
  port,
  host: env.HOST ?? '0.0.0.0',
  dataDir,
  webDir,
  autoUnlockPassword: env.ERGONOTES_PASSWORD,
  allowInsecure: env.ERGONOTES_ALLOW_INSECURE === '1',
  log: m => console.log(`[ergonotes] ${m}`),
});
console.log(`[ergonotes] data: ${dataDir}`);
console.log(`[ergonotes] web:  ${webDir}`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void running.close().then(() => process.exit(0)));
