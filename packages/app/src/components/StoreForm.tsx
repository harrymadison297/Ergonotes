import type { StoreConfig } from '@ergonotes/core';

export interface StoreFormState {
  type: 's3' | 'webdav' | 'folder';
  endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; prefix: string;
  url: string; username: string; password: string; path: string;
}

export const emptyStore = (): StoreFormState => ({
  type: 's3', endpoint: '', region: 'us-east-1', bucket: '', accessKeyId: '', secretAccessKey: '', prefix: '',
  url: '', username: '', password: '', path: '',
});

export function formFromStore(c: StoreConfig | null): StoreFormState {
  const f = emptyStore();
  if (!c) return f;
  if (c.type === 's3') return { ...f, type: 's3', endpoint: c.endpoint, region: c.region, bucket: c.bucket, accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, prefix: c.prefix ?? '' };
  if (c.type === 'webdav') return { ...f, type: 'webdav', url: c.url, username: c.username ?? '', password: c.password ?? '', prefix: c.prefix ?? '' };
  return { ...f, type: 'folder', path: c.path };
}

export function storeFromForm(f: StoreFormState): StoreConfig {
  if (f.type === 's3') {
    return { type: 's3', endpoint: f.endpoint.trim(), region: f.region.trim() || 'us-east-1', bucket: f.bucket.trim(), accessKeyId: f.accessKeyId.trim(), secretAccessKey: f.secretAccessKey, prefix: f.prefix.trim() || undefined };
  }
  if (f.type === 'webdav') return { type: 'webdav', url: f.url.trim(), username: f.username || undefined, password: f.password || undefined, prefix: f.prefix.trim() || undefined };
  return { type: 'folder', path: f.path.trim() };
}

export function StoreForm({ value, onChange, allowFolder = false }: { value: StoreFormState; onChange: (v: StoreFormState) => void; allowFolder?: boolean }) {
  const set = (k: keyof StoreFormState) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value } as StoreFormState);
  return (
    <div>
      <div className="field">
        <label htmlFor="st-type">Storage type</label>
        <select id="st-type" className="input" value={value.type} onChange={set('type')}>
          <option value="s3">S3-compatible (AWS S3, Cloudflare R2, Backblaze B2, MinIO)</option>
          <option value="webdav">WebDAV (Nextcloud, Synology, ...)</option>
          {allowFolder && <option value="folder">Folder on this machine</option>}
        </select>
      </div>
      {value.type === 's3' && (
        <>
          <div className="field"><label htmlFor="s3e">Endpoint URL</label><input id="s3e" className="input" placeholder="https://s3.example.com" value={value.endpoint} onChange={set('endpoint')} required /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label htmlFor="s3b">Bucket</label><input id="s3b" className="input" value={value.bucket} onChange={set('bucket')} required /></div>
            <div className="field"><label htmlFor="s3r">Region</label><input id="s3r" className="input" value={value.region} onChange={set('region')} /></div>
          </div>
          <div className="field"><label htmlFor="s3k">Access key ID</label><input id="s3k" className="input" autoComplete="off" value={value.accessKeyId} onChange={set('accessKeyId')} required /></div>
          <div className="field"><label htmlFor="s3s">Secret access key</label><input id="s3s" type="password" className="input" autoComplete="off" value={value.secretAccessKey} onChange={set('secretAccessKey')} required /></div>
        </>
      )}
      {value.type === 'webdav' && (
        <>
          <div className="field"><label htmlFor="wd-u">Server URL</label><input id="wd-u" className="input" placeholder="https://cloud.example.com/remote.php/dav/files/me" value={value.url} onChange={set('url')} required /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label htmlFor="wd-n">Username</label><input id="wd-n" className="input" autoComplete="off" value={value.username} onChange={set('username')} /></div>
            <div className="field"><label htmlFor="wd-p">Password</label><input id="wd-p" type="password" className="input" autoComplete="off" value={value.password} onChange={set('password')} /></div>
          </div>
        </>
      )}
      {value.type === 'folder' && (
        <div className="field"><label htmlFor="fd">Folder path</label><input id="fd" className="input" placeholder="/mnt/share/ergonotes" value={value.path} onChange={set('path')} required />
          <span className="hint">A shared folder, or one kept in sync by Syncthing, Dropbox or a network drive. Only encrypted data is written there.</span></div>
      )}
      {value.type !== 'folder' && (
        <div className="field"><label htmlFor="st-pre">Key prefix (optional)</label><input id="st-pre" className="input" placeholder="notes/" value={value.prefix} onChange={set('prefix')} />
          <span className="hint">Lets several vaults share one bucket or directory.</span></div>
      )}
    </div>
  );
}
