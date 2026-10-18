#!/usr/bin/env node
// SessionStart hook: tells Claude, in a few lines, whether Ergonotes is reachable and what is in it. What it prints is added to
// Claude's context. It never fails the session: any problem becomes a sentence.
import { readEndpoint, rpc } from './endpoint.mjs';

const say = lines => { console.log(lines.join('\n')); process.exit(0); };
const call = async (ep, name, args = {}) => {
  const r = await rpc(ep, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { timeoutMs: 8000 });
  const res = r?.result;
  if (!res || res.isError) throw new Error(res?.content?.[0]?.text ?? r?.error?.message ?? 'no answer');
  return JSON.parse(res.content[0].text);
};

const ep = readEndpoint();
if (ep.error) say([`Ergonotes is not reachable: ${ep.error}.`, 'If the user wants to work on their notes, ask them to open the Ergonotes desktop app. The Ergonotes tools appear by themselves a few seconds after it starts.']);

try {
  const folders = await call(ep, 'list_folders');
  const inbox = folders.find(f => /^inbox$/i.test(f.title));
  const waiting = inbox ? (await call(ep, 'search_notes', { folder: inbox.id, limit: 50 })).length : 0;
  const tags = (await call(ep, 'list_tags')).sort((a, b) => b.notes - a.notes).slice(0, 12).map(t => `${t.tag} (${t.notes})`);
  say([
    `Ergonotes is connected (${ep.url}). Use its MCP tools and the ergonotes skills (/ergonotes:...) for anything about the user's notes, tasks, daily notes or drawings.`,
    `Inbox: ${inbox ? (waiting >= 50 ? '50 or more notes' : `${waiting} note${waiting === 1 ? '' : 's'}`) : 'no Inbox folder yet (one is created at the first capture)'}.`,
    tags.length ? `Tags in use: ${tags.join(', ')}.` : 'No tags in use yet.',
    'Rules: read before you write, make the smallest edit, new notes go to the Inbox, reuse existing tags, never delete, write in the language the user writes in, and do not edit the vault folder\'s files directly.',
  ]);
} catch (e) {
  say([/locked/i.test(String(e.message)) ? 'Ergonotes is running but its vault is locked: ask the user to unlock it in the Ergonotes window.' : `Ergonotes is running but did not answer properly (${e.message}).`]);
}
