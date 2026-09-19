# AI-GUI Desktop — Windows Support Design Spec

- Status: proposed (chờ user review)
- Ngày: 2026-09-19
- Phạm vi: thêm nền tảng Windows (x64) cho desktop app, giữ macOS nguyên vẹn
- Liên quan: `docs/superpowers/specs/2026-09-19-desktop-app-design.md` (spec macOS gốc), `docs/architecture.md`

## 1. Mục tiêu

App desktop AI-GUI chạy được trên Windows x64 với **full tool parity** như macOS: same-origin UI, sidecar Bun-compile, health handshake, native addon, và toàn bộ tool surface (read/write/edit/bash/grep/lsp/mcp/hub/task/todo/notebook/…).

**Trong phạm vi v1**
- Windows x64 (`x86_64-pc-windows-msvc`).
- Unsigned (SmartScreen cảnh báo — chấp nhận).
- Full tool parity — nhưng **phải chứng minh bằng smoke tự động** trên CI, không giả định.
- Một codebase dùng chung macOS + Windows (hướng A), macOS không regression.
- CI `windows-latest` build + smoke; repo public `phonnt/ai-gui` để chạy Actions.

**Ngoài phạm vi v1**
- Ký Authenticode (SmartScreen sẽ cảnh báo; pre-stage cơ chế sau).
- Windows arm64.
- Verify GUI runtime trên Windows thật (không có máy Windows; chỉ verify được build + non-GUI surface).
- macOS arm64 mở rộng thêm (giữ nguyên hiện trạng).

## 2. Quyết định đã chốt

| Hạng mục | Chọn | Lý do |
|---|---|---|
| Hướng | A — generalize tại chỗ | một codebase, không duplicate |
| Arch | x64 only | windows-latest là x64, phủ đa số |
| Verify | GitHub Actions `windows-latest` | build Tauri Windows buộc trên Windows thật; CI là Windows thật |
| Ký | Unsigned | không có cert; nhất quán macOS Task 7 đang skip |
| Scope | Full tool parity | yêu cầu người dùng |
| Repo | public `phonnt/ai-gui` | Actions miễn phí; cần remote cho CI |

## 3. Nguyên tắc

- **Không fork code.** Mọi khác biệt nền tảng đi qua: build script derive theo host, `tauri.<platform>.conf.json`, `#[cfg(unix)]`/`#[cfg(windows)]`, và smoke script cross-platform.
- **Không hardcode platform** trong code dùng chung (binary name, addon filename, path separator, `HOME`, `SIGTERM`).
- **macOS là regression gate**: sau mỗi task, build + `smoke:sidecar` + `smoke:bundle` trên macOS phải còn xanh.
- **CI là nguồn chân lý cho Windows**; phần không tự động hoá được phải được đánh dấu unverified, không giả vờ.

## 4. Thay đổi repo

### 4.1 Build script (`scripts/build-desktop.ts`) — platform-aware
- `platformTarget()` suy từ `process.platform`/`process.arch`:
  - darwin/arm64 → `{ triple: 'aarch64-apple-darwin', addonPackage: '@oh-my-pi+pi-natives-darwin-arm64@*', exeSuffix: '' }`
  - win32/x64 → `{ triple: 'x86_64-pc-windows-msvc', addonPackage: '@oh-my-pi+pi-natives-win32-x64@*', exeSuffix: '.exe' }`
  - platform khác → throw với message rõ.
- Output binary: `apps/desktop/src-tauri/binaries/ai-gui-server-<triple><exeSuffix>` (Tauri yêu cầu suffix triple; trên Windows thêm `.exe`).
- Addon: tìm trong `.bun` theo `addonPackage`; **copy toàn bộ file `pi_natives.win32-x64*.node`** (x64 có variant `modern`/`baseline`/default — loader tự chọn theo AVX2).
- **Manifest đổi shape** từ `{ version, file }` → `{ version, files: string[] }` (macOS = 1 phần tử; Windows = tất cả variant của platform). `provision_native` copy **từng file** trong `files` vào `<nativesDir>/<version>/`. Interface này áp cho cả hai OS (macOS vẫn 1 phần tử, không đổi hành vi).
- `web dist` copy vào `src-tauri/resources/web` (giữ nguyên).

### 4.2 Bỏ symlink `src-tauri/binaries` (blocker Windows)
- Symlink hiện tại vỡ trên Windows checkout. Build script đổ **thẳng** vào `src-tauri/binaries/`.
- Sửa `.gitignore` (bỏ comment symlink, ignore `src-tauri/binaries/*` + `!.gitkeep`).
- `externalBin` giữ `["binaries/ai-gui-server"]`; `resources` trỏ `binaries/...` (đường dẫn forward-slash).

### 4.3 Tauri config per-platform
- `tauri.conf.json` (base): trung lập — bỏ `targets`, `icon.icns`, `macOS.*`; giữ `externalBin`, `resources`, `plugins.updater`, `createUpdaterArtifacts`.
- `tauri.macos.conf.json`: `bundle.targets: ["app","dmg"]`, `icon: ["icons/icon.icns"]`, `macOS.{entitlements,hardenedRuntime}`.
- `tauri.windows.conf.json`: `bundle.targets: ["nsis"]`, `icon: ["icons/icon.ico"]`.
- Lưu ý RFC 7396: **mảng bị replace toàn bộ** — file platform phải khai đầy đủ mảng nó đổi (vd nếu đổi `icon` thì ghi cả mảng).

### 4.4 Rust config-gate
- `provision_native` chmod `0700`: `#[cfg(unix)]` (Windows: bỏ qua, ghi TODO ACL).
- `config_relative_to_home`: dùng home dir từ `tauri::path`/`dirs` (không đọc `HOME`), để Windows `USERPROFILE` đúng.
- `natives_dir()`: khớp loader từng OS — macOS/Linux giữ XDG-aware; Windows `home/.omp/natives` (không XDG).
- **Bỏ phụ thuộc `libc`**: thay `kill_graceful` bằng shutdown protocol (4.5).
- `#[cfg(windows)]`: ẩn create/console window cho sidecar nếu cần (`CREATE_NO_WINDOW`) — xem xét khi build.

### 4.5 Shutdown protocol qua stdin (thay SIGTERM, cross-platform)
- Server (`apps/server/src/index.ts`): thêm listener `process.stdin` — nhận dòng `{"op":"shutdown"}` hoặc EOF → `stop()` (dispose bus + runtime) rồi `process.exit(0)`. Vô hại trên macOS/Linux (stdin thường rỗng khi chạy tay).
- Rust `kill_graceful(child)`:
  1. `child.write(b"{\"op\":\"shutdown\"}\n")`
  2. chờ ≤3s cho process con thoát (poll), 
  3. quá hạn → `child.kill()` (TerminateProcess trên Windows, SIGKILL trên unix).
- Kết quả: graceful trên **cả hai** OS, bỏ `libc`; giữ nguyên hành vi "không orphan".

### 4.6 Smoke scripts cross-platform
- `scripts/smoke-sidecar.ts`: bỏ phụ thuộc shell POSIX nếu có (đang dùng `spawn` + `fetch` + `child.kill` — đã portable; kiểm tra lại `cwd`/path). Thêm `smoke-tools`.
- `scripts/smoke-tools.ts` (MỚI): sau khi sidecar ready, tạo session rồi gọi lần lượt qua HTTP: write → read → edit → bash (lệnh đơn giản, vd in "ok") → grep/glob → lsp (nếu khả dụng). Assert kết quả. **Đây là bài test full parity.**
- `scripts/smoke-bundle.ts`: hiện macOS-only (`open`/`osascript`/`pgrep`). Chuyển thành platform-aware: macOS giữ; Windows dùng Node `spawn` app `.exe` + `tasklist`/`taskkill`, hoặc (đơn giản hơn) chỉ build + assert artifact tồn tại và để GUI cho manual.

### 4.7 CI
- `.github/workflows/desktop.yml`: thêm job `windows` (`windows-latest`):
  - setup bun 1.3.14 + rust stable + WebView2 (preinstalled)
  - `bun install --frozen-lockfile`
  - `bun run build:desktop`
  - `bun run smoke:sidecar`
  - `bun run smoke:tools`  ← full parity gate
  - `bun run tauri build` (nsis, unsigned, cần `TAURI_SIGNING_PRIVATE_KEY` cho updater artifacts)
  - upload `.exe`/nsis installer + `.sig`
- Job `macos` giữ nguyên (regression).
- `permissions: contents: read`.

### 4.8 Repo
- Tạo GitHub **public** `phonnt/ai-gui`, `git remote add origin`, push `main`.
- Chạy `workflow_dispatch` để verify job `windows` (và job `verify` macOS).

## 5. Ma trận hành vi cross-platform

| Khía cạnh | macOS | Windows |
|---|---|---|
| Sidecar binary | `ai-gui-server-aarch64-apple-darwin` | `ai-gui-server-x86_64-pc-windows-msvc.exe` |
| Addon | `pi_natives.darwin-arm64.node` | `pi_natives.win32-x64[-modern|-baseline].node` |
| Native cache | `~/.omp/natives/<ver>` (XDG-aware) | `%USERPROFILE%\.omp\natives\<ver>` |
| Home env | `HOME` | `USERPROFILE` (qua `dirs`) |
| Dir perms | `0700` | (bỏ qua; ACL sau) |
| Shutdown | stdin protocol → SIGKILL fallback | stdin protocol → TerminateProcess fallback |
| Bundle | `.app` + `.dmg` | NSIS `.exe` installer |
| Icon | `.icns` | `.ico` |
| Signing | Developer ID + notarize (skip) | Authenticode (skip) |

## 6. Chiến lược verify trên host macOS

- **Tự động (CI, chạy được):** build sidecar Windows, `smoke:sidecar` (health + session + addon load), `smoke:tools` (read/write/edit/bash/grep/lsp), `tauri build` (nsis artifact tồn tại).
- **Không tự động (đánh dấu unverified):** GUI window runtime trên Windows; NSIS install + chạy app; SmartScreen UX; bash tool với shell thật của Windows (cmd vs powershell vs git-bash) — nếu `smoke:tools` lộ vấn đề thì nó thành finding ngay.
- macOS regression: `build:desktop` + `smoke:sidecar` + `smoke:bundle` + `bun run check` sau mỗi task.

## 7. Rủi ro & điểm chưa chắc

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| 1 | `bash` tool trên Windows: OMP giả định shell POSIX; `bash` có thể không tồn tại | **Cao** | `smoke-tools` Task 1 phát hiện sớm; nếu hỏng → negotiation scope (dùng `shell` cmd/powershell hoặc document) |
| 2 | x64 addon variant (AVX2) — chọn sai → illegal instruction | Trung | copy cả bộ variant; loader tự detect; smoke:sidecar trên CI x64 = bằng chứng |
| 3 | GUI trên CI headless không tạo được window | Trung | không cam kết; chỉ build + non-GUI smoke; GUI manual sau |
| 4 | NSIS/WebView2 tải trong CI chậm/lỗi mạng | Trung | retry; cache; chấp nhận chậm |
| 5 | Bỏ symlink làm vỡ đường dẫn macOS | Trung | macOS smoke sau task |
| 6 | Conflict với session core-capability trên `main` | Trung | làm trên worktree nhánh `windows`; rebase/merge khi xong |
| 7 | stdin shutdown không hoạt động khi stdin bị đóng sớm | Thấp | fallback `child.kill()` sau 3s đã có |
| 8 | Public repo lộ code | Thấp (bạn đã chọn) | — |

## 8. Testing

- Unit: `platformTarget()` mapping (thuần, test được trên macOS với input giả).
- Integration/CI: `smoke:sidecar` + `smoke:tools` trên windows-latest.
- Regression: toàn bộ gate macOS hiện có + `bun run check`.
- QA rule: spike/bug → giữ test tái hiện khi fail trước + pass sau.

## 9. Tiêu chí thành công (v1)

1. CI `windows-latest`: `build:desktop` + `smoke:sidecar` + `smoke:tools` xanh (addon load + toàn bộ tool cốt lõi chạy trên Windows).
2. `tauri build` trên Windows sinh NSIS installer (unsigned) + updater artifacts.
3. CI `macos`: tất cả job cũ vẫn xanh (không regression).
4. Không còn symlink `src-tauri/binaries`; build script derive platform, không hardcode.
5. App data/session trên Windows nằm dưới `%APPDATA%\dev.aigui.desktop`; native cache ở `~/.omp/natives`.
6. Đánh dấu rõ những gì **chưa** verify (GUI runtime, installer UX, bash shell thật).

## 10. Thứ tự thực thi (đề xuất — spike first)

1. **Task 1 (spike, de-risk #1):** job `windows` tối giản trong CI, chỉ `build:desktop` (Windows) + `smoke:sidecar` + `smoke-tools` sơ khai (read/write/edit/bash). Chạy `workflow_dispatch`. **Kết quả quyết định scope.**
2. Task 2: generalize build script (bỏ symlink, platformTarget) + macOS regression.
3. Task 3: Tauri per-platform config + Rust cfg-gate + stdin shutdown + server stdin listener.
4. Task 4: smoke-tools đầy đủ + bundle smoke cross-platform.
5. Task 5: job `windows` hoàn chỉnh (nsis build + artifacts) + `permissions`.
6. Task 6: tài liệu (`docs/runbook.md` mục Windows, `docs/desktop-release.md`), cập nhật architecture.

## 11. Ngoài phạm vi

- Authenticode signing; winget/scoop packaging.
- Windows arm64.
- GUI runtime verification (cần máy Windows thật).
- CI cache/tối ưu tốc độ.
