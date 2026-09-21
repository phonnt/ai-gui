#!/bin/sh
# Grove installer for macOS and Linux.
#
# Bootstrap the dev environment on a machine that has nothing but a shell:
# checks the OS/arch, installs Bun if it is missing, installs workspace
# dependencies, then delegates the rest to `bun run setup` (which reports and —
# with --install — runs the non-privileged prerequisites: rustup, Playwright).
#
#   sh install.sh                 # dev stack only
#   sh install.sh --e2e           # + Playwright Chromium
#   sh install.sh --desktop       # + desktop packaging prerequisites (macOS arm64)
#   sh install.sh --clone ~/grove # clone the repo first, then install inside it
#
# Safe to re-run: every step checks before it acts, and nothing needs sudo.
set -eu

REPO_URL="${GROVE_REPO_URL:-https://github.com/phonnt/grove.git}"
DESKTOP=0
E2E=0
CLONE_DIR=""

usage() {
  # Print the header comment block (lines 2-14) as the help text.
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --desktop) DESKTOP=1 ;;
    --e2e) E2E=1 ;;
    --clone)
      shift
      [ $# -gt 0 ] || { echo "--clone needs a directory" >&2; exit 2; }
      CLONE_DIR="$1"
      ;;
    -h | --help) usage ;;
    *) echo "unknown flag: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin | Linux) ;;
  *)
    echo "install.sh covers macOS and Linux; on Windows run install.ps1" >&2
    exit 1
    ;;
esac
echo "Grove installer — $os/$arch"

if [ -n "$CLONE_DIR" ]; then
  if [ -e "$CLONE_DIR" ]; then
    echo "using existing checkout at $CLONE_DIR"
  else
    command -v git >/dev/null 2>&1 || { echo "git is required for --clone" >&2; exit 1; }
    echo "cloning $REPO_URL -> $CLONE_DIR"
    git clone --depth 1 "$REPO_URL" "$CLONE_DIR"
  fi
  cd "$CLONE_DIR"
fi

# Run from the repository root: the script may be piped from the network, so the
# checkout is not necessarily its own directory.
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -f "$script_dir/package.json" ] && grep -q '"name": "grove"' "$script_dir/package.json"; then
  cd "$script_dir"
elif [ ! -f package.json ] || ! grep -q '"name": "grove"' package.json; then
  echo "run this from the Grove checkout (or pass --clone <dir>)" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  # Bun's installer writes to ~/.bun/bin and does not touch system paths.
  echo "installing Bun (https://bun.sh)"
  curl -fsSL https://bun.sh/install | bash
  PATH="$HOME/.bun/bin:$PATH"
  export PATH
fi
echo "bun $(bun --version)"

echo "installing workspace dependencies"
bun install --frozen-lockfile

flags=""
[ "$E2E" = 1 ] && flags="$flags --e2e"
[ "$DESKTOP" = 1 ] && flags="$flags --desktop"
# shellcheck disable=SC2086 # flags is a deliberate word list
bun run setup $flags --install

cat <<'EOF'

Installed. Next:
  bun run dev            # web on http://localhost:5173, server on :8787
  bun run check          # the gate CI runs: typecheck + lint + tests + server smoke
EOF
