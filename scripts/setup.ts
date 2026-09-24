#!/usr/bin/env bun
// One-command environment setup: verifies what this machine needs for the dev
// stack (and optionally for desktop packaging / e2e) and prints — or with
// --install runs — the exact per-OS commands for whatever is missing.
//
// Bun itself cannot be installed from here: this script *is* a Bun script, so
// the runtime has to exist first. `bunInstallCommand()` returns the one-liner
// for the current platform, which the README shows as step zero.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

export const MIN_BUN = '1.3.14';

/** Targets `scripts/build-desktop.ts` can package, keyed by platform/arch. */
const DESKTOP_TARGETS: Record<string, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
};

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** Commands that fix a failing check, printed in order. */
  fix: string[];
  /** True when `--install` may run `fix` itself (never for elevated commands). */
  autoInstallable?: boolean;
}

export function bunInstallCommand(os: string): string {
  if (os === 'win32') return 'powershell -c "irm bun.sh/install.ps1 | iex"';
  return 'curl -fsSL https://bun.sh/install | bash';
}

/** True when the running Bun is new enough for the SDK. */
export function meetsMinimum(version: string, minimum = MIN_BUN): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split(/[.\-+]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parse(version), parse(minimum)];
  for (let i = 0; i < 3; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

/** Desktop prerequisites for this host; empty when the target is unsupported. */
export function desktopFixes(os: string, arch: string): string[] {
  if (!DESKTOP_TARGETS[`${os}-${arch}`]) return [];
  if (os === 'darwin') {
    return [
      'xcode-select --install                 # Xcode CLT (Tauri needs it; skip if already installed)',
      'curl --proto "=https" --tlsv1.2 https://sh.rustup.rs -sSf | sh',
    ];
  }
  return [
    'winget install --id Rustlang.Rustup -e',
    'winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"',
    'winget install --id Microsoft.EdgeWebView2Runtime -e',
  ];
}

/** Chromium install command for the Playwright suite. */
export function playwrightCommand(os: string): string {
  return os === 'linux'
    ? 'bunx playwright install --with-deps chromium   # --with-deps needs sudo (installs shared libs)'
    : 'bunx playwright install chromium';
}

function bunVersion(): string {
  return Bun.version;
}

// `command -v` is an sh builtin: it resolves on macOS/Linux and on CI's
// Git Bash, but not in a clean PowerShell (no `sh` on PATH). `where.exe`
// is the Windows equivalent, so probe per-OS instead of assuming sh.
export function probeCommand(os: string, name: string): string[] {
  return os === 'win32' ? ['where', name] : ['sh', '-c', `command -v ${name}`];
}

export function commandExists(name: string, os: string = platform()): boolean {
  const [cmd, ...args] = probeCommand(os, name);
  if (!cmd) return false;
  const res = spawnSync(cmd, args, { stdio: 'ignore' });
  return res.status === 0;
}

// Same split for running fixes: `sh -c` does not resolve in PowerShell,
// while `powershell -Command` handles the only auto-installable Windows fix
// (`bunx playwright install chromium`; winget/rustup lines are printed only).
export function fixCommand(os: string, fix: string): string[] {
  return os === 'win32' ? ['powershell', '-NoProfile', '-Command', fix] : ['sh', '-c', fix];
}

function playwrightCacheDir(os: string): string {
  if (os === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (os === 'win32') return join(homedir(), 'AppData', 'Local', 'ms-playwright');
  return join(homedir(), '.cache', 'ms-playwright');
}

/** Playwright keeps browsers in a versioned directory (e.g. `chromium-1228`). */
export function chromiumInstalledIn(dir: string): boolean {
  if (!existsSync(dir)) return false;
  // onlyFiles:false — the browsers *are* directories, and the default glob would
  // silently find nothing and report Chromium as missing.
  for (const _entry of new Bun.Glob('chromium*').scanSync({ cwd: dir, onlyFiles: false })) {
    return true;
  }
  return false;
}

function chromiumInstalled(os: string): boolean {
  return chromiumInstalledIn(playwrightCacheDir(os));
}

function ompRoot(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.omp', 'agent');
}

/** Every check for this host. `desktop`/`e2e` add the optional ones. */
async function collect(
  os: string,
  arch: string,
  opts: { desktop: boolean; e2e: boolean },
): Promise<Check[]> {
  const checks: Check[] = [
    {
      name: `Bun ≥ ${MIN_BUN}`,
      ok: meetsMinimum(bunVersion()),
      detail: `found ${bunVersion()}`,
      fix: [bunInstallCommand(os)],
    },
  ];

  const omp = ompRoot();
  checks.push({
    name: 'OMP credentials/settings',
    ok: existsSync(omp),
    detail: existsSync(omp)
      ? `found ${omp}`
      : `missing ${omp} (model turns will fail; the UI alone still runs)`,
    fix: ['omp login   # or copy an existing ~/.omp from another machine'],
  });

  if (opts.e2e) {
    const ok = chromiumInstalled(os);
    checks.push({
      name: 'Playwright Chromium',
      ok,
      detail: ok ? `found ${playwrightCacheDir(os)}` : `missing in ${playwrightCacheDir(os)}`,
      fix: [playwrightCommand(os)],
      autoInstallable: os !== 'linux',
    });
  }

  if (opts.desktop) {
    const fixes = desktopFixes(os, arch);
    if (fixes.length === 0) {
      checks.push({
        name: 'Desktop packaging',
        ok: false,
        detail: `unsupported target: ${os}/${arch} (build:desktop throws)`,
        fix: [],
      });
    } else {
      const rust = commandExists('rustc', os);
      checks.push({
        name: 'Rust toolchain',
        ok: rust,
        detail: rust ? (await $`rustc --version`.quiet().text()).trim() : 'rustc not on PATH',
        fix: fixes,
        autoInstallable: os !== 'win32',
      });
      if (os === 'darwin') {
        const clt = await $`xcode-select -p`.quiet().nothrow();
        checks.push({
          name: 'Xcode Command Line Tools',
          ok: clt.exitCode === 0,
          detail: clt.exitCode === 0 ? clt.stdout.toString().trim() : 'not installed',
          fix: ['xcode-select --install'],
        });
      }
    }
  }

  return checks;
}

function print(check: Check): void {
  const mark = check.ok ? '\u2713' : '\u2717';
  console.log(`${mark} ${check.name} — ${check.detail}`);
  if (!check.ok && check.fix.length > 0) {
    for (const line of check.fix) console.log(`    ${line}`);
  }
}

async function main(): Promise<void> {
  const os = platform();
  const arch = process.arch;
  const args = new Set(Bun.argv.slice(2));
  const install = args.has('--install');
  const desktop = args.has('--desktop') || args.has('--install-desktop');
  const e2e = args.has('--e2e') || args.has('--install-e2e');
  const wantsHelp = args.has('--help') || args.has('-h');

  if (wantsHelp) {
    console.log(`bun run setup [flags]

  Verifies this machine for the Grove dev stack and prints the exact fix for
  anything missing. Nothing is installed unless you ask.

  --desktop         also check desktop packaging prerequisites (macOS arm64 / Windows x64)
  --e2e             also check the Playwright Chromium used by \`bun run e2e\`
  --install         run the non-privileged fixes for the selected scopes
                    (rustup, playwright install); elevated steps (winget, apt,
                    xcode-select) are printed for you to run
`);
    return;
  }

  console.log(`Grove setup — ${os}/${arch}`);
  const checks = await collect(os, arch, { desktop, e2e });
  for (const check of checks) print(check);

  if (install) {
    const runnable = checks.filter((check) => !check.ok && check.autoInstallable);
    if (runnable.length === 0) {
      console.log('\nnothing left that --install can do unattended');
    }
    for (const check of runnable) {
      const fix = check.fix[0];
      if (!fix) continue;
      console.log(`\n$ ${fix}`);
      const [cmd, ...args] = fixCommand(os, fix);
      if (!cmd) continue;
      const result = spawnSync(cmd, args, { stdio: 'inherit' });
      if ((result.status ?? 1) !== 0)
        console.log(`  failed (${result.status ?? 1}) — run it yourself to see the output`);
    }
  }

  const hardFailure = checks.some((check) => !check.ok && check.name.startsWith('Bun'));
  console.log(
    hardFailure
      ? `\nBun ${MIN_BUN}+ is required. Install it, then re-run: bun run setup`
      : '\nNext: bun install && bun run dev   (then open http://localhost:5173)',
  );
  process.exit(hardFailure ? 1 : 0);
}

if (import.meta.main) await main();
