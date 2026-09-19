mod sidecar;

use std::sync::Mutex;
use std::time::Duration;

use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    port: Mutex<u16>,
    token: Mutex<String>,
    config_dir: Mutex<String>,
    web_dist: Mutex<String>,
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("random bytes");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `PI_CONFIG_DIR` is a directory *name* relative to `$HOME`, not a path. The
/// SDK joins it back onto the home dir; pass the app data dir with the `$HOME`
/// prefix stripped. Falls back to `.omp` when it is not under `$HOME`.
fn config_relative_to_home(config_dir: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    std::path::Path::new(config_dir)
        .strip_prefix(&home)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| ".omp".to_string())
}

fn spawn_sidecar(
    app: &tauri::AppHandle,
    port: u16,
    token: &str,
    config_dir: &str,
    web_dist: &str,
) -> Result<CommandChild, String> {
    let (mut rx, child) = app
        .shell()
        .sidecar("ai-gui-server")
        .map_err(|e| e.to_string())?
        .env("AI_GUI_PORT", port.to_string())
        .env("AI_GUI_TOKEN", token.to_string())
        .env("PI_CONFIG_DIR", config_relative_to_home(config_dir))
        .env("PI_CODING_AGENT_DIR", format!("{config_dir}/agent"))
        .env("AI_GUI_WEB_DIST", web_dist.to_string())
        .spawn()
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let tauri_plugin_shell::process::CommandEvent::Stderr(line) = event {
                eprintln!("[sidecar] {}", String::from_utf8_lossy(&line));
            }
        }
    });
    Ok(child)
}

/// Navigate the main window to the served app once the server is ready.
fn goto_app(app: &tauri::AppHandle, port: u16) {
    if let Some(win) = app.get_webview_window("main") {
        let url = format!("http://127.0.0.1:{port}");
        let _ = win.navigate(url.parse().expect("app url"));
    }
    eprintln!("[main] app ready on 127.0.0.1:{port}");
}

/// Show the local error page (Tauri-served, has IPC) with the reason. Uses a
/// query param so the page never races an event that fired before it loaded.
fn goto_error(app: &tauri::AppHandle, message: &str) {
    if let Some(win) = app.get_webview_window("main") {
        let encoded: String = message
            .chars()
            .map(|c| if c == ' ' { "%20".to_string() } else { c.to_string() })
            .collect();
        let url = format!("tauri://localhost/index.html?error={encoded}");
        if let Ok(parsed) = tauri::Url::parse(&url) {
            let _ = win.navigate(parsed);
        }
    }
    eprintln!("[main] error page: {message}");
    let _ = app.emit("sidecar-error", message);
}

/// Spawn, wait for readiness, then drive the window and watch for crashes.
fn start(app: &tauri::AppHandle) {
    let (port, token, config_dir, web_dist) = {
        let state = app.state::<SidecarState>();
        let port = *state.port.lock().unwrap();
        let token = state.token.lock().unwrap().clone();
        let config_dir = state.config_dir.lock().unwrap().clone();
        let web_dist = state.web_dist.lock().unwrap().clone();
        (port, token, config_dir, web_dist)
    };

    match spawn_sidecar(app, port, &token, &config_dir, &web_dist) {
        Ok(child) => {
            app.state::<SidecarState>()
                .child
                .lock()
                .unwrap()
                .replace(child);
        }
        Err(e) => {
            goto_error(app, &format!("spawn failed: {e}"));
            return;
        }
    }

    let handle = app.clone();
    std::thread::spawn(move || {
        if !sidecar::wait_for_health(port, &token) {
            goto_error(&handle, "server did not become ready in 15s");
            return;
        }
        goto_app(&handle, port);
        // Crash monitor: two consecutive misses surface the error page.
        let mut misses = 0;
        loop {
            std::thread::sleep(Duration::from_secs(5));
            if sidecar::health_ok(port, &token) {
                misses = 0;
                continue;
            }
            misses += 1;
            if misses >= 2 {
                goto_error(&handle, "server stopped");
                return;
            }
        }
    });
}

#[tauri::command]
fn restart_sidecar(app: tauri::AppHandle) {
    {
        let state = app.state::<SidecarState>();
        let child = state.child.lock().unwrap().take();
        if let Some(child) = child {
            sidecar::kill_graceful(child);
        }
    }
    start(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState::default())
        .invoke_handler(tauri::generate_handler![restart_sidecar])
        .setup(|app| {
            let config_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app_data_dir: {e}"))?;
            std::fs::create_dir_all(&config_dir)?;
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&config_dir, std::fs::Permissions::from_mode(0o700))?;
            }
            if let Err(e) = sidecar::provision_native(app.handle()) {
                eprintln!("native addon provisioning failed: {e}");
            }
            let web_dist = sidecar::web_dist(app.handle());

            let port = sidecar::free_port();
            let token = random_token();
            {
                let state = app.state::<SidecarState>();
                *state.port.lock().unwrap() = port;
                *state.token.lock().unwrap() = token;
                *state.config_dir.lock().unwrap() = config_dir.to_string_lossy().to_string();
                *state.web_dist.lock().unwrap() = web_dist.to_string_lossy().to_string();
            }

            // Window opens immediately on the local loading page; it is
            // navigated to the server (or the error page) by `start`.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("AI-GUI")
                .inner_size(1200.0, 800.0)
                .build()?;

            let handle = app.handle().clone();
            std::thread::spawn(move || start(&handle));

            // Check the (placeholder) manifest on launch. A failing check is
            // expected until a real endpoint is hosted; it is intentionally
            // non-fatal so the app always starts.
            let updater_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_updater::UpdaterExt;
                if let Ok(updater) = updater_handle.updater() {
                    if let Ok(Some(update)) = updater.check().await {
                        if update
                            .download_and_install(|_, _| {}, || {})
                            .await
                            .is_ok()
                        {
                            updater_handle.restart();
                        }
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(child) = app_handle
                    .state::<SidecarState>()
                    .child
                    .lock()
                    .unwrap()
                    .take()
                {
                    sidecar::kill_graceful(child);
                }
            }
        });
}
