#!/usr/bin/env node
// A stdio MCP server for Claude Code that forwards to the Ergonotes desktop app's local HTTP endpoint. Why not point Claude Code
// at the URL directly: the port and the token are the person's to change and live in a file, and the app may be started after
// Claude Code. This finds them on every message, answers by itself while the app is down, and tells Claude Code
// (`tools/list_changed`) when the real tools become available. No dependencies; Node 18 or newer.
import { createInterface } from 'node:readline';
import { readEndpoint, rpc } from './endpoint.mjs';

const send = m => process.stdout.write(JSON.stringify(m) + '\n');
const log = m => process.stderr.write(`[ergonotes] ${m}\n`);

const DOWN_NOTE = 'Ergonotes could not be reached. If the desktop app is not open, ask the user to open it (Settings -> Agents (MCP) must be on); the tools appear here by themselves a few seconds after it starts.';
let up = false; // is the real endpoint answering?
let staleList = false; // Claude Code was given an empty tool list while the app was down

function markUp() {
  if (!up) { up = true; log('connected to the Ergonotes app'); }
  if (staleList) { staleList = false; send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }); }
}
function markDown(why) {
  if (up) log(why);
  up = false;
}

async function forward(msg) {
  const ep = readEndpoint();
  if (ep.error) throw new Error(ep.error);
  return rpc(ep, msg);
}

/** What this proxy says while the app is down. */
function whileDown(msg, why) {
  const note = `${DOWN_NOTE} (${why})`;
  switch (msg.method) {
    case 'initialize':
      return { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'ergonotes', title: 'Ergonotes', version: '1.0.3' }, instructions: note } };
    case 'tools/list': staleList = true; return { jsonrpc: '2.0', id: msg.id, result: { tools: [] } };
    case 'ping': return { jsonrpc: '2.0', id: msg.id, result: {} };
    case 'tools/call': return { jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: note }] } };
    case 'resources/list': return { jsonrpc: '2.0', id: msg.id, result: { resources: [] } };
    case 'resources/templates/list': return { jsonrpc: '2.0', id: msg.id, result: { resourceTemplates: [] } };
    case 'prompts/list': return { jsonrpc: '2.0', id: msg.id, result: { prompts: [] } };
    default: return { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: note } };
  }
}

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const isRequest = msg.id !== undefined && typeof msg.method === 'string';
  try {
    const out = await forward(msg);
    markUp();
    if (isRequest && out) {
      // this proxy can tell Claude Code when the app comes and goes, so it says so even though the app itself never does
      if (msg.method === 'initialize' && out.result?.capabilities?.tools) out.result.capabilities.tools.listChanged = true;
      send(out);
    }
  } catch (e) {
    markDown(e.message);
    if (isRequest) send(whileDown(msg, e.message));
  }
}

// While the app is down (or the tool list is stale) look for it every few seconds; when it appears Claude Code is told to ask again.
setInterval(async () => {
  if (up && !staleList) return;
  try {
    const ep = readEndpoint();
    if (ep.error) throw new Error(ep.error);
    await rpc(ep, { jsonrpc: '2.0', id: 'probe', method: 'ping' }, { timeoutMs: 4000 });
    markUp();
  } catch (e) { markDown(e.message); }
}, 4000).unref();

const rl = createInterface({ input: process.stdin });
const pending = new Set();
rl.on('line', line => { if (line.trim()) { const p = handle(line).finally(() => pending.delete(p)); pending.add(p); } });
rl.on('close', () => { void Promise.allSettled([...pending]).then(() => process.exit(0)); });
