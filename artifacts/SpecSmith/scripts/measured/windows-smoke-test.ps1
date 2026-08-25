<#
.SYNOPSIS
    The one supported command for smoke-testing the automatic PresentMon
    capture path on Windows: dependency checks, PresentMon location/hash,
    game-process detection, a dry-run capture, an internal cancellation +
    cleanup check against all four residues, and a pass/fail report.

.DESCRIPTION
    Earlier smoke testing meant copying a long checklist of individual
    PowerShell commands one at a time (see scripts/measured/README.md). Real
    retests each still needed a second, unplanned round of manual checking -
    once because Ctrl+C was leaving debris behind, once because the reported
    exit code didn't match what a manual read of the terminal suggested, once
    because this script's own attempt to SIMULATE Ctrl+C by calling
    child.kill('SIGINT') on the collector from outside it turned out not to
    work at all on Windows (see below). This script runs the same checks
    itself, once, and prints one report at the end.

    It deliberately does NOT run this through `pnpm collect:measured`. Real
    Windows retests showed that pnpm's own wrapper process, when hit by the
    same console-wide Ctrl+C as its child, does not reliably preserve the
    collector's own exit code - see the README's "pnpm's Windows exit code
    vs. the collector's own status" section. This script instead runs
    `node --import` (against tsx's own loader, resolved to a verified
    absolute path - see below) directly against the collector: no pnpm, and
    not even tsx's own .CMD shim, which is itself an unnecessary intermediate
    cmd.exe process of the same general shape. PowerShell's direct child here
    is node.exe, nothing else.

    CANCELLATION IS TESTED INTERNALLY, NOT BY SIMULATING CTRL+C. A real
    Windows run found that this script's own earlier attempt to simulate
    Ctrl+C - a separate launcher process calling child.kill('SIGINT') on the
    collector - does not work on Windows: Node's child.kill() there is not a
    real console Ctrl+C event the collector's signal handler could catch, so
    the collector was simply terminated, ran none of its own cleanup, and
    left the ETW session, lock file and temp directory behind every time.
    Manual, real Ctrl+C in a real console continued to work correctly
    throughout. So this script now asks the collector to cancel ITSELF, on an
    internal timer, via its own --internal-cancel-after-seconds flag (see
    collect.ts) - the same cancellation path a real Ctrl+C drives, just
    triggered from inside the process instead of by an external signal this
    launcher cannot reliably deliver. This proves the collector's own
    cancellation and cleanup logic works; it does NOT prove that a real
    console Ctrl+C reaches the collector, which is a genuinely different
    question this script cannot safely test from outside the process. The
    manual Ctrl+C checklist step in the README (step 8) remains the real
    check for that, and is not replaced by this script.

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
    The exact executable name of the running game, e.g. RDR2.exe.

.PARAMETER ProcessId
    The exact pid of the running game, as an alternative to -ProcessName.

.PARAMETER CaptureSeconds
    How long the dry-run capture window is. Default 20. Must comfortably
    exceed -CancelAfterSeconds.

.PARAMETER CancelAfterSeconds
    How far into the capture the collector self-cancels, via its own
    --internal-cancel-after-seconds - this tests the internal cancellation
    and cleanup path, not real Ctrl+C delivery. Default 5.

.PARAMETER GameId
    A real id from this repository's src/data/games.json (e.g. "rdr2",
    "cyberpunk2077") - not a display name, and not related to -ProcessName,
    which names the .exe rather than the SpecSmith catalog entry. Nothing
    written to the store depends on this being correct in a dry run, but an
    id the catalog does not recognize refuses before capture even starts.
    Default "rdr2". Run `pnpm collect:measured -- --game-id bogus ...`
    from the repo for the full accepted list if unsure.

.EXAMPLE
    .\windows-smoke-test.ps1 -PresentMon "C:\tools\PresentMon\PresentMon.exe" -ProcessName "RDR2.exe"

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
    [string]$GameId = "rdr2",
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
