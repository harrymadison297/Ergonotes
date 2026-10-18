// The desktop shell around the window: the tray icon, "close hides to the tray", and starting with the system.
// Only compiled for the desktop targets (see lib.rs); a phone has none of this.
use std::sync::Mutex;

use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};
use tauri_plugin_autostart::ManagerExt;

use crate::mcp::McpState;

/// The tray's menu line that says how the MCP endpoint stands, kept so it can be reworded.
pub struct TrayLine(pub Mutex<Option<MenuItem<Wry>>>);

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// "MCP: http://127.0.0.1:7424/mcp", "MCP: off" or "MCP: port 7424 is busy".
fn status_line(app: &AppHandle) -> String {
    let st = app.state::<McpState>().status();
    match st.state.as_str() {
        "running" => format!("MCP: {}", st.url.unwrap_or_default()),
        "error" => format!("MCP: {}", st.error.unwrap_or_else(|| "not running".into())),
        _ => "MCP: off".into(),
    }
}

pub fn refresh_tray(app: &AppHandle) {
    if let Some(line) = app.try_state::<TrayLine>() {
        if let Some(item) = line.0.lock().unwrap().as_ref() {
            let _ = item.set_text(status_line(app));
        }
    }
}

/// Creates the tray icon. `false` when the system has none (GNOME without the AppIndicator extension): the window then
/// closes like any other, so it can never end up hidden with no way back.
pub fn setup_tray(app: &AppHandle) -> bool {
    // creating the icon "works" even where nothing shows it, so ask the desktop whether it has a tray at all
    #[cfg(target_os = "linux")]
    if !linux_tray_available() {
        return false;
    }
    let build = || -> tauri::Result<()> {
        let open = MenuItem::with_id(app, "open", "Open Ergonotes", true, None::<&str>)?;
        let line = MenuItem::with_id(app, "mcp", status_line(app), false, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        let sep = PredefinedMenuItem::separator(app)?;
        let items: [&dyn IsMenuItem<Wry>; 4] = [&open, &line, &sep, &quit];
        let menu = Menu::with_items(app, &items)?;
        let mut tray = TrayIconBuilder::with_id("main")
            .tooltip("Ergonotes")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id.as_ref() {
                "open" => show_main(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                    show_main(tray.app_handle());
                }
            });
        if let Some(icon) = app.default_window_icon() {
            tray = tray.icon(icon.clone());
        }
        tray.build(app)?;
        app.manage(TrayLine(Mutex::new(Some(line))));
        Ok(())
    };
    build().is_ok()
}

pub fn desktop_autostart_get(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

pub fn desktop_autostart_set(app: AppHandle, on: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    if on { manager.enable() } else { manager.disable() }.map_err(|e| e.to_string())?;
    manager.is_enabled().map_err(|e| e.to_string())
}

/// Does the session have a status-notifier host (KDE, Xfce, Cinnamon, GNOME with the AppIndicator extension)?
#[cfg(target_os = "linux")]
fn linux_tray_available() -> bool {
    let out = std::process::Command::new("dbus-send")
        .args(["--session", "--dest=org.freedesktop.DBus", "--print-reply", "/org/freedesktop/DBus", "org.freedesktop.DBus.NameHasOwner", "string:org.kde.StatusNotifierWatcher"])
        .output();
    matches!(out, Ok(o) if o.status.success() && String::from_utf8_lossy(&o.stdout).contains("boolean true"))
}

/// The system started the app (not a person): stay in the tray when there is one.
pub fn started_hidden() -> bool {
    std::env::args().any(|a| a == "--hidden")
}
