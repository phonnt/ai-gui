# Grove Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đổi định danh dự án `ai-gui`/`AI-GUI` → `grove`/`Grove` trên toàn repo, kèm migration app-data do đổi bundle id, giữ macOS + Windows + CI xanh.

**Architecture:** Đổi cơ học theo bảng case-mapping, chia 5 bề mặt (scope → env → binary/bundle → CI/repo → docs) để `bun run check` xác nhận từng bước; phần rủi ro duy nhất là migration dữ liệu trong `setup()` của Tauri.

**Tech Stack:** Bun 1.3.14, TypeScript strict, Biome, Tauri v2 (Rust), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-20-grove-rename-design.md`

## Global Constraints

- Case mapping (chỉ những biến thể này): `Grove` (hiển thị), `grove` (kebab/id/scope), `GROVE` (env/const), `grove_lib` (Rust snake), `dev.grove.desktop` (bundle id).
- KHÔNG đổi: `omp`, `OMP`, `@oh-my-pi/*`, `~/.omp/**`, tên thư mục `apps/* packages/* scripts/* docs/*`, nội dung `docs/superpowers/specs/**` + `docs/superpowers/plans/**` (bản ghi lịch sử).
- `bun run check` xanh sau mỗi task; `bun run format` trước commit.
- Không commit build output (`target/`, `binaries/`, `dist/`, `resources/`).
- Migration app-data: KHÔNG xoá dữ liệu cũ.

---

### Task 1: npm scope + imports + lockfile

**Files:**
- Modify: `package.json`, `packages/*/package.json`, `apps/*/package.json`
- Modify: mọi file `.ts/.tsx` import `@ai-gui/*`
- Modify: `bun.lock` (regen)

**Interfaces:**
- Produces: package name `grove`, scope `@grove/*`. Mọi import nội bộ dùng `@grove/<pkg>`.

- [ ] **Step 1: Thay scope + root name trên file khai báo**

Chạy (chỉ trong file khai báo):
```sh
git ls-files 'package.json' 'packages/*/package.json' 'apps/*/package.json' \
  | xargs -I{} sh -c 'perl -pi -e "s{\@ai-gui/}{\@grove/}g; s{\"name\": \"ai-gui\"}{\"name\": \"grove\"}" {}'
grep -n '"name"' package.json packages/*/package.json apps/*/package.json
```

- [ ] **Step 2: Thay import trong source**

```sh
git grep -l '@ai-gui/' -- '*.ts' '*.tsx' '*.json' | xargs perl -pi -e 's{\@ai-gui/}{\@grove/}g'
```

- [ ] **Step 3: Regen lock + verify**

Run: `bun install && bun run typecheck`
Expected: install không lỗi resolve; typecheck PASS.

- [ ] **Step 4: Gate**

Run: `bun run check`
Expected: all green (smoke:server vẫn chạy được với package mới).

- [ ] **Step 5: Commit**

```sh
git add -A
git commit -m "refactor: rename npm scope to @grove/*"
```

---

### Task 2: Env vars `AI_GUI_*` → `GROVE_*`

**Files:**
- Modify: `apps/server/src/index.ts`, `apps/desktop/src-tauri/src/lib.rs`, `scripts/*.ts`, `.env.example`, `.github/workflows/desktop.yml`

**Interfaces:**
- Produces: `GROVE_PORT`, `GROVE_TOKEN`, `GROVE_WEB_DIST`, `GROVE_STDIN_SHUTDOWN`.

- [ ] **Step 1: Thay trên source/config**

```sh
git grep -l 'AI_GUI_' -- '*.ts' '*.tsx' '*.rs' '*.yml' '*.md' '.env.example' \
  | grep -v '^docs/superpowers/' \
  | xargs perl -pi -e 's/AI_GUI_/GROVE_/g'
grep -rn 'GROVE_' apps/server/src/index.ts apps/desktop/src-tauri/src/lib.rs .env.example | head
```

- [ ] **Step 2: Verify runtime**

Run: `bun run smoke:server && bun run smoke:sidecar`
Expected: `server smoke OK`, `sidecar smoke OK` (token/port/web-dist đọc đúng biến mới).

- [ ] **Step 3: Gate + commit**

```sh
bun run check
git add -A && git commit -m "refactor: rename env vars to GROVE_*"
```

---

### Task 3: Binary/sidecar/crate/product/bundle id + data migration

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, `src/main.rs`, `src/lib.rs`, `src/sidecar.rs`
- Modify: `scripts/build-desktop.ts`, `scripts/smoke-sidecar.ts`, `scripts/smoke-bundle.ts`, `scripts/package-macos.ts`, `scripts/smoke-tools.ts`
- Modify: `.github/workflows/desktop.yml`

**Interfaces:**
- Produces: crate `grove-desktop`, lib `grove_lib`, sidecar `grove-server`, app `Grove.app`, id `dev.grove.desktop`; `migrate_legacy_data(app)` trong `lib.rs`.

- [ ] **Step 1: Thay tên binary/crate/product/id (source + config, không đụng docs lịch sử)**

```sh
git ls-files 'apps/desktop/**' 'scripts/**' '.github/**' \
  | grep -v 'target/\|binaries/\|resources/' \
  | xargs perl -pi -e '
    s/ai_gui_desktop_lib/grove_lib/g;
    s/ai-gui-desktop/grove-desktop/g;
    s/ai-gui-server/grove-server/g;
    s/dev\.aigui\.desktop/dev.grove.desktop/g;
    s/AI-GUI\.app/Grove.app/g;
    s/AI-GUI/Grove/g;
  '
grep -rn "grove_lib\|grove-server\|dev.grove.desktop\|Grove.app" apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/src/main.rs | head
```

- [ ] **Step 2: Migration hook (rủi ro cao — viết test Rust trước)**

Thêm vào `apps/desktop/src-tauri/src/lib.rs`:

```rust
/// Old bundle id; its app-data dir is migrated once into the Grove id.
const LEGACY_IDENTIFIER: &str = "dev.aigui.desktop";

/// Copy the legacy app-data dir into the current one. Never deletes
/// the old dir. Returns the source path when a migration happened.
fn migrate_legacy_data(new_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    if new_dir.exists() {
        return None;
    }
    let old = new_dir.parent()?.join(LEGACY_IDENTIFIER);
    if !old.exists() {
        return None;
    }
    // Copy-only so the legacy dir always survives.
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
```

Trong `setup()`, ngay sau `let config_dir = app.path().app_data_dir()...`:

```rust
            if let Some(old) = migrate_legacy_data(&config_dir) {
                eprintln!("[grove] migrated app data from {}", old.display());
            }
```
(đặt trước `std::fs::create_dir_all(&config_dir)?` để `new_dir.exists()` còn phản ánh trạng thái thật.)

Thêm test (cuối `lib.rs`):
```rust
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
```

- [ ] **Step 3: Verify Rust**

Run: `cd apps/desktop/src-tauri && cargo test --quiet`
Expected: PASS (test mới + 3 test cũ).

- [ ] **Step 4: Build + smoke (macOS)**

Run: `bun run build:desktop && bun run smoke:sidecar`
Expected: `binaries/grove-server-aarch64-apple-darwin`; smoke OK.

- [ ] **Step 5: Commit**

```sh
git add -A && git commit -m "refactor(desktop): rename binaries, crate, and bundle id to Grove (+ data migration)"
```

---

### Task 4: Artifacts + CI + repo rename

**Files:**
- Modify: `scripts/package-macos.ts`, `.github/workflows/desktop.yml`

**Interfaces:**
- Produces: `dist/macos/Grove-<version>-macos-<arch>.{dmg,zip}`; CI artifact `grove-macos`, `grove-windows`.

- [ ] **Step 1: Artifact naming**

Trong `scripts/package-macos.ts`: `base = \`Grove-${version}-macos-${process.arch}\``; volname `Grove`.
Trong workflow: upload name `grove-macos` / `grove-windows`; release title/notes `Grove`.

- [ ] **Step 2: Verify packaging**

Run: `bun run dist:macos && bun run smoke:bundle`
Expected: sinh `dist/macos/Grove-0.1.0-macos-arm64.{dmg,zip}`; `bundle smoke OK`.

- [ ] **Step 3: Repo rename (cần user GitHub scope)**

Run:
```sh
gh repo rename grove --repo phonnt/ai-gui --yes
git remote set-url origin https://github.com/phonnt/grove.git
git remote -v
```
Expected: repo `phonnt/grove`; URL `.../ai-gui` tự redirect.

- [ ] **Step 4: Push + CI**

Run: `git push origin main && gh workflow run desktop.yml --ref main`
Expected: `verify` + `windows` xanh (`release` skip nếu không phải tag).

- [ ] **Step 5: Commit**

```sh
git add -A && git commit -m "ci(desktop): Grove artifact names"
```

---

### Task 5: Docs, UI strings, allowlist

**Files:**
- Modify: `AGENTS.md`, `docs/architecture.md`, `docs/runbook.md`, `docs/desktop-release.md`, `docs/tui-parity-status.md`, `.omp/RULES.md`, `.omp/rules/*.md`
- Modify: `apps/web/index.html`, chuỗi `AI-GUI` trong `apps/web/src`, `apps/desktop/placeholder/index.html`
- Modify: `apps/server/src/index.ts` banner

- [ ] **Step 1: Thay chuỗi hiển thị trong docs hiện hành + UI**

```sh
git ls-files '*.md' '*.html' 'apps/web/src/**' 'apps/server/src/**' '.omp/**' \
  | grep -v '^docs/superpowers/specs/\|^docs/superpowers/plans/' \
  | xargs perl -pi -e 's/AI-GUI Desktop/Grove Desktop/g; s/AI-GUI/Grove/g; s/\bai-gui\b/grove/g'
```

- [ ] **Step 2: Grep allowlist**

Run:
```sh
git grep -n 'ai-gui\|AI_GUI\|aigui' -- ':!docs/superpowers/specs/**' ':!docs/superpowers/plans/**' ':!bun.lock' || echo "clean"
```
Expected: `clean` (chỉ còn trong allowlist).

- [ ] **Step 3: Gate + commit**

```sh
bun run format && bun run check
git add -A && git commit -m "docs: rename project to Grove"
```

---

### Task 6: End-to-end verification

- [ ] **Step 1: Full local gate**

Run: `bun run check && bun run build:desktop && bun run smoke:sidecar && bun run dist:macos && bun run smoke:bundle`
Expected: tất cả PASS; DMG `Grove-0.1.0-macos-arm64.dmg`.

- [ ] **Step 2: Migration thực tế**

Tạo dir giả rồi mở app (hoặc chạy `Grove.app/Contents/MacOS/grove-desktop`):
```sh
mkdir -p "$HOME/Library/Application Support/dev.aigui.desktop" && touch "$HOME/Library/Application Support/dev.aigui.desktop/probe.txt"
"apps/desktop/src-tauri/target/release/bundle/macos/Grove.app/Contents/MacOS/grove-desktop" >/tmp/grove.log 2>&1 &
sleep 6; grep -i "migrated app data" /tmp/grove.log; ls "$HOME/Library/Application Support/dev.grove.desktop/probe.txt"; pkill -f grove-desktop
```
Expected: log migrate; file probe có ở dir mới; dir cũ vẫn còn.

- [ ] **Step 3: CI xanh + push**

Run: `git push origin main && gh workflow run desktop.yml --ref main`
Expected: `verify` + `windows` success.

- [ ] **Step 4: Final grep + report**

Run: `git grep -n 'ai-gui\|AI_GUI\|aigui' -- ':!docs/superpowers/**' || echo clean`
Expected: `clean`.

---

## Self-Review

**Spec coverage:** §3 bảng quyết định → Task 1 (scope), Task 2 (env), Task 3 (binary/crate/id/migration), Task 4 (artifact/repo/CI), Task 5 (docs/UI). §5 migration → Task 3 Step 2 + Task 6 Step 2. §6 không đổi → Global Constraints + Task 5 Step 1 exclusion. §7 allowlist → Task 5 Step 2, Task 6 Step 4. §8 verification → Task 6.

**Placeholder scan:** không có TBD; các bước có lệnh/code cụ thể.

**Type consistency:** `migrate_legacy_data(&Path) -> Option<PathBuf>`, `copy_dir(&Path,&Path) -> io::Result<()>`, `LEGACY_IDENTIFIER`; `GROVE_*` khớp giữa server/desktop/scripts/CI; `grove-server` khớp giữa build script, `externalBin`, smokes, CI.

**Chưa chắc:** rename repo GitHub cần quyền; `gh repo rename` giữ redirect. Nếu không đổi repo, Task 4 Step 3 bỏ qua (spec cho phép).
