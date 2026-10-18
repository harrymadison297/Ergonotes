// Finds the Ergonotes desktop app's MCP endpoint. The app writes `mcp-endpoint.json` (the url and the default token, readable
// only by the user) beside its settings; this reads it, so nothing has to be configured by hand.
// Override: ERGONOTES_MCP_URL and ERGONOTES_MCP_TOKEN, or ERGONOTES_MCP_FILE for another endpoint file.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const APP_ID = 'app.ergonotes.notes';

/** The folder where the app keeps its settings on this computer. */
export function configDir(env = process.env, platform = process.platform) {
  if (platform === 'win32') return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), APP_ID);
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', APP_ID);
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), APP_ID);
}

/** `{ url, token }`, or `{ error }` saying what is missing. */
export function readEndpoint(env = process.env) {
  if (env.ERGONOTES_MCP_URL && env.ERGONOTES_MCP_TOKEN) return { url: env.ERGONOTES_MCP_URL, token: env.ERGONOTES_MCP_TOKEN };
  const file = env.ERGONOTES_MCP_FILE || join(configDir(env), 'mcp-endpoint.json');
  let j;
  try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { return { error: `no endpoint file at ${file}: the Ergonotes desktop app has not been started on this computer` }; }
  if (!j.enabled || !j.url) return { error: 'the agent endpoint is switched off or cannot run (Settings -> Agents (MCP) in Ergonotes)' };
  if (!j.token) return { error: 'the endpoint file has no token' };
  return { url: j.url, token: j.token };
}

/** Where the vault folder is, when the app has been told (the guard uses it). */
export function vaultRoot(env = process.env) {
  try { return readFileSync(join(configDir(env), 'vault-root.txt'), 'utf8').trim() || null; } catch { return null; }
}

/** One JSON-RPC call to the endpoint. Resolves to the parsed answer, or throws an Error with a plain message. */
export async function rpc(ep, message, { timeoutMs = 130_000 } = {}) {
  let r;
  try {
    r = await fetch(ep.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ep.token}` }, body: JSON.stringify(message), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new Error(e?.cause?.code === 'ECONNREFUSED' ? 'Ergonotes is not running' : `could not reach Ergonotes (${e?.cause?.code ?? e?.message ?? e})`);
  }
  if (r.status === 202) return null;
  if (r.status === 401) throw new Error('Ergonotes refused the token (it was changed or revoked)');
  if (r.status === 403) throw new Error('Ergonotes refused the request');
  if (r.status === 503) throw new Error('Ergonotes is still starting');
  let body;
  try { body = await r.json(); } catch { throw new Error(`Ergonotes answered with an unreadable reply (HTTP ${r.status})`); }
  if (!r.ok && !(body && (body.result || body.error))) throw new Error(body?.error ?? `HTTP ${r.status}`);
  return body;
}
