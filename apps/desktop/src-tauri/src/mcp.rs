// The desktop app's own MCP endpoint (ADR 0015). An agent such as Claude Code POSTs JSON-RPC to `http://127.0.0.1:<port><path>`;
// this file does what must not depend on the webview (listening, the Host/Origin/token checks, the settings) and hands the
// message to the webview, where the TypeScript core holds the unlocked vault and answers it (`handleRpc`). The shell stays thin.
//
// Settings and tokens belong to this device, beside the app's own settings and never in the vault folder:
//   desktop.json        the settings and the tokens (user-only readable)
//   mcp-endpoint.json   what an agent on this machine needs to connect: the url and the default token
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

pub const DEFAULT_PORT: u16 = 7424;
pub const DEFAULT_PATH: &str = "/mcp";
/// The token the plugin and the endpoint file use; revoking it makes a new one, so they always have one.
const DEFAULT_TOKEN: &str = "default";
const MAX_BODY: u64 = 4 * 1024 * 1024;
/// How long a request waits for the webview before the agent is told the app is busy.
const ANSWER_WITHIN: Duration = Duration::from_secs(120);

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Token {
    pub id: String,
    pub name: String,
    pub token: String,
    /// milliseconds since the epoch
    pub created: u64,
    pub last_used: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopConfig {
    pub mcp_enabled: bool,
    pub mcp_port: u16,
    pub mcp_path: String,
    /// listen on every network interface instead of this machine only
    pub mcp_lan: bool,
    /// closing the window hides it to the tray and the app keeps running
    pub close_to_tray: bool,
    pub tokens: Vec<Token>,
}

impl Default for DesktopConfig {
    fn default() -> Self {
        DesktopConfig { mcp_enabled: true, mcp_port: DEFAULT_PORT, mcp_path: DEFAULT_PATH.into(), mcp_lan: false, close_to_tray: true, tokens: vec![] }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct McpStatus {
    /// `off`, `running` or `error`
    pub state: String,
    pub url: Option<String>,
    pub error: Option<String>,
}

struct Running {
    server: Arc<tiny_http::Server>,
    thread: JoinHandle<()>,
}

pub struct McpState {
    cfg: Mutex<DesktopConfig>,
    status: Mutex<McpStatus>,
    running: Mutex<Option<Running>>,
    pending: Mutex<HashMap<u64, mpsc::Sender<(u16, String)>>>,
    next: AtomicU64,
    /// the webview has its listener installed and the vault object to answer with
    ready: AtomicBool,
    tray_ok: AtomicBool,
    saved_use: Mutex<Instant>,
}

impl McpState {
    pub fn close_to_tray(&self) -> bool {
        self.cfg.lock().unwrap().close_to_tray && self.tray_ok.load(Ordering::Relaxed)
    }
    pub fn set_tray_ok(&self, ok: bool) {
        self.tray_ok.store(ok, Ordering::Relaxed);
    }
    pub fn status(&self) -> McpStatus {
        self.status.lock().unwrap().clone()
    }
}

// ---------------------------------------------------------------- pure rules (tested below)

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn random_hex(bytes: usize) -> String {
    use rand::RngCore;
    let mut b = vec![0u8; bytes];
    rand::rngs::OsRng.fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn new_token() -> String {
    format!("ergo_{}", random_hex(24))
}

fn new_token_record(id: &str, name: &str) -> Token {
    Token { id: id.into(), name: name.into(), token: new_token(), created: now_ms(), last_used: None }
}

/// Equal strings, in time that does not depend on where they first differ.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn bearer(header: &str) -> Option<&str> {
    header.strip_prefix("Bearer ").map(str::trim).filter(|t| !t.is_empty())
}

/// A token the person typed in: long enough to be a secret, and made of characters a header can carry.
pub fn valid_token(t: &str) -> Result<(), String> {
    if t.len() < 16 || t.len() > 128 {
        return Err("A token needs 16 to 128 characters".into());
    }
    if !t.bytes().all(|b| b.is_ascii_alphanumeric() || b"._~-".contains(&b)) {
        return Err("A token may only use letters, digits and . _ ~ -".into());
    }
    Ok(())
}

pub fn valid_path(p: &str) -> Result<(), String> {
    let ok = p.starts_with('/') && p.len() > 1 && p.len() <= 64 && !p.contains("//") && p.bytes().all(|b| b.is_ascii_alphanumeric() || b"/_-.".contains(&b));
    if ok { Ok(()) } else { Err("The path starts with / and uses letters, digits and / _ - . only".into()) }
}

pub fn valid_port(p: u16) -> Result<(), String> {
    if p >= 1024 { Ok(()) } else { Err("Use a port from 1024 up".into()) }
}

/// The Host header must name this machine, or a web page could reach the endpoint through a rebound DNS name.
/// With "other devices on my network" on, any name is fine: the token is what protects it.
fn host_ok(host: Option<&str>, lan: bool) -> bool {
    if lan {
        return true;
    }
    let Some(h) = host else { return false };
    let name = if let Some(rest) = h.strip_prefix('[') { rest.split(']').next().unwrap_or("") } else { h.rsplit_once(':').map(|(a, _)| a).unwrap_or(h) };
    matches!(name, "127.0.0.1" | "localhost" | "::1")
}

/// An agent sends no Origin; a browser always does. A request from a web page of another origin is refused.
fn origin_ok(origin: Option<&str>, host: Option<&str>) -> bool {
    let Some(o) = origin else { return true };
    let Some(h) = host else { return false };
    o.split_once("://").map(|(_, rest)| rest.trim_end_matches('/') == h).unwrap_or(false)
}

fn norm_path(url: &str) -> &str {
    url.split(['?', '#']).next().unwrap_or("")
}

// ---------------------------------------------------------------- files

fn config_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok()
}

fn config_file(app: &AppHandle) -> Option<PathBuf> {
    config_dir(app).map(|d| d.join("desktop.json"))
}

pub fn discovery_file(app: &AppHandle) -> Option<PathBuf> {
    config_dir(app).map(|d| d.join("mcp-endpoint.json"))
}

fn write_private(path: &PathBuf, text: &str) -> Result<(), String> {
    if let Some(d) = path.parent() {
        fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    // readable by the user only from the first byte: the file is created with that mode, not changed afterwards
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&tmp).map_err(|e| e.to_string())?;
        f.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

pub fn load(app: &AppHandle) -> DesktopConfig {
    let mut cfg: DesktopConfig = config_file(app).and_then(|f| fs::read_to_string(f).ok()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    if valid_path(&cfg.mcp_path).is_err() {
        cfg.mcp_path = DEFAULT_PATH.into();
    }
    if valid_port(cfg.mcp_port).is_err() {
        cfg.mcp_port = DEFAULT_PORT;
    }
    if cfg.tokens.is_empty() {
        cfg.tokens.push(new_token_record(DEFAULT_TOKEN, "Claude Code"));
    }
    cfg
}

fn save(app: &AppHandle, cfg: &DesktopConfig) -> Result<(), String> {
    let f = config_file(app).ok_or("No settings folder")?;
    write_private(&f, &serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?)
}

/// The file an agent on this machine reads to find the endpoint and the token to use.
fn write_discovery(app: &AppHandle, cfg: &DesktopConfig, status: &McpStatus) {
    let Some(f) = discovery_file(app) else { return };
    // only the default token: another agent's token must never end up in a file a different tool reads
    let token = cfg.tokens.iter().find(|t| t.id == DEFAULT_TOKEN).map(|t| t.token.clone());
    let body = serde_json::json!({ "enabled": status.state == "running", "url": status.url, "token": token });
    let _ = write_private(&f, &serde_json::to_string_pretty(&body).unwrap_or_default());
}

// ---------------------------------------------------------------- the listener

fn listen_url(cfg: &DesktopConfig) -> String {
    format!("http://127.0.0.1:{}{}", cfg.mcp_port, cfg.mcp_path)
}

fn publish(app: &AppHandle, state: &McpState) {
    let status = state.status();
    write_discovery(app, &state.cfg.lock().unwrap(), &status);
    let _ = app.emit("mcp-status", status);
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    crate::shell::refresh_tray(app);
}

fn stop(state: &McpState) {
    if let Some(r) = state.running.lock().unwrap().take() {
        r.server.unblock();
        let _ = r.thread.join();
    }
}

/// (Re)start the listener from the current settings and record how that went.
pub fn start(app: &AppHandle) {
    let state = app.state::<McpState>();
    stop(&state);
    let cfg = state.cfg.lock().unwrap().clone();
    let status = if !cfg.mcp_enabled {
        McpStatus { state: "off".into(), url: None, error: None }
    } else {
        let host = if cfg.mcp_lan { "0.0.0.0" } else { "127.0.0.1" };
        match tiny_http::Server::http((host, cfg.mcp_port)) {
            Ok(server) => {
                let server = Arc::new(server);
                let (s2, a2) = (server.clone(), app.clone());
                let thread = thread::spawn(move || {
                    for req in s2.incoming_requests() {
                        let a = a2.clone();
                        thread::spawn(move || handle(a, req));
                    }
                });
                *state.running.lock().unwrap() = Some(Running { server, thread });
                McpStatus { state: "running".into(), url: Some(listen_url(&cfg)), error: None }
            }
            Err(e) => {
                let busy = e.downcast_ref::<std::io::Error>().map(|io| io.kind() == std::io::ErrorKind::AddrInUse).unwrap_or(false);
                let msg = if busy { format!("Port {} is already in use. Choose another port.", cfg.mcp_port) } else { format!("Could not listen on port {}: {e}", cfg.mcp_port) };
                McpStatus { state: "error".into(), url: None, error: Some(msg) }
            }
        }
    };
    *state.status.lock().unwrap() = status;
    publish(app, &state);
}

fn header_of(req: &tiny_http::Request, name: &str) -> Option<String> {
    req.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.as_str().to_string())
}

fn json_header() -> tiny_http::Header {
    tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..]).unwrap()
}

fn reply(req: tiny_http::Request, code: u16, body: &str, extra: &[(&str, &str)]) {
    let mut r = tiny_http::Response::from_string(body).with_status_code(code).with_header(json_header());
    for (k, v) in extra {
        if let Ok(h) = tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()) {
            r = r.with_header(h);
        }
    }
    let _ = req.respond(r);
}

fn error_body(msg: &str) -> String {
    serde_json::json!({ "error": msg }).to_string()
}

fn handle(app: AppHandle, mut req: tiny_http::Request) {
    let state = app.state::<McpState>();
    let cfg = state.cfg.lock().unwrap().clone();
    if norm_path(req.url()) != cfg.mcp_path {
        return reply(req, 404, &error_body("Not found"), &[]);
    }
    let host = header_of(&req, "host");
    if !host_ok(host.as_deref(), cfg.mcp_lan) || !origin_ok(header_of(&req, "origin").as_deref(), host.as_deref()) {
        return reply(req, 403, &error_body("Cross-origin request refused"), &[]);
    }
    let presented = header_of(&req, "authorization");
    let used = presented.as_deref().and_then(bearer).and_then(|token| cfg.tokens.iter().find(|t| same(&t.token, token)).map(|t| t.id.clone()));
    let Some(used) = used else {
        return reply(req, 401, &error_body("A valid agent token is required"), &[("WWW-Authenticate", "Bearer")]);
    };
    if *req.method() != tiny_http::Method::Post {
        return reply(req, 405, &error_body("POST JSON-RPC messages to this endpoint"), &[("Allow", "POST")]);
    }
    let mut body = String::new();
    if req.as_reader().take(MAX_BODY + 1).read_to_string(&mut body).is_err() {
        return reply(req, 400, &error_body("The body is not text"), &[]);
    }
    if body.len() as u64 > MAX_BODY {
        return reply(req, 413, &error_body("The message is too large"), &[]);
    }
    note_use(&app, &state, &used);
    if !state.ready.load(Ordering::Relaxed) {
        return reply(req, 503, &error_body("Ergonotes is still starting. Try again in a moment."), &[]);
    }
    let id = state.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    state.pending.lock().unwrap().insert(id, tx);
    let _ = app.emit("mcp-request", serde_json::json!({ "id": id, "body": body }));
    let answer = rx.recv_timeout(ANSWER_WITHIN);
    state.pending.lock().unwrap().remove(&id);
    match answer {
        Ok((202, _)) => reply(req, 202, "", &[]),
        Ok((code, out)) => reply(req, code, &out, &[]),
        Err(_) => reply(req, 504, &error_body("Ergonotes did not answer in time"), &[]),
    }
}

/// Remember when a token was last used; the file is written at most once a minute.
fn note_use(app: &AppHandle, state: &McpState, id: &str) {
    let mut cfg = state.cfg.lock().unwrap();
    if let Some(t) = cfg.tokens.iter_mut().find(|t| t.id == id) {
        t.last_used = Some(now_ms());
    }
    let mut last = state.saved_use.lock().unwrap();
    if last.elapsed() > Duration::from_secs(60) {
        *last = Instant::now();
        let _ = save(app, &cfg);
    }
}

// ---------------------------------------------------------------- commands the webview calls

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInfo {
    enabled: bool,
    port: u16,
    path: String,
    lan: bool,
    close_to_tray: bool,
    tray_ok: bool,
    status: McpStatus,
    tokens: Vec<Token>,
    discovery_file: Option<String>,
}

fn info(app: &AppHandle, state: &McpState) -> McpInfo {
    let cfg = state.cfg.lock().unwrap();
    McpInfo {
        enabled: cfg.mcp_enabled,
        port: cfg.mcp_port,
        path: cfg.mcp_path.clone(),
        lan: cfg.mcp_lan,
        close_to_tray: cfg.close_to_tray,
        tray_ok: state.tray_ok.load(Ordering::Relaxed),
        status: state.status(),
        tokens: cfg.tokens.clone(),
        discovery_file: discovery_file(app).map(|p| p.to_string_lossy().into_owned()),
    }
}

#[tauri::command]
pub fn mcp_get(app: AppHandle, state: State<McpState>) -> McpInfo {
    info(&app, &state)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPatch {
    enabled: Option<bool>,
    port: Option<u16>,
    path: Option<String>,
    lan: Option<bool>,
    close_to_tray: Option<bool>,
}

#[tauri::command]
pub fn mcp_configure(app: AppHandle, state: State<McpState>, patch: McpPatch) -> Result<McpInfo, String> {
    if let Some(p) = patch.port {
        valid_port(p)?;
    }
    if let Some(p) = &patch.path {
        valid_path(p)?;
    }
    let listener_changes = patch.enabled.is_some() || patch.port.is_some() || patch.path.is_some() || patch.lan.is_some();
    {
        let mut cfg = state.cfg.lock().unwrap();
        if let Some(v) = patch.enabled { cfg.mcp_enabled = v }
        if let Some(v) = patch.port { cfg.mcp_port = v }
        if let Some(v) = patch.path { cfg.mcp_path = v }
        if let Some(v) = patch.lan { cfg.mcp_lan = v }
        if let Some(v) = patch.close_to_tray { cfg.close_to_tray = v }
        save(&app, &cfg)?;
    }
    if listener_changes {
        start(&app);
    }
    Ok(info(&app, &state))
}

/// Edit the token list, keep the file and the discovery file in step, and answer with the new state.
fn edit_tokens(app: &AppHandle, state: &McpState, f: impl FnOnce(&mut Vec<Token>) -> Result<(), String>) -> Result<McpInfo, String> {
    {
        let mut cfg = state.cfg.lock().unwrap();
        f(&mut cfg.tokens)?;
        if cfg.tokens.is_empty() {
            cfg.tokens.push(new_token_record(DEFAULT_TOKEN, "Claude Code"));
        }
        save(app, &cfg)?;
    }
    publish(app, state);
    Ok(info(app, state))
}

#[tauri::command]
pub fn mcp_token_create(app: AppHandle, state: State<McpState>, name: String) -> Result<McpInfo, String> {
    let name = if name.trim().is_empty() { "Agent".to_string() } else { name.trim().chars().take(40).collect() };
    edit_tokens(&app, &state, |t| {
        t.push(new_token_record(&random_hex(6), &name));
        Ok(())
    })
}

/// The person types in a token of their own (to share one with another tool, for instance).
#[tauri::command]
pub fn mcp_token_set(app: AppHandle, state: State<McpState>, id: String, value: String) -> Result<McpInfo, String> {
    let value = value.trim().to_string();
    valid_token(&value)?;
    edit_tokens(&app, &state, |t| {
        if t.iter().any(|x| x.id != id && same(&x.token, &value)) {
            return Err("Another token already uses that value".into());
        }
        t.iter_mut().find(|x| x.id == id).ok_or("No such token")?.token = value;
        Ok(())
    })
}

#[tauri::command]
pub fn mcp_token_regenerate(app: AppHandle, state: State<McpState>, id: String) -> Result<McpInfo, String> {
    edit_tokens(&app, &state, |t| {
        let x = t.iter_mut().find(|x| x.id == id).ok_or("No such token")?;
        x.token = new_token();
        x.last_used = None;
        Ok(())
    })
}

#[tauri::command]
pub fn mcp_token_revoke(app: AppHandle, state: State<McpState>, id: String) -> Result<McpInfo, String> {
    edit_tokens(&app, &state, |t| {
        if id == DEFAULT_TOKEN {
            // the plugin needs one: revoking the default replaces it
            if let Some(x) = t.iter_mut().find(|x| x.id == id) {
                x.token = new_token();
                x.last_used = None;
            }
        } else {
            t.retain(|x| x.id != id);
        }
        Ok(())
    })
}

/// The webview's answer to one `mcp-request`.
#[tauri::command]
pub fn mcp_respond(state: State<McpState>, id: u64, status: u16, body: String) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
        let _ = tx.send((status, body));
    }
}

/// The webview says whether it can answer requests (its listener is installed and the vault is open).
#[tauri::command]
pub fn mcp_ready(state: State<McpState>, ready: bool) {
    state.ready.store(ready, Ordering::Relaxed);
}

pub fn manage(app: &AppHandle) {
    let cfg = load(app);
    // a phone has no endpoint: it keeps no settings file and no token
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let _ = save(app, &cfg);
    app.manage(McpState {
        cfg: Mutex::new(cfg),
        status: Mutex::new(McpStatus { state: "off".into(), url: None, error: None }),
        running: Mutex::new(None),
        pending: Mutex::new(HashMap::new()),
        next: AtomicU64::new(1),
        ready: AtomicBool::new(false),
        tray_ok: AtomicBool::new(false),
        saved_use: Mutex::new(Instant::now()),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_this_machine_may_name_the_endpoint_unless_the_network_is_allowed() {
        assert!(host_ok(Some("127.0.0.1:7424"), false));
        assert!(host_ok(Some("localhost:7424"), false));
        assert!(host_ok(Some("[::1]:7424"), false));
        assert!(!host_ok(Some("evil.example:7424"), false));
        assert!(!host_ok(Some("192.168.1.5:7424"), false));
        assert!(!host_ok(None, false));
        assert!(host_ok(Some("192.168.1.5:7424"), true));
    }

    #[test]
    fn a_web_page_of_another_origin_is_refused_and_an_agent_is_not() {
        assert!(origin_ok(None, Some("127.0.0.1:7424")));
        assert!(origin_ok(Some("http://127.0.0.1:7424"), Some("127.0.0.1:7424")));
        assert!(!origin_ok(Some("https://evil.example"), Some("127.0.0.1:7424")));
        assert!(!origin_ok(Some("null"), Some("127.0.0.1:7424")));
        assert!(!origin_ok(Some("http://127.0.0.1:7424"), None));
    }

    #[test]
    fn tokens_paths_and_ports_are_checked() {
        assert!(valid_token("ergo_0123456789abcdef").is_ok());
        assert!(valid_token("short").is_err());
        assert!(valid_token("has space in it 123456").is_err());
        assert!(valid_token(&"a".repeat(129)).is_err());
        assert!(valid_path("/mcp").is_ok());
        assert!(valid_path("/a/b-c_d.e").is_ok());
        assert!(valid_path("mcp").is_err());
        assert!(valid_path("/").is_err());
        assert!(valid_path("/a//b").is_err());
        assert!(valid_path("/a b").is_err());
        assert!(valid_port(7424).is_ok());
        assert!(valid_port(80).is_err());
    }

    #[test]
    fn a_bearer_header_yields_its_token() {
        assert_eq!(bearer("Bearer abc"), Some("abc"));
        assert_eq!(bearer("Bearer "), None);
        assert_eq!(bearer("Basic abc"), None);
        assert!(same("abc", "abc"));
        assert!(!same("abc", "abd"));
        assert!(!same("abc", "abcd"));
        assert_eq!(norm_path("/mcp?x=1"), "/mcp");
    }

    #[test]
    fn generated_tokens_are_long_and_different() {
        let (a, b) = (new_token(), new_token());
        assert!(a.starts_with("ergo_") && a.len() == 5 + 48);
        assert_ne!(a, b);
        assert!(valid_token(&a).is_ok());
    }

    #[test]
    fn the_defaults_listen_on_this_machine_at_a_fixed_address() {
        let c = DesktopConfig::default();
        assert!(c.mcp_enabled && !c.mcp_lan && c.close_to_tray);
        assert_eq!(listen_url(&c), "http://127.0.0.1:7424/mcp");
    }
}
