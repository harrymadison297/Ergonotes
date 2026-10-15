// The shell stays thin: all note logic, sync and encryption live in the TypeScript core that runs in the webview.
// Rust provides the window, a CORS-free HTTP client for S3/WebDAV, local notifications, and the vault folder:
// the notes are plain Markdown files on disk (ADR 0010), so the webview reaches the disk through the handful of
// commands below, all confined to the one folder the person chose.
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

use serde::Serialize;
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager, State,
};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct VaultRoot(Mutex<Option<PathBuf>>);

#[derive(Serialize)]
struct Entry {
    name: String,
    kind: &'static str,
    size: u64,
    mtime: f64,
}

#[derive(Serialize)]
struct Stat {
    kind: &'static str,
    size: u64,
    mtime: f64,
}

fn mtime_ms(m: &fs::Metadata) -> f64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

fn config_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("vault-root.txt"))
}

/// A path written by the webview (`a/b.md`) joined onto the vault folder; nothing outside it can be named.
fn resolve(root: &State<VaultRoot>, rel: &str) -> Result<PathBuf, String> {
    let base = root.0.lock().unwrap().clone().ok_or("No vault folder has been chosen")?;
    let mut p = base;
    for c in Path::new(rel).components() {
        match c {
            Component::Normal(s) => p.push(s),
            Component::CurDir => {}
            _ => return Err("That path is not inside the vault folder".into()),
        }
    }
    Ok(p)
}

#[tauri::command]
fn vault_root(app: AppHandle, root: State<VaultRoot>) -> Option<String> {
    if let Some(p) = root.0.lock().unwrap().clone() {
        return Some(p.to_string_lossy().into_owned());
    }
    let saved = fs::read_to_string(config_file(&app)?).ok()?;
    let p = PathBuf::from(saved.trim());
    if p.as_os_str().is_empty() {
        return None;
    }
    *root.0.lock().unwrap() = Some(p.clone());
    Some(p.to_string_lossy().into_owned())
}

#[tauri::command]
fn vault_default_dir(app: AppHandle) -> String {
    // Android: the app's own folder on shared storage, which a file manager or a USB cable can reach
    #[cfg(target_os = "android")]
    {
        let pkg = app.config().identifier.clone();
        let ext = std::env::var("EXTERNAL_STORAGE").unwrap_or_else(|_| "/storage/emulated/0".into());
        return format!("{ext}/Android/data/{pkg}/files/Ergonotes");
    }
    #[cfg(not(target_os = "android"))]
    {
        let base = app
            .path()
            .document_dir()
            .or_else(|_| app.path().home_dir())
            .or_else(|_| app.path().app_data_dir())
            .unwrap_or_else(|_| PathBuf::from("."));
        base.join("Ergonotes").to_string_lossy().into_owned()
    }
}

#[tauri::command]
fn vault_set_root(app: AppHandle, root: State<VaultRoot>, path: String) -> Result<String, String> {
    let p = PathBuf::from(path.trim());
    if p.as_os_str().is_empty() || !p.is_absolute() {
        return Err("Choose a folder by its full path".into());
    }
    fs::create_dir_all(&p).map_err(|e| format!("Cannot use that folder: {e}"))?;
    if let Some(cfg) = config_file(&app) {
        if let Some(dir) = cfg.parent() {
            let _ = fs::create_dir_all(dir);
        }
        fs::write(&cfg, p.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    }
    *root.0.lock().unwrap() = Some(p.clone());
    Ok(p.to_string_lossy().into_owned())
}

#[tauri::command]
async fn vault_pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app;
        Err("Choosing a folder is not available on this device".into())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let picked = app.dialog().file().blocking_pick_folder();
        Ok(picked.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
    }
}

/// What belongs to this device only (its id, the Store's credentials, the remembered key) is kept beside the app's
/// own settings, one file per vault folder, and never inside the vault folder.
fn device_meta_file(app: &AppHandle, root: &State<VaultRoot>, key: Option<String>) -> Result<PathBuf, String> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    // `key` names a vault folder the shell cannot see as a path (a folder chosen through Android's chooser)
    let id = match key {
        Some(k) => k,
        None => root.0.lock().unwrap().clone().ok_or("No vault folder has been chosen")?.to_string_lossy().to_string(),
    };
    let mut h = DefaultHasher::new();
    id.to_lowercase().hash(&mut h);
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(format!("device-{:016x}.json", h.finish())))
}

#[tauri::command]
fn device_meta_load(app: AppHandle, root: State<VaultRoot>, key: Option<String>) -> Result<String, String> {
    Ok(fs::read_to_string(device_meta_file(&app, &root, key)?).unwrap_or_else(|_| "{}".into()))
}

#[tauri::command]
fn device_meta_save(app: AppHandle, root: State<VaultRoot>, json: String, key: Option<String>) -> Result<(), String> {
    let f = device_meta_file(&app, &root, key)?;
    if let Some(d) = f.parent() {
        fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let tmp = f.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &f).map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_readdir(root: State<VaultRoot>, dir: String) -> Result<Vec<Entry>, String> {
    let p = resolve(&root, &dir)?;
    let mut out = Vec::new();
    let rd = match fs::read_dir(&p) {
        Ok(r) => r,
        Err(_) => return Ok(out),
    };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        // follow links so a linked folder inside the vault works
        let md = match fs::metadata(e.path()) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if md.is_dir() {
            out.push(Entry { name, kind: "dir", size: 0, mtime: 0.0 });
        } else if md.is_file() {
            out.push(Entry { name, kind: "file", size: md.len(), mtime: mtime_ms(&md) });
        }
    }
    Ok(out)
}

#[tauri::command]
fn vault_read(root: State<VaultRoot>, path: String) -> Result<Response, String> {
    let p = resolve(&root, &path)?;
    fs::read(p).map(Response::new).map_err(|e| e.to_string())
}

fn header(req: &Request, name: &str) -> Option<String> {
    req.headers().get(name).and_then(|v| v.to_str().ok()).map(|s| s.to_string())
}

/// Body: the file's bytes. Header `x-path`: its path, percent-encoded. Written to a temporary name first.
#[tauri::command]
fn vault_write(root: State<VaultRoot>, request: Request) -> Result<(), String> {
    let raw = header(&request, "x-path").ok_or("missing path")?;
    let rel = percent_encoding::percent_decode_str(&raw).decode_utf8_lossy().into_owned();
    let private = header(&request, "x-private").as_deref() == Some("1");
    let p = resolve(&root, &rel)?;
    // desktop webviews send the bytes as they are; Android's bridge sends them as a JSON array of numbers
    let bytes = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        InvokeBody::Json(serde_json::Value::Array(a)) => a.iter().map(|v| v.as_u64().unwrap_or(0) as u8).collect(),
        InvokeBody::Json(_) => return Err("expected the file's bytes".into()),
    };
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension(format!("{}.{}.tmp", std::process::id(), bytes.len()));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(&bytes).map_err(|e| e.to_string())?;
        f.sync_all().ok();
    }
    #[cfg(unix)]
    if private {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    let _ = private;
    fs::rename(&tmp, &p).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

#[tauri::command]
fn vault_remove(root: State<VaultRoot>, path: String) -> Result<(), String> {
    let p = resolve(&root, &path)?;
    if p == *root.0.lock().unwrap().as_ref().ok_or("no vault folder")? {
        return Err("The vault folder itself cannot be removed".into());
    }
    match fs::metadata(&p) {
        Ok(m) if m.is_dir() => fs::remove_dir_all(&p).map_err(|e| e.to_string()),
        Ok(_) => fs::remove_file(&p).map_err(|e| e.to_string()),
        Err(_) => Ok(()),
    }
}

#[tauri::command]
fn vault_rename(root: State<VaultRoot>, from: String, to: String) -> Result<(), String> {
    let a = resolve(&root, &from)?;
    let b = resolve(&root, &to)?;
    if let Some(dir) = b.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::rename(a, b).map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_mkdir(root: State<VaultRoot>, path: String) -> Result<(), String> {
    fs::create_dir_all(resolve(&root, &path)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_stat(root: State<VaultRoot>, path: String) -> Result<Option<Stat>, String> {
    let p = resolve(&root, &path)?;
    Ok(fs::metadata(p).ok().map(|m| Stat {
        kind: if m.is_dir() { "dir" } else { "file" },
        size: if m.is_dir() { 0 } else { m.len() },
        mtime: if m.is_dir() { 0.0 } else { mtime_ms(&m) },
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(VaultRoot::default())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            vault_root,
            vault_default_dir,
            vault_set_root,
            vault_pick_folder,
            vault_readdir,
            vault_read,
            vault_write,
            vault_remove,
            vault_rename,
            vault_mkdir,
            vault_stat,
            device_meta_load,
            device_meta_save,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ergonotes");
}
