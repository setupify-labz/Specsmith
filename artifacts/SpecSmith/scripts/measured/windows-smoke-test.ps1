<#
.SYNOPSIS
    The one supported command for smoke-testing the automatic PresentMon
    capture path on Windows: dependency checks, PresentMon location/hash,
    game-process detection, a dry-run capture, a cancellation + cleanup
    check against all four residues, and a pass/fail report.

.DESCRIPTION
    Earlier smoke testing meant copying a long checklist of individual
    PowerShell commands one at a time (see scripts/measured/README.md). Two
    real retests each still needed a second, unplanned round of manual
    checking - once because Ctrl+C was leaving debris behind, once because
    the reported exit code didn't match what a manual read of the terminal
    suggested. This script runs the same checks itself, once, and prints one
    report at the end.

    It deliberately does NOT run this through `pnpm collect:measured`. Two
    real Windows retests showed that pnpm's own wrapper process, when hit by
    the same console-wide Ctrl+C as its child, does not reliably preserve
    the collector's own exit code - see the README's "pnpm's Windows exit
    code vs. the collector's own status" section. This script instead runs
    `node --import` (against tsx's own loader, resolved to a verified
    absolute path - see below) directly against the collector: no pnpm, and
    not even tsx's own .CMD shim, which is itself an unnecessary intermediate
    cmd.exe process of the same general shape. PowerShell's direct child here
    is node.exe, nothing else.

    This is a DRY-RUN-ONLY tool. It never writes to the observation store.

    NOTE ON PATHS: every path this script uses is resolved from
    $PSScriptRoot (this file's own folder), never from the caller's current
    directory. Run it from anywhere - you do not need to `cd` into the repo
    first. A real Windows run once failed with
    "Cannot find package 'tsx'" because the bare "tsx" import specifier
    passed to `node --import` was being resolved relative to the CALLER's
    working directory instead of this repository; this script resolves tsx's
    loader to a verified, absolute file:// path before ever invoking node,
    which does not depend on the working directory at all.

.PARAMETER PresentMon
    Path to PresentMon.exe. Falls back to $env:SPECSMITH_PRESENTMON.

.PARAMETER PresentMonSha256
    The pinned SHA-256 digest for PresentMon.exe. Falls back to
    $env:SPECSMITH_PRESENTMON_SHA256. If neither is given, the script prints
    the digest it computed and asks you to confirm and re-run with it pinned
    - or pass -AllowUnpinnedPresentMon to proceed anyway for this run only.

.PARAMETER ProcessName
    The exact executable name of the running game, e.g. Marvel-Win64-Shipping.exe.

.PARAMETER ProcessId
    The exact pid of the running game, as an alternative to -ProcessName.

.PARAMETER CaptureSeconds
    How long the dry-run capture window is. Default 20. Must comfortably
    exceed -CancelAfterSeconds.

.PARAMETER CancelAfterSeconds
    How far into the capture Ctrl+C is simulated. Default 5.

.EXAMPLE
    .\windows-smoke-test.ps1 -PresentMon "C:\tools\PresentMon\PresentMon.exe" -ProcessName "Marvel-Win64-Shipping.exe"

    Runs every automated check against the named game, pausing only if that
    process cannot be found yet. Can be run from any directory.
#>

[CmdletBinding()]
param(
    [string]$PresentMon,
    [string]$PresentMonSha256,
    [switch]$AllowUnpinnedPresentmon,
    [string]$ProcessName,
    [int]$ProcessId,
    [int]$CaptureSeconds = 20,
    [int]$CancelAfterSeconds = 5,
    [string]$GameId = "marvel-rivals",
    [string]$SettingsFile,
    [string]$ReportFile
)

$ErrorActionPreference = "Stop"

Write-Host "SpecSmith Windows smoke test" -ForegroundColor Cyan
Write-Host "============================" -ForegroundColor Cyan
Write-Host "Dry-run only. Nothing is written to the observation store."
Write-Host ""

# ---------------------------------------------------------------------------
# Every path below is derived from $PSScriptRoot - this file's own folder -
# not from Get-Location. That is what makes this script safe to run from
# anywhere: the repository root, an unrelated worktree, a completely
# different drive. Do not introduce a relative path anywhere below that is
# not built from one of these.
# ---------------------------------------------------------------------------

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$smokeTestScript = Join-Path $PSScriptRoot "smokeTest.ts"
$tsxPackageJson = Join-Path $repoRoot "node_modules\tsx\package.json"
$tsxLoader = Join-Path $repoRoot "node_modules\tsx\dist\loader.mjs"

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    Write-Host "[FAIL] node.exe was not found on PATH." -ForegroundColor Red
    Write-Host "Install Node.js (https://nodejs.org), open a new PowerShell window, and try again."
    exit 1
}

if (-not (Test-Path $tsxPackageJson)) {
    Write-Host "[FAIL] Dependencies are not installed." -ForegroundColor Red
    Write-Host "From $repoRoot, run:  pnpm install --frozen-lockfile"
    Write-Host "Then re-run this script."
    exit 1
}

if (-not (Test-Path $tsxLoader)) {
    Write-Host "[FAIL] tsx is installed, but its loader was not found at:" -ForegroundColor Red
    Write-Host "  $tsxLoader"
    Write-Host "This usually means node_modules is out of date. From $repoRoot, run:"
    Write-Host "  pnpm install --frozen-lockfile"
    exit 1
}

# ---------------------------------------------------------------------------
# Resolve tsx's loader to a verified, absolute file:// URL rather than
# passing the bare "tsx" specifier to `node --import`. A bare specifier is
# resolved by Node relative to the SPAWNED PROCESS's own working directory,
# not relative to this script or this repository - which is exactly what
# broke on a real Windows run: `node --import tsx` invoked while standing in
# an unrelated directory failed with ERR_MODULE_NOT_FOUND before the
# collector ever ran, because Node went looking for node_modules/tsx next to
# wherever the caller happened to be. [System.Uri] is used rather than a
# hand-built "file://" string because a Windows path's drive-letter colon
# (C:\...) is not on its own a valid URL and needs proper conversion - the
# same reason smokeTest.ts uses Node's own url.pathToFileURL() for the same
# path internally.
# ---------------------------------------------------------------------------

$tsxLoaderUri = ([System.Uri]$tsxLoader).AbsoluteUri

# ---------------------------------------------------------------------------
# Assemble the arguments smokeTest.ts actually understands and hand off.
# The report - pass/fail per check, plus the overall verdict - is what
# smokeTest.ts prints and writes; this wrapper's only job is to reach it
# directly, without pnpm or a shim in between, and to forward its exit code
# honestly, which is trustworthy PRECISELY because nothing sits in between.
# ---------------------------------------------------------------------------

$nodeArgs = @("--import", $tsxLoaderUri, $smokeTestScript)

if ($PresentMon) { $nodeArgs += @("--presentmon", $PresentMon) }
if ($PresentMonSha256) { $nodeArgs += @("--presentmon-sha256", $PresentMonSha256) }
if ($AllowUnpinnedPresentmon) { $nodeArgs += "--allow-unpinned-presentmon" }
if ($ProcessName) { $nodeArgs += @("--process-name", $ProcessName) }
if ($ProcessId) { $nodeArgs += @("--process-id", $ProcessId) }
$nodeArgs += @("--capture-seconds", $CaptureSeconds)
$nodeArgs += @("--cancel-after-seconds", $CancelAfterSeconds)
$nodeArgs += @("--game-id", $GameId)
if ($SettingsFile) { $nodeArgs += @("--settings-file", $SettingsFile) }
if ($ReportFile) { $nodeArgs += @("--report-file", $ReportFile) }

& $nodeCommand.Source @nodeArgs
$exitCode = $LASTEXITCODE

exit $exitCode
