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

mod mcp;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod whisper;
#[cfg(any(target_os = "android", target_os = "ios"))]
#[path = "whisper_stub.rs"]
mod whisper;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod shell;

use serde::Serialize;
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct VaultRoot(Mutex<Option<PathBuf>>);

/// Files the system asked the app to open ("Open with Ergonotes"), until the webview has taken them.
#[derive(Default)]
struct OpenQueue(Mutex<Vec<String>>);

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

/// `<file>.<pid>.<n>.tmp` is a write in progress, or one an app that died left behind: not a file of the vault.
/// The same rule as the Node adapter's (`packages/core/src/node.ts`), which the core's contract test holds both to.
fn is_write_temp(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".tmp") else { return false };
    let mut parts = stem.rsplitn(3, '.');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(tag), Some(pid), Some(_)) => {
            !pid.is_empty() && pid.bytes().all(|b| b.is_ascii_digit()) && !tag.is_empty() && tag.bytes().all(|b| b.is_ascii_digit() || b.is_ascii_lowercase())
        }
        _ => false,
    }
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
        if is_write_temp(&name) {
            continue;
        }
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
    // `<file>.<pid>.<n>.tmp`: the whole name is kept, so `a.md` and `a.json` never share a temporary file
    let tmp = {
        static WRITES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = WRITES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let mut name = p.file_name().map(|n| n.to_os_string()).unwrap_or_default();
        name.push(format!(".{}.{}.tmp", std::process::id(), n));
        p.with_file_name(name)
    };
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

/// Show a file or folder of the vault in the system's file manager (the file selected where the manager can do that).
#[tauri::command]
fn vault_reveal(root: State<VaultRoot>, path: String) -> Result<(), String> {
    let p = resolve(&root, &path)?;
    if !p.exists() {
        return Err("That file is not on this device".into());
    }
    reveal(&p)
}

#[cfg(target_os = "windows")]
fn reveal(p: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // explorer wants backslashes and one quoted argument; it also exits with 1 when it worked, so only the start is checked
    let win = p.to_string_lossy().replace('/', "\\");
    std::process::Command::new("explorer").raw_arg(format!("/select,\"{}\"", win)).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn reveal(p: &Path) -> Result<(), String> {
    std::process::Command::new("open").arg("-R").arg(p).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos"), not(target_os = "android")))]
fn reveal(p: &Path) -> Result<(), String> {
    // most Linux file managers cannot be told to select a file: its folder is opened
    let dir = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
    std::process::Command::new("xdg-open").arg(dir).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
fn reveal(_p: &Path) -> Result<(), String> {
    Err("Showing a file in the file manager is not available on Android".into())
}


/// Open a web or mail address in the system's browser: the webview has no browser of its own to hand a link to.
/// Only these schemes are passed on, so a note cannot make the app start a program.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    let ok = (lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")) && !url.chars().any(|c| c.is_control() || c == ' ');
    if !ok {
        return Err("Only web and mail addresses can be opened".into());
    }
    open_address(&url)
}

#[cfg(target_os = "windows")]
fn open_address(url: &str) -> Result<(), String> {
    // not `cmd /c start`: that would read an `&` in the address as a second command
    std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn open_address(url: &str) -> Result<(), String> {
    std::process::Command::new("open").arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos"), not(target_os = "android")))]
fn open_address(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open").arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
fn open_address(_url: &str) -> Result<(), String> {
    Err("Opening the browser is not available on Android".into())
}

// ---------------------------------------------------------------- "Open with": files outside the vault
// The person picked these files themselves (Explorer's Open with, a double click), so unlike the vault commands
// these take a full path. Nothing is added to them: no id, no frontmatter; they are read and written as they are.

const EXTERNAL_EXTS: [&str; 4] = ["md", "markdown", "mdown", "txt"];
const MAX_EXTERNAL_BYTES: u64 = 20 * 1024 * 1024;

fn is_openable(p: &Path) -> bool {
    p.is_file()
        && p.extension()
            .and_then(|e| e.to_str())
            .map(|e| EXTERNAL_EXTS.contains(&e.to_ascii_lowercase().as_str()))
            .unwrap_or(false)
}

/// The arguments of a start (or of a second start, which is handed to the running app) that name a file to open.
fn openable_args(args: &[String]) -> Vec<String> {
    args.iter()
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .filter(|p| is_openable(p))
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
fn open_with_take(queue: State<OpenQueue>) -> Vec<String> {
    std::mem::take(&mut *queue.0.lock().unwrap())
}

#[derive(Serialize)]
struct ExternalText {
    text: String,
    mtime: f64,
    size: u64,
    /// the file starts with a byte order mark, which is put back when it is written
    bom: bool,
    /// the file uses CRLF line ends
    crlf: bool,
}

#[tauri::command]
fn ext_read(path: String) -> Result<ExternalText, String> {
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|e| format!("Could not open the file: {e}"))?;
    if !meta.is_file() {
        return Err("That is not a file".into());
    }
    if meta.len() > MAX_EXTERNAL_BYTES {
        return Err("The file is larger than 20 MB".into());
    }
    let bytes = fs::read(&p).map_err(|e| format!("Could not read the file: {e}"))?;
    let (bom, body) = match bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        Some(rest) => (true, rest),
        None => (false, &bytes[..]),
    };
    let text = std::str::from_utf8(body).map_err(|_| "The file is not UTF-8 text, so it is left alone".to_string())?;
    let crlf = text.contains("\r\n");
    Ok(ExternalText {
        text: if crlf { text.replace("\r\n", "\n") } else { text.to_string() },
        mtime: mtime_ms(&meta),
        size: meta.len(),
        bom,
        crlf,
    })
}

/// Writes through a temporary file. `expected` is the modification time the editor last saw: when the file has been
/// changed since, nothing is written (`changed`) unless `force` is set.
#[tauri::command]
fn ext_write(path: String, text: String, bom: bool, crlf: bool, expected: Option<f64>, force: bool) -> Result<f64, String> {
    let p = PathBuf::from(&path);
    if let (Some(exp), false) = (expected, force) {
        if let Ok(m) = fs::metadata(&p) {
            if (mtime_ms(&m) - exp).abs() > 1.0 {
                return Err("changed".into());
            }
        }
    }
    let body = if crlf { text.replace('\n', "\r\n") } else { text };
    let mut bytes = Vec::with_capacity(body.len() + 3);
    if bom {
        bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    bytes.extend_from_slice(body.as_bytes());
    let tmp = {
        let mut name = p.file_name().map(|n| n.to_os_string()).unwrap_or_default();
        name.push(format!(".{}.ergo.tmp", std::process::id()));
        p.with_file_name(name)
    };
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("Could not save: {e}"))?;
        f.write_all(&bytes).map_err(|e| format!("Could not save: {e}"))?;
        f.sync_all().ok();
    }
    fs::rename(&tmp, &p).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not save: {e}")
    })?;
    fs::metadata(&p).map(|m| mtime_ms(&m)).map_err(|e| e.to_string())
}

#[tauri::command]
fn ext_stat(path: String) -> Option<Stat> {
    fs::metadata(&path).ok().map(|m| Stat { kind: if m.is_dir() { "dir" } else { "file" }, size: m.len(), mtime: mtime_ms(&m) })
}

/// A file beside the document (an image it shows), by a path relative to the document's folder.
#[tauri::command]
fn ext_read_beside(doc: String, rel: String) -> Result<Response, String> {
    let p = beside(&doc, &rel)?;
    fs::read(p).map(Response::new).map_err(|e| e.to_string())
}

/// Body: the bytes. Headers `x-doc` and `x-rel`: the document's path and the file's path relative to its folder, percent-encoded.
#[tauri::command]
fn ext_write_beside(request: Request) -> Result<(), String> {
    let dec = |n: &str| header(&request, n).map(|r| percent_encoding::percent_decode_str(&r).decode_utf8_lossy().into_owned());
    let doc = dec("x-doc").ok_or("missing document")?;
    let rel = dec("x-rel").ok_or("missing path")?;
    let p = beside(&doc, &rel)?;
    let bytes = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        InvokeBody::Json(serde_json::Value::Array(a)) => a.iter().map(|v| v.as_u64().unwrap_or(0) as u8).collect(),
        InvokeBody::Json(_) => return Err("expected the file's bytes".into()),
    };
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&p, bytes).map_err(|e| e.to_string())
}

fn beside(doc: &str, rel: &str) -> Result<PathBuf, String> {
    let mut p = Path::new(doc).parent().map(Path::to_path_buf).ok_or("The document has no folder")?;
    for c in Path::new(rel).components() {
        match c {
            Component::Normal(s) => p.push(s),
            Component::CurDir => {}
            Component::ParentDir => {
                p.pop();
            }
            _ => return Err("That path cannot be reached from the document".into()),
        }
    }
    Ok(p)
}


/// A file the person asked to keep ("Export", "Download"): a webview cannot save a blob by itself, so the bytes come here, the person
/// chooses where, and the file is written. Body: the bytes. Header `x-name`: the suggested file name, percent-encoded.
/// Returns the path it was written to, or `null` when the dialog was cancelled.
#[tauri::command]
async fn save_download(app: AppHandle, request: Request<'_>) -> Result<Option<String>, String> {
    let name = header(&request, "x-name")
        .map(|r| percent_encoding::percent_decode_str(&r).decode_utf8_lossy().into_owned())
        .ok_or("missing name")?;
    let bytes = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        InvokeBody::Json(serde_json::Value::Array(a)) => a.iter().map(|v| v.as_u64().unwrap_or(0) as u8).collect(),
        InvokeBody::Json(_) => return Err("expected the file's bytes".into()),
    };
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, name, bytes);
        Err("Saving a file is not available on this device yet".into())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let mut dialog = app.dialog().file().set_file_name(&name);
        if let Ok(dir) = app.path().download_dir() {
            dialog = dialog.set_directory(dir);
        }
        if let Some(ext) = Path::new(&name).extension().and_then(|e| e.to_str()) {
            dialog = dialog.add_filter(format!("{} file", ext.to_uppercase()), &[ext]);
        }
        let Some(picked) = dialog.blocking_save_file() else { return Ok(None) };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        fs::write(&path, bytes).map_err(|e| format!("Could not save: {e}"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }
}

#[tauri::command]
fn ext_reveal(path: String) -> Result<(), String> {
    reveal(Path::new(&path))
}

/// Start with the system (the desktop apps only).
#[tauri::command]
fn desktop_autostart_get(app: AppHandle) -> bool {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        shell::desktop_autostart_get(app)
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app;
        false
    }
}

#[tauri::command]
fn desktop_autostart_set(app: AppHandle, on: bool) -> Result<bool, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        shell::desktop_autostart_set(app, on)
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, on);
        Err("Starting with the system is not available on this device".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // a second start (a double click on another file) hands its file to the running app instead of opening a second window
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        let files = openable_args(&argv);
        if !files.is_empty() {
            app.state::<OpenQueue>().0.lock().unwrap().extend(files);
            let _ = app.emit("open-with", ());
        }
        shell::show_main(app);
    }));
    // start with the system (a person's choice in Settings -> Agents); the system starts it with --hidden, to stay in the tray
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        // closing the window hides it to the tray (when there is one and the person left that on): the endpoint keeps running
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && window.app_handle().state::<mcp::McpState>().close_to_tray() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });
    builder
        .manage(VaultRoot::default())
        .manage(whisper::WhisperState::default())
        .manage(OpenQueue(Mutex::new(openable_args(&std::env::args().skip(1).collect::<Vec<_>>()))))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            mcp::manage(&handle);
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                let tray_ok = shell::setup_tray(&handle);
                handle.state::<mcp::McpState>().set_tray_ok(tray_ok);
                if tray_ok && shell::started_hidden() {
                    if let Some(w) = handle.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
                mcp::start(&handle);
            }
            Ok(())
        })
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
            vault_reveal,
            open_url,
            device_meta_load,
            device_meta_save,
            open_with_take,
            ext_read,
            ext_write,
            ext_stat,
            ext_read_beside,
            ext_write_beside,
            ext_reveal,
            save_download,
            mcp::mcp_get,
            mcp::mcp_configure,
            mcp::mcp_token_create,
            mcp::mcp_token_set,
            mcp::mcp_token_regenerate,
            mcp::mcp_token_revoke,
            mcp::mcp_respond,
            mcp::mcp_ready,
            desktop_autostart_get,
            desktop_autostart_set,
            whisper::whisper_models,
            whisper::whisper_download,
            whisper::whisper_cancel_download,
            whisper::whisper_delete,
            whisper::whisper_transcribe,
            whisper::whisper_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ergonotes");
}

#[cfg(test)]
mod tests {
    use super::{beside, is_write_temp, openable_args};

    #[test]
    fn a_write_in_progress_is_not_a_vault_file() {
        assert!(is_write_temp("a.md.4242.k3j2x.tmp"));
        assert!(is_write_temp("a.md.4242.17.tmp"));
        assert!(is_write_temp(".hidden.1.0.tmp"));
    }

    #[test]
    fn only_arguments_that_name_a_text_file_are_opened() {
        let dir = std::env::temp_dir().join(format!("ergo-open-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let md = dir.join("A.MD");
        let png = dir.join("a.png");
        std::fs::write(&md, "x").unwrap();
        std::fs::write(&png, "x").unwrap();
        let args = vec!["--flag".to_string(), md.to_string_lossy().into_owned(), png.to_string_lossy().into_owned(), dir.join("missing.md").to_string_lossy().into_owned()];
        assert_eq!(openable_args(&args), vec![md.to_string_lossy().into_owned()]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_beside_a_document_is_found_from_its_folder() {
        let p = beside("/home/a/notes/x.md", "img/p.png").unwrap();
        assert!(p.ends_with("notes/img/p.png") || p.ends_with("notes\\img\\p.png"));
        let up = beside("/home/a/notes/x.md", "../shared/p.png").unwrap();
        assert!(up.ends_with("a/shared/p.png") || up.ends_with("a\\shared\\p.png"));
    }

    #[test]
    fn the_person_s_own_files_are_kept() {
        assert!(!is_write_temp("mine.tmp"));
        assert!(!is_write_temp("a.b.tmp"));
        assert!(!is_write_temp("a.md"));
        assert!(!is_write_temp("1.a.tmp"));
    }
}
