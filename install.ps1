<#
.SYNOPSIS
  Grove installer for Windows.

.DESCRIPTION
  Bootstraps the dev environment on a machine that has nothing but PowerShell:
  installs Bun if it is missing, installs workspace dependencies, then delegates
  the rest to `bun run setup` (which reports and runs the non-privileged
  prerequisites). Elevated tooling (winget for Rust/MSVC/WebView2) is printed
  rather than installed silently — pass -Desktop to see those commands.

.EXAMPLE
  powershell -c "irm https://raw.githubusercontent.com/phonnt/grove/main/install.ps1 | iex"

.EXAMPLE
  pwsh -File install.ps1 -E2e -Desktop
#>
[CmdletBinding()]
param(
  [switch]$E2e,
  [switch]$Desktop,
  [string]$Clone = '',
  [string]$RepoUrl = $(if ($env:GROVE_REPO_URL) { $env:GROVE_REPO_URL } else { 'https://github.com/phonnt/grove.git' }),
  [switch]$Help
)

$ErrorActionPreference = 'Stop'

if ($Help) {
  Get-Help $PSCommandPath -Detailed
  exit 0
}

Write-Host "Grove installer — Windows/$env:PROCESSOR_ARCHITECTURE"

if ($Clone -ne '') {
  if (Test-Path $Clone) {
    Write-Host "using existing checkout at $Clone"
  } else {
    Write-Host "cloning $RepoUrl -> $Clone"
    git clone --depth 1 $RepoUrl $Clone
  }
  Set-Location $Clone
}

# Run from the repository root: the script may be piped from the network, so the
# checkout is not necessarily its own directory.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Join-Path $scriptDir 'package.json'
if ((Test-Path $manifest) -and (Select-String -Path $manifest -Pattern '"name": "grove"' -Quiet)) {
  Set-Location $scriptDir
} elseif (-not (Test-Path 'package.json') -or -not (Select-String -Path 'package.json' -Pattern '"name": "grove"' -Quiet)) {
  throw 'run this from the Grove checkout (or pass -Clone <dir>)'
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Host 'installing Bun (https://bun.sh)'
  powershell -c "irm bun.sh/install.ps1 | iex"
  $env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"
}
Write-Host "bun $(bun --version)"

Write-Host 'installing workspace dependencies'
bun install --frozen-lockfile

$flags = @()
if ($E2e) { $flags += '--e2e' }
if ($Desktop) { $flags += '--desktop' }
bun run setup @flags --install

Write-Host @'

Installed. Next:
  bun run dev            # web on http://localhost:5173, server on :8787
  bun run check          # the gate CI runs: typecheck + lint + tests + server smoke

Desktop packaging (x64 only) additionally needs the winget packages printed by
`bun run setup --desktop`.
'@
