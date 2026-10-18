// Settings -> Agents (MCP) in the desktop apps: the local endpoint that Claude Code and other agents connect to (ADR 0015).
import { useEffect, useState } from 'react';
import { Bot, Copy, Eye, EyeOff, FileDown, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { ERGONOTES_SKILL_MD } from '@ergonotes/core';
import { useApp } from '../state/app';
import { download, relTime } from '../state/util';
import { askConfirm } from '../state/confirm';
import {
  autostartGet, autostartSet, mcpConfigure, mcpTokenCreate, mcpTokenRegenerate, mcpTokenRevoke, mcpTokenSet, useMcpInfo,
} from '../backend/desktopMcp';
import { IconBtn } from './ui';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function DesktopAgentsPanel() {
  const app = useApp();
  const info = useMcpInfo();
  const [port, setPort] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [name, setName] = useState('Claude');
  const [startup, setStartup] = useState<boolean | null>(null);

  useEffect(() => { if (info) { setPort(String(info.port)); setPath(info.path); } }, [info?.port, info?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void autostartGet().then(setStartup).catch(() => setStartup(null)); }, []);
  if (!info) return <p className="muted">Starting…</p>;

  const apply = async (patch: Parameters<typeof mcpConfigure>[0]) => {
    setError(null);
    try { await mcpConfigure(patch); } catch (e) { setError(msg(e)); }
  };
  const copy = async (text: string, what: string) => { await navigator.clipboard?.writeText(text); app.toast(`${what} copied`); };
  const st = info.status;
  const url = st.url ?? `http://127.0.0.1:${info.port}${info.path}`;
  const main = info.tokens.find(t => t.id === 'default') ?? info.tokens[0];
  const addCommand = (token: string) => `claude mcp add --transport http ergonotes ${url} --header "Authorization: Bearer ${token}"`;
  // the token is not left on screen: it shows with the one in the table, and Copy always copies the real command
  const claudeCmd = addCommand(main && shown[main.id] ? main.token : '<token>');
  const dirty = port !== String(info.port) || path !== info.path;

  return (
    <div style={{ maxWidth: 640 }}>
      <p className="muted" style={{ marginTop: 0 }}>
        While Ergonotes is running, AI agents on this computer, such as Claude Code, can search, read and write your notes through the Model Context Protocol.
        They need a token. Notes you mark private are never shown to them.
      </p>

      <div className="field">
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600 }}>
          <input type="checkbox" checked={info.enabled} onChange={e => void apply({ enabled: e.target.checked })} style={{ accentColor: 'var(--green-fill)', width: 18, height: 18 }} />
          Let agents on this computer use my notes
        </label>
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-s)' }}>
          <span aria-hidden className={`mcp-dot ${st.state}`} />
          {st.state === 'running' && <span>Running at <code>{st.url}</code></span>}
          {st.state === 'off' && <span className="muted">Off</span>}
          {st.state === 'error' && <span className="error-text">{st.error}</span>}
        </div>
      </div>

      <div className="field">
        <span className="label">Address</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <code>http://127.0.0.1:</code>
          <input className="input" aria-label="Port" inputMode="numeric" style={{ width: 90 }} value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))} />
          <input className="input" aria-label="Path" style={{ width: 160 }} value={path} onChange={e => setPath(e.target.value)} />
          <button className="btn" disabled={!dirty} onClick={() => void apply({ port: Number(port), path })}>Apply</button>
        </div>
        <span className="hint">The default is port 7424 and path /mcp. If another program uses the port, pick another one.</span>
        {error && <span className="error-text" role="alert">{error}</span>}
      </div>

      <div className="field">
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600 }}>
          <input type="checkbox" checked={info.lan} onChange={e => void apply({ lan: e.target.checked })} style={{ accentColor: 'var(--green-fill)', width: 18, height: 18 }} />
          Also allow other devices on my network
        </label>
        <span className="hint">Off: only this computer can connect. On: anyone on your network who has a token can read and write your notes, and the connection is not encrypted.</span>
      </div>

      <div className="field">
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600 }}>
          <input type="checkbox" checked={info.closeToTray && info.trayOk} disabled={!info.trayOk} onChange={e => void apply({ closeToTray: e.target.checked })} style={{ accentColor: 'var(--green-fill)', width: 18, height: 18 }} />
          Keep running in the tray when I close the window
        </label>
        <span className="hint">{info.trayOk ? 'Agents can keep using your notes. Quit from the tray icon.' : 'This system shows no tray icon, so closing the window quits the app.'}</span>
      </div>
      <div className="field">
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600 }}>
          <input type="checkbox" checked={startup === true} disabled={startup === null} onChange={async e => { try { setStartup(await autostartSet(e.target.checked)); } catch (err) { setError(msg(err)); } }} style={{ accentColor: 'var(--green-fill)', width: 18, height: 18 }} />
          Start Ergonotes when I sign in
        </label>
        <span className="hint">It starts in the tray. If the vault has a password, open the window once to unlock it.</span>
      </div>

      <div className="field">
        <span className="label">Tokens</span>
        <table className="table"><thead><tr><th>Name</th><th>Token</th><th>Last used</th><th /></tr></thead><tbody>
          {info.tokens.map(t => (
            <tr key={t.id}>
              <td className="name">{t.name}</td>
              <td>
                {editing?.id === t.id ? (
                  <span style={{ display: 'flex', gap: 6 }}>
                    <input className="input" aria-label="Token value" autoFocus value={editing.value} onChange={e => setEditing({ id: t.id, value: e.target.value })} style={{ minWidth: 220 }} />
                    <button className="btn primary" onClick={async () => { try { await mcpTokenSet(t.id, editing.value); setEditing(null); setError(null); } catch (e) { setError(msg(e)); } }}>Save</button>
                    <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
                  </span>
                ) : <code>{shown[t.id] ? t.token : `${t.token.slice(0, 8)}${'•'.repeat(12)}`}</code>}
              </td>
              <td>{t.lastUsed ? relTime(t.lastUsed) : 'never'}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <IconBtn label={shown[t.id] ? 'Hide token' : 'Show token'} icon={shown[t.id] ? <EyeOff size={16} /> : <Eye size={16} />} onClick={() => setShown({ ...shown, [t.id]: !shown[t.id] })} />
                <IconBtn label="Copy token" icon={<Copy size={16} />} onClick={() => void copy(t.token, 'Token')} />
                <IconBtn label="Type in a token of your own" icon={<KeyRound size={16} />} onClick={() => setEditing({ id: t.id, value: '' })} />
                <IconBtn label="Make a new token" icon={<RefreshCw size={16} />} onClick={async () => { if (await askConfirm(`Make a new token for “${t.name}”? Whatever uses the old one stops working.`, { ok: 'Make new token' })) await mcpTokenRegenerate(t.id).catch(e => setError(msg(e))); }} />
                <IconBtn label={`Revoke ${t.name}`} icon={<Trash2 size={16} />} onClick={async () => { if (await askConfirm(`Revoke “${t.name}”? Whatever uses it stops working.`, { ok: 'Revoke' })) await mcpTokenRevoke(t.id).catch(e => setError(msg(e))); }} />
              </td>
            </tr>
          ))}
        </tbody></table>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input className="input" aria-label="Token name" value={name} onChange={e => setName(e.target.value)} />
          <button className="btn" style={{ whiteSpace: 'nowrap' }} onClick={async () => { try { await mcpTokenCreate(name); setError(null); } catch (e) { setError(msg(e)); } }}><Bot size={16} /> Add token</button>
        </div>
        <span className="hint">One token for each agent, so you can revoke one without touching the others. The first is made for Claude Code and is written, with the address, to a file only you can read; revoking it makes a new one{info.discoveryFile ? <> (<code>{info.discoveryFile}</code>)</> : null}.</span>
      </div>

      <div className="field">
        <span className="label">Connect Claude Code</span>
        <span className="hint">With the Ergonotes plugin (it finds the address and the token by itself, and teaches Claude how to write your notes):</span>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--fs-xs)', margin: '4px 0' }}>{'claude plugin marketplace add harrymadison297/Ergonotes\nclaude plugin install ergonotes@ergonotes'}</pre>
        <span className="hint">Or by hand, without the plugin:</span>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 'var(--fs-xs)', margin: '4px 0' }}>{claudeCmd}</pre>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => void copy(addCommand(main?.token ?? '<token>'), 'Command')}><Copy size={14} /> Copy command</button>
          <button className="btn" onClick={() => void download('SKILL.md', 'text/markdown', ERGONOTES_SKILL_MD)}><FileDown size={16} /> Download SKILL.md</button>
        </div>
        <span className="hint">Other agents: use the address above with the header <code>Authorization: Bearer &lt;token&gt;</code>.</span>
      </div>
    </div>
  );
}
