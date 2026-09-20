use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandChild;

pub const HEALTH_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(serde::Deserialize, Clone)]
pub struct NativesManifest {
    pub version: String,
    pub files: Vec<String>,
}

pub fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind ephemeral port")
        .local_addr()
        .expect("local addr")
        .port()
}

/// Mirror the SDK loader's own resolution
/// (`@oh-my-pi/pi-natives/native/loader-state.js`): natives live in
/// `$XDG_DATA_HOME/omp/natives` when that root exists, else `~/.omp/natives`.
/// `PI_CONFIG_DIR` does NOT relocate this cache.
pub fn natives_dir() -> PathBuf {
    #[cfg(not(windows))]
    if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
        if !xdg.is_empty() {
            let root = PathBuf::from(&xdg).join("omp");
            if root.exists() {
                return root.join("natives");
            }
        }
    }
    dirs::home_dir()
        .unwrap_or_default()
        .join(".omp")
        .join("natives")
}

/// Prefer the bundled resource; in `tauri dev` (and `--no-bundle` builds) the
/// resource dir may not be materialized, so fall back to the repo path.
fn resolve_resource(app: &AppHandle, rel: &str, fallback: PathBuf) -> PathBuf {
    if let Ok(p) = app.path().resolve(rel, BaseDirectory::Resource) {
        if p.exists() {
            eprintln!("resource `{rel}` resolved: {}", p.display());
            return p;
        }
    }
    eprintln!("resource `{rel}` missing, fallback: {}", fallback.display());
    fallback
}

fn natives_resource_dir(app: &AppHandle) -> PathBuf {
    resolve_resource(
        app,
        "natives",
        Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join("natives"),
    )
}

pub fn web_dist(app: &AppHandle) -> PathBuf {
    resolve_resource(
        app,
        "web",
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("web")
            .join("dist"),
    )
}

/// Copy the signed addon resource into the versioned natives cache the loader
/// probes first. Never writes into the signed .app bundle.
pub fn provision_native(app: &AppHandle) -> Result<NativesManifest, String> {
    let base = natives_resource_dir(app);
    let manifest_path = base.join("natives-manifest.json");
    let raw = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("read manifest {}: {e}", manifest_path.display()))?;
    let manifest: NativesManifest =
        serde_json::from_str(&raw).map_err(|e| format!("parse manifest: {e}"))?;

    let dest_dir = natives_dir().join(&manifest.version);
    std::fs::create_dir_all(&dest_dir).map_err(|e| format!("mkdir natives: {e}"))?;
    for file in &manifest.files {
        let dest = dest_dir.join(file);
        if dest.exists() {
            continue;
        }
        let src = base.join(file);
        std::fs::copy(&src, &dest).map_err(|e| format!("copy addon {}: {e}", src.display()))?;
    }
    Ok(manifest)
}

/// Ready when `GET /api/health` (with the launch token) answers 2xx. ureq errors
/// on non-2xx, so the token guard (401) is a miss rather than a false ready.
pub fn health_ok(port: u16, token: &str) -> bool {
    let url = format!("http://127.0.0.1:{port}/api/health");
    matches!(
        ureq::get(&url)
            .set("x-ai-gui-token", token)
            .timeout(Duration::from_millis(800))
            .call(),
        Ok(res) if res.status() == 200
    )
}

pub fn wait_for_health(port: u16, token: &str) -> bool {
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    while Instant::now() < deadline {
        if health_ok(port, token) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

/// Graceful stop that works on Windows: ask the sidecar to shut down over its
/// stdin, wait up to 3s, then hard-kill. Replaces unix-only SIGTERM.
pub fn kill_graceful(mut child: CommandChild) {
    let _ = child.write(b"{\"op\":\"shutdown\"}\n");
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if !is_alive(pid_of(&child)) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
}

#[cfg(unix)]
fn is_alive(pid: i32) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}

#[cfg(windows)]
fn is_alive(_pid: i32) -> bool {
    // The shell plugin exposes no liveness check; rely on the kill deadline
    // instead of a probe. Returns true until the timeout, then hard-kill.
    true
}

fn pid_of(child: &CommandChild) -> i32 {
    child.pid() as i32
}

#[cfg(test)]
mod tests {
    use super::natives_dir;
    use std::path::Path;

    #[test]
    fn natives_dir_defaults_to_omp_natives() {
        // XDG is only used when its omp root already exists; unset it so the
        // default branch is exercised deterministically.
        #[cfg(not(windows))]
        std::env::remove_var("XDG_DATA_HOME");
        assert!(natives_dir().ends_with(Path::new(".omp").join("natives")));
    }
}
