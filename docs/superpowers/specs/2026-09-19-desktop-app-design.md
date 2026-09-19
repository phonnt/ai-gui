# AI-GUI Desktop App — Design Spec

- Status: proposed (chờ user review)
- Ngày: 2026-09-19
- Phạm vi: v1 macOS, self-contained desktop shell cho AI-GUI
- Liên quan: `docs/architecture.md` (§4 slot `apps/desktop/`), `AGENTS.md`

## 1. Mục tiêu

Đóng gói AI-GUI (web UI + Bun gateway + OMP SDK) thành 1 app desktop macOS cài đặt được, chạy offline, không yêu cầu user cài Bun hay bất kỳ runtime nào.

**Trong phạm vi v1**
- Tauri v2 shell, macOS (arm64), self-contained.
- Sidecar = `apps/server` compile thành 1 binary, tự chứa runtime Bun.
- Server serve luôn static web build → cùng origin.
- Port động + health handshake.
- Data dir riêng trong app data; tái dùng credential store của SDK.
- Ký + notarize (Developer ID) + auto-update.

**Ngoài phạm vi v1**
- Windows/Linux.
- Tauri JS IPC sâu (native dialog/updater UI gọi từ web) — làm từ Rust.
- Keychain hoá secrets.
- Migration `~/.omp` → app data (chỉ ghi nhận, có thể làm sau).
- Thay đổi UI web.

## 2. Quyết định đã chốt

| Hạng mục | Chọn | Lý do |
|---|---|---|
| Shell | Tauri v2 | binary nhỏ, `externalBin` sidecar, có updater |
| Process model | Self-contained, bun-compile sidecar | zero dependency cho user |
| Serve UI | Cách A — Bun server serve static | zero refactor web, zero CORS/CSP |
| Port | Động + `/api/health` handshake | tránh đụng độ, biết chắc server |
| OS | macOS (arm64) | máy dev, ship 1 nền tảng trước |
| Phân phối | Signed + notarize + auto-update | mở được trên máy user |

## 3. Kiến trúc

```
┌─ AI-GUI.app (Tauri v2, Rust) ──────────────────────────┐
│  window ──load──> http://127.0.0.1:<port>              │
│                                                         │
│  setup():                                               │
│   1. chọn port trống (bind :0 → lấy port → đóng)        │
│   2. xác nhận native addon có mặt (copy từ Resources)   │
│   3. spawn sidecar (externalBin) + env                  │
│   4. poll GET /api/health (timeout 10s)                 │
│   5. tạo window trỏ http://127.0.0.1:<port>             │
│  exit: kill sidecar (SIGTERM → SIGKILL sau grace)       │
│  updater plugin (signed)                                │
└─────────────────────────────────────────────────────────┘
        │ spawn + env
┌─ ai-gui-server (1 binary, Bun runtime nhúng) ──────────┐
│  Bun.serve 127.0.0.1:<port>                             │
│   ├─ /api/*  → routes hiện có (+ token check)           │
│   ├─ /*      → web dist static                          │
│   └─ SPA fallback: route không có extension → index.html│
└─────────────────────────────────────────────────────────┘
```

### Startup sequence (chi tiết)

1. Rust bind `TcpListener` port 0 → đọc port → drop listener.
2. Đường dẫn addon: bảo đảm `pi_natives.<platform>.node` nằm ở vị trí loader tìm (xem §6).
3. Spawn sidecar với env:
   - `AI_GUI_PORT=<port>`
   - `AI_GUI_TOKEN=<random 32 bytes hex>` (sinh mỗi lần chạy)
   - `PI_CONFIG_DIR=<app_data_dir>` (session JSONL, settings, credentials)
   - `AI_GUI_WEB_DIST=<resource path tới web dist>`
4. Poll `GET /api/health` mỗi 150ms tới 10s, kèm header `x-ai-gui-token`. Timeout → hiện window lỗi (không load UI), log stderr sidecar.
5. Thành công → tạo window trỏ `http://127.0.0.1:<port>`. Token giao qua cookie HttpOnly set khi server serve `index.html` (xem §9), không đưa vào URL.

**Window tạo lúc runtime** (port chưa biết lúc build): dùng `tauri::WebviewWindowBuilder` trong `setup`, không khai báo `url` tĩnh trong `tauri.conf.json`. `build.frontendDist` trỏ tới một placeholder tối thiểu (Tauri bắt buộc field này).

## 4. Thay đổi repo

```
apps/desktop/                      # MỚI
  package.json                     # script tauri dev/build
  src-tauri/
    Cargo.toml
    tauri.conf.json                # frontendDist rỗng/placeholder, externalBin, resources, updater
    capabilities/default.json      # shell:allow-execute (sidecar)
    entitlements.plist             # hardened runtime + library validation
    icons/
    src/
      main.rs                      # setup: port, addon, spawn, health, window, shutdown
      sidecar.rs                   # spawn/kill/handshake
  binaries/
    ai-gui-server-aarch64-apple-darwin   # output bun-compile (gitignored)
    pi_natives.darwin-arm64.node         # copy từ node_modules (gitignored)
apps/server/src/
  static.ts                        # MỚI: serve web dist + SPA fallback
  auth.ts                          # MỚI: token middleware
  index.ts                         # sửa: dùng 2 module trên, bind 127.0.0.1
scripts/
  build-desktop.ts                 # MỚI: build web → compile server → gom addon → tauri build
```

Web (`apps/web`) **không đổi**.

## 5. Thay đổi server

### 5.1 Static serving + SPA fallback
- Chỉ bật khi `AI_GUI_WEB_DIST` được set (dev không cần — Vite tự serve).
- Thứ tự xử lý: `/api/*` route trước → nếu không khớp:
  - path có extension file → thử đọc file trong dist; miss → 404.
  - path không extension → trả `index.html` (SPA router `/s/:id`).
- Chống path traversal: resolve path rồi kiểm tra nằm trong dist root.
- Cache-Control: asset có hash → `immutable`; `index.html` → `no-cache`.

### 5.2 Token auth
- Nếu `AI_GUI_TOKEN` set: mọi `/api/*` yêu cầu token (header `x-ai-gui-token` hoặc cookie `ai_gui_token`).
- Cho phép không token: request lấy `index.html` (để set cookie).
- WebSocket upgrade cũng kiểm token (query `?t=` hoặc cookie).
- Dev không set token → bỏ qua (giữ dev flow hiện tại).

### 5.3 Bind address
- Hiện `Bun.serve` mặc định. Thêm `hostname: '127.0.0.1'` để không phơi ra LAN.

## 6. Sidecar packaging

### 6.1 Build
```
bun run build:web                                        # apps/web → dist
bun build --compile apps/server/src/index.ts \
  --outfile apps/desktop/binaries/ai-gui-server-aarch64-apple-darwin \
  --external omp-legacy-pi-modules
cp "$(find node_modules/.bun -name 'pi_natives.darwin-arm64.node' | head -1)" \
   apps/desktop/binaries/
```

- `--external omp-legacy-pi-modules`: dynamic optional import không resolve được khi bundle (spike xác nhận). Nếu build phát sinh external khác, thêm tương tự.
- Tauri yêu cầu tên sidecar có target-triple suffix (`externalBin: ["binaries/ai-gui-server"]`).

### 6.2 Native addon
- Spike xác nhận loader tìm `$EXEDIR/pi_natives.<platform>.node` và chạy khi đặt cạnh binary.
- Trong `.app`, vị trí thực thi là `Contents/MacOS/` (đã ký) — **không ghi vào đó lúc runtime** (phá chữ ký).
- Cách chọn: ship `.node` như Tauri **resource** (nằm `Contents/Resources/`, được ký trong bundle), và lúc setup Rust copy ra vị trí loader tìm trong user dir (ví dụ `<PI_CONFIG_DIR>/natives/<version>/pi_natives.darwin-arm64.node`) nếu chưa có.
- Version lấy từ package version của SDK (`18.1.11`) — hằng số trong build script, đồng bộ khi bump SDK.

### 6.3 Kích thước (đo từ spike)
| Thành phần | Size |
|---|---|
| compiled server | ~97 MB |
| native addon `.node` | ~157 MB |
| Tauri shell + web dist | ~15–20 MB |
| **Tổng app** | **~270–280 MB** |

Nặng hơn Electron (~150MB). Chấp nhận vì SDK hard-depend native addon; không có variant nhỏ hơn.

## 7. Lifecycle & shutdown

- Sidecar là con của app; đăng ký kill khi app exit (`RunEvent::Exit` / `ExitRequested`).
- Shutdown: `SIGTERM` → chờ 3s → `SIGKILL`.
- Sidecar tự `process.exit` khi nhận SIGINT/SIGTERM (đã có trong `index.ts`).
- Nếu sidecar crash khi app đang chạy: health poll định kỳ (5s) phát hiện → hiện thông báo + nút restart sidecar.

## 8. Data dir & secrets

- `PI_CONFIG_DIR = app_data_dir` (`~/Library/Application Support/<bundle-id>/omp`).
- Chứa: session JSONL, settings, auth-broker snapshot, natives cache.
- Quyền: dir `0700`.
- Credentials: **tái dùng credential ladder + store của SDK** (không đấu lại). Không tự parse/ghi secret.
- Ghi nhận: user đã dùng OMP CLI sẽ có credentials ở `~/.omp` — v1 **không** tự migrate; cân nhắc first-run import sau.

## 9. Security

- Bind `127.0.0.1` only.
- Per-launch token, sinh mỗi lần chạy, không log ra stdout.
- Token đưa vào webview qua cookie `HttpOnly`+`SameSite=Strict` set khi serve `index.html` (same-origin) → fetch/WS tự đính; không lộ trong URL/history.
- WS kiểm token ở upgrade.
- CSP: vì cùng origin, giữ CSP chặt cho static (frame-ancestors 'none', không inline script ngoài build).
- Không expose API ra ngoài loopback.

## 10. macOS signing, notarization, updater

### Signing
- Developer ID Application cert.
- `tauri.conf.json`: `bundle.macOS.entitlements = ./entitlements.plist`, signing identity qua env `APPLE_SIGNING_IDENTITY`.
- Hardened runtime bật (Tauri mặc định khi ký).
- Tauri ký **inside-out**: framework + sidecar trước, app sau (doc xác nhận).
- Entitlements tối thiểu; dự kiến cần `com.apple.security.cs.disable-library-validation` để dlopen native addon copy ra ngoài bundle (xem rủi ro §11).
- Notarization: `APPLE_ID` + `APPLE_PASSWORD` (app-specific) + `APPLE_TEAM_ID`, Tauri tự notarize + staple.

### Updater
- `bun tauri add updater`.
- `bunx tauri signer generate -w ~/.tauri/ai-gui.key` → pubkey vào config, private key trong CI secret.
- `bundle.createUpdaterArtifacts: true`.
- Endpoint: static JSON host riêng hoặc GitHub Releases `latest.json`.
- UI update prompt gọi từ Rust (không cần JS IPC ở v1).

## 11. Rủi ro & điểm chưa chắc

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| 1 | dlopen native addon dưới hardened runtime bị library validation chặn | Cao | entitlement `disable-library-validation`, hoặc ký addon riêng; **validate sớm** |
| 2 | Loader không tìm thấy addon trong `.app` | Trung | Đã biết search paths; copy ra user dir lúc setup; smoke test |
| 3 | Compile phát sinh external/dynamic import khác | Trung | Thêm `--external`; test `/api/health` + tạo session trong CI |
| 4 | Kích thước app ~275MB | Thấp (chấp nhận) | Ghi nhận; không có cách giảm |
| 5 | TCC/permission khi truy cập project dir | Trung | Full Disk Access prompt; hướng dẫn trong runbook |
| 6 | WKWebView + xterm/CodeMirror perf | Thấp | Smoke test các pane nặng |
| 7 | Notarization CI cần secrets + mac runner | Trung | Setup CI secret; build local trước |

## 12. Testing

- **Unit/integration hiện có**: giữ nguyên (`bun run check`).
- **Server static + auth** (mới): test `apps/server` — SPA fallback trả index cho `/s/x`, 404 cho asset miss, path traversal bị chặn, token thiếu → 401, token đúng → 200, WS thiếu token bị từ chối.
- **Contract test runtime**: mock runtime vẫn pass (đảm bảo desktop không đổi hợp đồng).
- **Desktop smoke (thủ công + CI)**: launch app → health → tạo session → gửi 1 prompt round-trip → quit sạch (sidecar chết).
- **Packaging smoke (CI)**: build sidecar → chạy binary → `/api/health` 200 → tạo session OK (bắt regression addon/external).

## 13. Tiêu chí thành công (v1)

1. Cài `.dmg` trên macOS arm64 (máy sạch), mở không bị Gatekeeper chặn.
2. App tự start server, vào chat, tạo session + prompt round-trip hoạt động.
3. Session lưu dưới `~/Library/Application Support/...`, không đụng `~/.omp`.
4. Thoát app → không còn process `ai-gui-server`.
5. Auto-update: bản mới hơn phát hiện + cài được.
6. `bun run check` xanh; packaging smoke xanh.

## 14. Thứ tự thực thi (đề xuất cho plan)

1. Server: static serving + SPA fallback + token + `hostname` (có test).
2. Build script compile sidecar + gom addon (packaging smoke).
3. Scaffold `apps/desktop` Tauri: spawn + health + window + shutdown (dev, unsigned).
4. Validate native addon trong `.app` context (rủi ro #1) — ký ad-hoc.
5. Signing + notarization + `.dmg`.
6. Updater.
7. CI.

## 15. Bằng chứng spike (2026-09-19)

- `bun build --compile apps/server/src/index.ts --outfile ai-gui-server --external omp-legacy-pi-modules` → binary ~97MB, 2984 modules.
- Chạy với `AI_GUI_PORT=8899` + `pi_natives.darwin-arm64.node` cạnh binary → `GET /api/health` = `{ok:true,version:"0.1.0",runtime:"sdk"}`; `POST /api/sessions` tạo session OK.
- Không có addon → boot nhưng fail `Failed to load pi_natives native addon for darwin-arm64`.
- Artifact spike đã xoá (throwaway).
