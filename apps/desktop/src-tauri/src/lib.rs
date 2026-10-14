// The shell is deliberately thin: all note logic, sync and encryption live in the TypeScript core that runs
// in the webview. Rust only provides the window, a CORS-free HTTP client for S3/WebDAV, and local notifications.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("error while running Ergonotes");
}
