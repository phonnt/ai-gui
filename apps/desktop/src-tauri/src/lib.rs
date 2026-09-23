mod sidecar;

use std::io::Write;
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
    /// Bumped on every `restart_sidecar`; a monitor thread from an older
    /// generation stops acting so two sidecars never race the window.
    generation: Mutex<u64>,
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("random bytes");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Write the gateway token where only this user can read it, and hand the
/// sidecar the *path* rather than the secret.
///
/// Bun gives a child spawned without an explicit `env` the launcher's original
/// environment, so a token that starts life in the environment is inherited by
/// tool children no matter what the server scrubs afterwards — and the SDK's
/// in-turn bash tool spawns exactly that way. A path is not a secret; the
/// sidecar reads the file and unlinks it before it serves anything.
fn write_token_file(dir: &std::path::Path, token: &str) -> Result<std::path::PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join("gateway-token");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path).map_err(|e| e.to_string())?;
    file.write_all(token.as_bytes()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // `mode` only applies when the file is created; a file left behind by a
        // crashed run keeps its old bits, so set them explicitly.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    Ok(path)
}

/// `PI_CONFIG_DIR` is a directory *name* relative to `$HOME`, not a path. The
/// SDK joins it back onto the home dir; pass the app data dir with the `$HOME`
/// prefix stripped. Falls back to `.omp` when it is not under `$HOME`.
fn config_relative_to_home(config_dir: &str) -> String {
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    std::path::Path::new(config_dir)
        .strip_prefix(&home)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| {
            eprintln!(
                "[grove] config dir {config_dir} is not under home {home}; PI_CONFIG_DIR falls back to `.omp`, splitting config from app data"
            );
            ".omp".to_string()
        })
}

/// Old bundle id; its app-data dir is migrated once into the Grove id.
const LEGACY_IDENTIFIER: &str = "dev.aigui.desktop";

/// Copy the legacy app-data dir into the current one. Copy-only (no rename) so
/// the old dir always survives; the user can delete it once satisfied. Returns
/// the source path when a migration happened.
fn migrate_legacy_data(new_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    if new_dir.exists() {
        return None;
    }
    let old = new_dir.parent()?.join(LEGACY_IDENTIFIER);
    if !old.exists() {
        return None;
    }
    if copy_dir(&old, new_dir).is_ok() {
        return Some(old);
    }
    None
}

fn copy_dir(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

fn spawn_sidecar(
    app: &tauri::AppHandle,
    port: u16,
    token: &str,
    config_dir: &str,
    web_dist: &str,
) -> Result<CommandChild, String> {
    // Hand over a path, never the secret: see `write_token_file`.
    let token_path = write_token_file(std::path::Path::new(config_dir), token)?;
    let (mut rx, child) = app
        .shell()
        .sidecar("grove-server")
        .map_err(|e| e.to_string())?
        .env("GROVE_PORT", port.to_string())
        .env("GROVE_TOKEN_FILE", token_path.to_string_lossy().to_string())
        .env("PI_CONFIG_DIR", config_relative_to_home(config_dir))
        .env("PI_CODING_AGENT_DIR", format!("{config_dir}/agent"))
        .env("GROVE_WEB_DIST", web_dist.to_string())
        .env("GROVE_STDIN_SHUTDOWN", "1")
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
    eprintln!("[grove] app ready on 127.0.0.1:{port}");
}

/// Show the local error page (Tauri-served, has IPC) with the reason. Uses a
/// query param so the page never races an event that fired before it loaded.
fn goto_error(app: &tauri::AppHandle, message: &str) {
    if let Some(win) = app.get_webview_window("main") {
        if let Ok(mut url) = tauri::Url::parse("tauri://localhost/index.html") {
            url.query_pairs_mut().append_pair("error", message);
            let _ = win.navigate(url);
        }
    }
    eprintln!("[grove] error page: {message}");
    let _ = app.emit("sidecar-error", message);
}

fn current_generation(app: &tauri::AppHandle) -> u64 {
    *app.state::<SidecarState>().generation.lock().unwrap()
}

/// Spawn, wait for readiness, then drive the window and watch for crashes.
/// The monitor stops as soon as a newer generation supersedes it.
fn start(app: &tauri::AppHandle) {
    let generation = current_generation(app);
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
            if current_generation(&handle) == generation {
                goto_error(&handle, "server did not become ready in 15s");
            }
            return;
        }
        if current_generation(&handle) != generation {
            return;
        }
        goto_app(&handle, port);
        // Crash monitor: two consecutive misses surface the error page.
        let mut misses = 0;
        loop {
            std::thread::sleep(Duration::from_secs(5));
            if current_generation(&handle) != generation {
                return;
            }
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
        // Supersede any live monitor before replacing the child.
        *state.generation.lock().unwrap() += 1;
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
            // Before creating the new dir: migrate the pre-rename bundle id's
            // data so existing sessions/settings survive the rename.
            if let Some(old) = migrate_legacy_data(&config_dir) {
                eprintln!("[grove] migrated app data from {}", old.display());
            }
            std::fs::create_dir_all(&config_dir)?;
            #[cfg(unix)]
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
                .title("Grove")
                .inner_size(1200.0, 800.0)
                .build()?;

            let handle = app.handle().clone();
            std::thread::spawn(move || start(&handle));

            // Check the (placeholder) manifest on launch. Failures are logged
            // but non-fatal, so the app always starts. A check error is
            // expected until a real endpoint is hosted.
            let updater_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_updater::UpdaterExt;
                let updater = match updater_handle.updater() {
                    Ok(updater) => updater,
                    Err(e) => {
                        eprintln!("[updater] init failed: {e}");
                        return;
                    }
                };
                match updater.check().await {
                    Ok(Some(update)) => {
                        if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
                            eprintln!("[updater] download/install failed: {e}");
                            return;
                        }
                        // `restart()` re-execs the process, so `RunEvent::Exit`
                        // never fires and the exit hook cannot reap the child.
                        // Stop the old sidecar here or the relaunched app leaks
                        // it and spawns a second one on a new port.
                        if let Some(child) =
                            updater_handle.state::<SidecarState>().child.lock().unwrap().take()
                        {
                            sidecar::kill_graceful(child);
                        }
                        updater_handle.restart();
                    }
                    Ok(None) => {}
                    Err(e) => eprintln!("[updater] check failed: {e}"),
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

#[cfg(test)]
mod tests {
    use super::{config_relative_to_home, write_token_file};

    #[test]
    fn strips_the_home_prefix() {
        let home = dirs::home_dir().expect("home dir");
        let config_dir = home.join("Grove-test-dir");
        assert_eq!(
            config_relative_to_home(&config_dir.to_string_lossy()),
            "Grove-test-dir"
        );
    }

    #[test]
    fn falls_back_when_outside_home() {
        assert_eq!(config_relative_to_home("/definitely/not/under/home"), ".omp");
    }

    #[test]
    fn writes_the_token_to_a_private_file() {
        let dir = std::env::temp_dir().join(format!("grove-token-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let path = write_token_file(&dir, "secret-token").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "secret-token");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "token file must not be group/world readable");
        }

        // A stale file from a crashed run must not keep its old contents.
        std::fs::write(&path, "stale").unwrap();
        let again = write_token_file(&dir, "second-token").unwrap();
        assert_eq!(std::fs::read_to_string(again).unwrap(), "second-token");

        std::fs::remove_dir_all(&dir).ok();
    }
}

#[cfg(test)]
mod migrate_tests {
    use super::migrate_legacy_data;

    #[test]
    fn copies_legacy_dir_and_keeps_the_original() {
        let base = std::env::temp_dir().join(format!("grove-migrate-{}", std::process::id()));
        let old = base.join("dev.aigui.desktop");
        let new = base.join("dev.grove.desktop");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("marker.txt"), "x").unwrap();

        let migrated = migrate_legacy_data(&new);
        assert!(migrated.is_some());
        assert!(new.join("marker.txt").exists());
        assert!(old.join("marker.txt").exists(), "legacy dir must survive");
        assert!(migrate_legacy_data(&new).is_none(), "second run is a no-op");

        std::fs::remove_dir_all(&base).ok();
    }
}
