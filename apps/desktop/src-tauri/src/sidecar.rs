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
    if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
        if !xdg.is_empty() {
            let root = PathBuf::from(&xdg).join("omp");
            if root.exists() {
                return root.join("natives");
            }
        }
    }
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
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

/// Ready when `GET /api/health` (with the launch token) says `{ ok: true }`.
pub fn health_ok(port: u16, token: &str) -> bool {
    let url = format!("http://127.0.0.1:{port}/api/health");
    match ureq::get(&url)
        .set("x-ai-gui-token", token)
        .timeout(Duration::from_millis(800))
        .call()
    {
        Ok(res) => res
            .into_string()
            .map(|body| body.contains("\"ok\":true"))
            .unwrap_or(false),
        Err(_) => false,
    }
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

/// SIGTERM, wait up to 3s, then SIGKILL. The sidecar flushes its journal on
/// SIGTERM (its own SIGINT/SIGTERM handler), so a graceful stop is required.
pub fn kill_graceful(child: CommandChild) {
    let pid = child.pid() as i32;
    unsafe {
        libc::kill(pid, libc::SIGTERM);
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if unsafe { libc::kill(pid, 0) } != 0 {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
}
