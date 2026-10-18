// The backend of the public demo: Harry's vault (seed.ts) in memory, no password, no sync, no server. Everything a visitor
// does lasts until the tab is closed or "Reset demo" is pressed.
import { MemFs, MemPersist, Vault, type AiEvent, type AiTransport, type ModelInfo } from '@ergonotes/core';
import type { Backend } from '../backend';
import { cannedTransport } from './cannedAi';
import { buildSeed, DEMO_DASHBOARD } from './seed';
import { parseDashboard, setDashboard } from '../state/dashboard';

const noAudio = async () => { throw new Error('Voice and recordings need the installed app.'); };

export async function createDemoBackend(): Promise<Backend> {
  const fs = new MemFs();
  fs.durable = false;
  for (const f of buildSeed()) fs.put(f.path, f.text, f.mtime);
  const vault = await Vault.open({ fs, persist: new MemPersist(), passwordOptional: true, defaultDeviceName: 'Harry’s laptop', settleMs: 0, watchMs: 0 });
  await vault.createVault('', { noPassword: true, deviceName: 'Harry’s laptop' });
  await vault.setAiSettings({
    connection: { id: 'demo', name: 'Demo assistant', type: 'custom', url: 'https://demo.invalid', key: null },
    chatModel: { connection: 'demo', model: 'canned-replies' },
    suggestModel: { connection: 'demo', model: 'canned-replies' },
    suggest: false,
  });
  // Home shows habits and tasks on the first look, unless this browser already has an arrangement from an earlier visit
  try { if (localStorage.getItem('ergo.dashboard') === null) { const d = parseDashboard(DEMO_DASHBOARD); if (d) setDashboard(d); } } catch { /* private window */ }

  const models: ModelInfo[] = [{ id: 'canned-replies', name: 'Demo assistant (canned replies)', tools: true }];
  const transport: AiTransport = (req, signal) => cannedTransport(req, signal) as AsyncIterable<AiEvent>;
  return {
    api: vault,
    mode: 'local',
    aiTransport: transport,
    aiModels: async () => models,
    aiTranscribe: noAudio,
    aiTranscribeTimed: noAudio,
    onEvent: fn => vault.onEvent(fn),
    start() { /* no timers: nothing to sync */ },
  };
}
