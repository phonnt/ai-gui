# Rename project to Grove — Design Spec

- Status: proposed (chờ user review)
- Ngày: 2026-09-20
- Phạm vi: đổi định danh dự án `ai-gui` / `AI-GUI` → `grove` / `Grove` trên toàn repo
- Liên quan: `docs/architecture.md`, `AGENTS.md`, `apps/desktop`, `.github/workflows/desktop.yml`

## 1. Mục tiêu

Đổi tên sản phẩm và định danh kỹ thuật sang **Grove**, nhất quán từ tên hiển thị tới package scope, env var, binary, bundle id, artifact và repo — để không còn tình trạng "tên tạm" nửa vời.

Tên hợp với định hướng tương lai (nhiều runtime, switch runtime): Grove đặt tên cho *workspace phiên agent* (session tree/branch, nhiều agent), không gắn runtime nào.

**Trong phạm vi**
- Tên hiển thị, bundle id, tên binary/sidecar, tên crate Rust.
- npm package scope `@ai-gui/*` → `@grove/*`.
- Env var `AI_GUI_*` → `GROVE_*`.
- Repo GitHub `phonnt/ai-gui` → `phonnt/grove`; artifact/CI/release names.
- Docs & meta (AGENTS, architecture, runbook, desktop-release, README, title UI).
- **Migration dữ liệu** từ bundle id cũ sang mới.

**Ngoài phạm vi**
- Đổi `~/.omp` (native cache) — thuộc OMP, giữ nguyên.
- Đổi `@oh-my-pi/*`, `omp`, mọi tham chiếu OMP — giữ nguyên.
- Viết lại nội dung các spec/plan lịch sử (`docs/superpowers/specs|plans/*`) — giữ làm bản ghi.
- Đổi tên thư mục `apps/*`, `packages/*` — giữ (chỉ đổi package name bên trong).

## 2. Quy tắc chung

- **Case mapping:** `Grove` (hiển thị), `grove` (id/kebab/scope), `GROVE` (env/const), `grove_lib`/`grove_*` (Rust snake), `dev.grove.desktop` (bundle id).
- **Một nguồn sự thật:** mọi nơi lấy từ bundle id / productName / package name; không hardcode thêm biến thể mới.
- **Kiểm tra cuối:** `grep -rIn "ai-gui\|AI_GUI\|@ai-gui\|aigui"` chỉ còn trong allowlist (§7) hoặc trong các bản ghi lịch sử.

## 3. Quyết định

| Hạng mục | Từ | Thành | Ghi chú |
|---|---|---|---|
| Display name | `AI-GUI` | `Grove` | `productName`, tiêu đề cửa sổ, UI |
| Bundle id | `dev.aigui.desktop` | `dev.grove.desktop` | **Đổi app-data dir → cần migration** |
| Sidecar | `ai-gui-server` | `grove-server` | `externalBin`, build script, smoke |
| Main binary | `ai-gui-desktop` | `grove-desktop` | tên crate Rust |
| Rust lib | `ai_gui_desktop_lib` | `grove_lib` | `main.rs` gọi `grove_lib::run()` |
| npm root | `ai-gui` | `grove` | `package.json#name` |
| Scope | `@ai-gui/*` | `@grove/*` | 9 package + mọi import |
| Env | `AI_GUI_{PORT,TOKEN,WEB_DIST,STDIN_SHUTDOWN}` | `GROVE_*` | server + desktop + scripts + CI |
| Repo | `phonnt/ai-gui` | `phonnt/grove` | GitHub redirect URL cũ |
| Artifact | `AI-GUI-<v>-macos-<arch>.{dmg,zip}` | `Grove-<v>-macos-<arch>.{dmg,zip}` | `dist:macos` |

## 4. Chi tiết theo bề mặt

### 4.1 Tauri (`apps/desktop/src-tauri`)
- `tauri.conf.json`: `productName: "Grove"`, `identifier: "dev.grove.desktop"`, `externalBin: ["binaries/grove-server"]`.
- `Cargo.toml`: `[package] name = "grove-desktop"`, `[lib] name = "grove_lib"`; `Cargo.lock` cập nhật.
- `src/main.rs`: `grove_lib::run()`.
- `src/lib.rs` / `sidecar.rs`: bundle id cũ dùng cho migration (§6); log tag `[grove]` thay `[desktop]`/`[main]`.
- Icon: `apps/desktop/app-icon.svg` vẫn dùng; `icon.icns`/`icon.ico` sinh lại nếu muốn đổi mark (không bắt buộc trong rename này).

### 4.2 Build & packaging scripts
- `scripts/build-desktop.ts`: sidecar out `grove-server-<triple><exe>`.
- `scripts/smoke-sidecar.ts`: suy path theo `grove-server-<triple>`.
- `scripts/smoke-tools.ts`: CLI arg path mẫu đổi.
- `scripts/smoke-bundle.ts`: `Grove.app`, `Contents/MacOS/grove-server`, `Contents/MacOS/Grove` (main), `Grove.exe` trên Windows.
- `scripts/package-macos.ts`: artifact `Grove-<v>-macos-<arch>.{dmg,zip}`, volname `Grove`, log/team-note.
- `scripts/smoke-server.ts`, `scripts/dev.ts`, `scripts/check.ts`: chỉ đổi chuỗi nếu có.

### 4.3 npm workspaces
- Root `package.json` `name: "grove"`; giữ nguyên tên script.
- `packages/*/package.json` + `apps/*/package.json`: `name` → `@grove/<x>`; mọi `dependencies`/imports `@ai-gui/*` → `@grove/*`.
- `bun install` chạy lại; `bun.lock` đổi theo.

### 4.4 Env vars
- Server (`apps/server/src/index.ts`) đọc `GROVE_PORT|TOKEN|WEB_DIST|STDIN_SHUTDOWN`; `.env.example` cập nhật.
- Desktop (`lib.rs`) set `GROVE_*`; `AI_GUI_STDIN_SHUTDOWN` → `GROVE_STDIN_SHUTDOWN`.
- Scripts/CI: `GROVE_PORT`, ...
- Không giữ alias tương thích (không có consumer bên ngoài).

### 4.5 CI & repo

- `.github/workflows/desktop.yml`: dùng biến mới; release tên `Grove`; không đổi logic.
- Đổi remote: `git remote set-url origin https://github.com/phonnt/grove.git` sau khi rename trên GitHub (`gh repo rename grove`).
- Repo local dir `AI-GUI/` **không** đổi trong rename này (chỉ remote + tên sản phẩm), tránh phá worktree/đường dẫn tuyệt đối.

### 4.6 UI strings
- `apps/desktop/placeholder/index.html` title `Grove`.
- `apps/web/index.html` title; chuỗi "AI-GUI" trong landing/palette (grep `AI-GUI` trong `apps/web/src`).
- `apps/server` banner log `grove server on :port`.

### 4.7 Docs & meta
- `AGENTS.md`, `docs/architecture.md`, `docs/runbook.md`, `docs/desktop-release.md`, `docs/tui-parity-status.md`: đổi `AI-GUI`/`ai-gui` → `Grove`/`grove` ở phần mô tả hiện hành.
- `.omp/RULES.md`, `.omp/rules/*`: đổi nếu có nhắc tên.
- `.env.example`: `GROVE_PORT`.
- Không sửa `docs/superpowers/specs|plans/*` (§6).

## 5. Migration dữ liệu (bắt buộc vì đổi bundle id)

Bundle id quyết định app-data dir, nơi chứa session/settings/credentials:
- macOS: `~/Library/Application Support/{dev.aigui.desktop → dev.grove.desktop}`
- Windows: `%APPDATA%\{dev.aigui.desktop → dev.grove.desktop}`

Trong `setup()` (Rust), trước khi dùng `app_data_dir()`:
1. `new_dir = app_data_dir()` (theo id mới).
2. `old_dir` = cùng parent, basename `dev.aigui.desktop`.
3. Nếu `new_dir` **chưa tồn tại** và `old_dir` tồn tại → migrate: ưu tiên `fs::rename` (cùng volume, nhanh, atomic); nếu lỗi → copy đệ quy rồi để lại bản cũ (không xoá; user tự dọn).
4. Log rõ đã migrate hay bỏ qua.
5. Không đụng `~/.omp/natives` (không đổi vì không nằm dưới bundle id).

An toàn: **không xoá** dữ liệu cũ trong bước migrate; chỉ ghi log.

## 6. Không đổi

- `@oh-my-pi/*`, `omp`, `~/.omp/**`, `OMP`, mọi thuật ngữ runtime.
- Tên thư mục `apps/desktop`, `packages/*`, `scripts/`, `docs/`.
- Nội dung `docs/superpowers/specs/*` và `docs/superpowers/plans/*` (bản ghi lịch sử) — được phép còn chuỗi `ai-gui`.
- `packages/omp-adapter` (tên gói đổi `@grove/omp-adapter`, nhưng nội dung OMP giữ nguyên).

## 7. Allowlist cho grep kiểm tra cuối

Chuỗi `ai-gui`/`AI_GUI` được phép còn ở:
- `docs/superpowers/specs/**`, `docs/superpowers/plans/**` (lịch sử).
- `node_modules/**`, `**/target/**`, `dist/**`, `apps/desktop/src-tauri/binaries/**` (build output).
- Chính spec này.

## 8. Verification

1. `grep -rIn "AI_GUI\|@ai-gui\|ai-gui" --include='*.ts' --include='*.tsx' --include='*.rs' --include='*.json' --include='*.toml' --include='*.yml' --include='*.md' .` → chỉ còn allowlist.
2. `bun install` sạch; `bun run check` xanh (typecheck + lint + test + `smoke:server`).
3. `bun run build:desktop` → `binaries/grove-server-aarch64-apple-darwin`; `bun run smoke:sidecar` OK.
4. `bun run dist:macos` → `dist/macos/Grove-0.1.0-macos-arm64.{dmg,zip}`, app `Grove.app`, ký ad-hoc, `spctl`/`codesign --verify` như cũ; `bun run smoke:bundle` OK.
5. Cài DMG: app mở, data tại `~/Library/Application Support/dev.grove.desktop`; nếu có dir cũ `dev.aigui.desktop` → migrate xảy ra (log xác nhận), dữ liệu cũ còn nguyên.
6. CI: `verify` + `windows` xanh trên `main`; tag `desktop-v*` tạo draft release `Grove`.
7. `cargo test` trong `apps/desktop/src-tauri` xanh (không còn `ai_gui_desktop_lib`).

## 9. Rủi ro

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| 1 | Migration app-data sai → mất session/settings | Cao | rename→copy fallback, **không xoá** dữ liệu cũ, log; test bằng dir giả trước |
| 2 | Diff cơ học lớn (91 file) sót chỗ | Trung | grep allowlist (§8.1) + CI + typecheck; đổi theo bảng §3 |
| 3 | Rename repo GitHub phá remote/CI | Thấp | `gh repo rename` giữ redirect; `git remote set-url` |
| 4 | Package scope đổi sót import | Trung | `bun install` + typecheck bắt lỗi resolve |
| 5 | Env var đổi làm server không đọc token → 401/không bật auth | Trung | smoke:server + smoke:bundle bắt ngay |
| 6 | Windows path/file name đổi sót | Trung | CI `windows` job |
| 7 | Bundle id mới trùng ai đó | Thấp | `dev.grove.desktop` đủ đặc thù |

## 10. Thứ tự thực thi (cho plan)

1. Rename npm scope + import + `bun install` (cơ học, typecheck xác nhận).
2. Rename env vars (server + desktop + scripts + `.env.example`).
3. Rename binary/crate/productName/bundle id + **migration hook**.
4. Rename scripts/artifact names + CI + repo rename.
5. Docs & UI strings + grep allowlist.
6. Verification §8 + CI + build DMG.
