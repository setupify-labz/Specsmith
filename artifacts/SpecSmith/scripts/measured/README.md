# V1 measured-observation collector

Produces **one** real SpecSmith observation from **one** controlled run on
Windows. Deliberately absent, not unfinished: community submission, accounts,
UI, scheduling, and any multi-game benchmark library.

## Requirements

- **Windows.** The collector refuses to run anywhere else rather than
  assembling a record whose hardware fields describe nothing.
- **PresentMon** ([Intel](https://game.intel.com/us/stories/intel-presentmon/)),
  the established Windows frame-capture tool — the **console** application, not
  the GUI. Install an official release yourself; it is not bundled (see
  [Why PresentMon is not vendored](#why-presentmon-is-not-vendored)).
- **Administrator, or membership in the "Performance Log Users" group.**
  PresentMon opens an ETW (Event Tracing for Windows) session, and Windows
  restricts who can control one. Per Microsoft's own documentation: "Only
  users running with elevated administrative privileges, users in the
  Performance Log Users group, and applications running as LocalSystem,
  LocalService or NetworkService can control event tracing sessions."
  Administrator is the obvious option; the group is the one worth knowing
  about if you would rather not run capture sessions elevated every time —
  an administrator adds an account to it once
  (`Computer Management → Local Users and Groups → Groups → Performance Log
  Users`, or `net localgroup "Performance Log Users" <username> /add` from an
  elevated prompt), and that account can then run PresentMon captures without
  further elevation. This is a general Windows ETW permission, not something
  documented specifically for PresentMon — it has not yet been verified
  against a real PresentMon capture (see the smoke test below).

## Usage

### Capture automatically (one command)

The collector can take the capture itself, so the PresentMon command line is
never typed by hand — which is where the two interesting mistakes live. A
forgotten `--v1_metrics` yields a file with no `MsBetweenPresents` at all; an
`--exclude_dropped` yields one that parses perfectly and is quietly wrong.

```
# 1. Write down the settings you used, verbatim.
notepad settings.txt

# 2. Start the game and get to the scene you want to measure.

# 3. Capture, assemble, validate, save — in one command.
#    Run this from an ELEVATED terminal.
pnpm collect:measured -- \
  --capture-process-id 4242 --capture-seconds 90 \
  --presentmon "C:\tools\PresentMon\PresentMon.exe" \
  --presentmon-sha256 <digest of your PresentMon.exe> \
  --game-id <catalog id> \
  --resolution 1440p --preset high \
  --ram-channels 2 --settings-file settings.txt \
  --dry-run
```

Find the pid with `Get-Process YourGame | Select-Object Id, ProcessName`.
`--capture-process-name YourGame.exe` also works, but **fails closed** when two
processes share the name — a launcher beside the game, two clients, a game
beside its crash handler. PresentMon's own `--process_name` would record
whichever of them presented, producing a CSV that names the right executable
while describing the wrong process.

Capture flags:

| Flag | Meaning |
|---|---|
| `--capture-process-id <pid>` | The exact process to record. Preferred. |
| `--capture-process-name <name.exe>` | By name; refuses if more than one matches. |
| `--capture-seconds <n>` | Capture length, 5–3600. |
| `--presentmon <path>` | PresentMon.exe. Also `SPECSMITH_PRESENTMON`. |
| `--presentmon-sha256 <digest>` | Pinned digest. Also `SPECSMITH_PRESENTMON_SHA256`. |
| `--allow-unpinned-presentmon` | Capture without a pin, recording that it was unpinned. |
| `--capture-output-dir <dir>` | Write the CSV here instead of a temp directory. |
| `--keep-capture` | Keep the temp CSV after parsing, for a post-mortem. |

Ctrl-C cancels a capture in progress, stops PresentMon and cleans up.

To get the digest to pin, after downloading an official release:

```
Get-FileHash -Algorithm SHA256 "C:\tools\PresentMon\PresentMon.exe"
```

The first run without a pin prints the digest it computed and refuses, so the
value can be copied from there once it has been checked against the release you
downloaded.

### Or capture by hand, as before

`--csv` is unchanged and still accepted. It cannot be combined with the
`--capture-*` flags: a command line carrying both says two different things
about where the measurement came from.

```
# 1. Capture a run with PresentMon while playing the game.
PresentMon.exe --process_name YourGame.exe --v1_metrics --output_file run.csv

# 2. Write down the settings you used, verbatim.
notepad settings.txt

# 3. Assemble, validate, save. The GPU and CPU are resolved from what Windows
#    reports; --gpu-id/--cpu-id only disambiguate cards that share a name.
pnpm collect:measured -- \
  --csv run.csv --process YourGame.exe \
  --game-id <catalog id> \
  --resolution 1440p --preset high \
  --ram-channels 2 --settings-file settings.txt \
  [--gpu-name "NVIDIA GeForce RTX 4070"] \
  [--game-exe "C:\path\YourGame.exe"] [--upscaler dlss --upscaler-mode quality] \
  [--ray-tracing] [--frame-generation --frame-generation-factor 2] \
  [--render-scale 100] [--gpu-overclocked] [--dry-run] \
  [--swap-chain 0x...] [--gpu-id <id>] [--cpu-id <id>]
```

`--dry-run` validates and prints without writing anything.

## What it reuses rather than reimplements

| Concern | Owned by |
|---|---|
| FPS / 1% low / 0.1% low | `src/lib/measured/frameTimes.ts` |
| Validation rules and severity | `src/lib/measured/validate.ts` |
| Record shape | `src/lib/measured/types.ts` |
| Frame-time blob storage | `scripts/measured/frameTimeStore.mjs` |
| Reading a capture | `scripts/measured/presentmon.ts` |
| Taking a capture | `scripts/measured/presentmonRunner.ts` |

The capture runner decides how to CAPTURE and nothing about what a capture
MEANS: it reads no frame time, computes no statistic, applies no rule. Its
bytes go to `parsePresentMonCsv` and onward through the same path a hand-made
CSV takes.

The collector computes no statistic and enforces no rule of its own. A second
implementation of any of those would be a second definition of what SpecSmith
means by a measurement.

## Automatic capture: decisions worth knowing

**The argument vector is closed.** There is no passthrough for extra PresentMon
flags. Several options produce a file that still parses and still validates
while meaning something other than what the record claims, and none of them can
be reached from a command line:

| Flag | Why it is never passed |
|---|---|
| `--exclude_dropped` | Removes real rendered frames from a rendered-frame metric and breaks the delta chain. |
| `--no_track_gpu` | Removes `msGPUActive`, so segmentation's GPU-utilisation stage has no evidence the GPU was rendering. |
| `--no_track_display` | Removes `PresentMode`, segmentation's primary signal. |
| `--multi_csv` | Splits output per process, so the path we then read is not the file we asked for. |

An operator who genuinely needs a different capture runs PresentMon by hand and
uses `--csv`.

**The columns are verified against the file, not assumed from the flags.** The
flags are our intent; the header is the outcome, and only the outcome is
evidence. Four of the required columns — `Application`, `ProcessID`,
`SwapChainAddress`, `Dropped` — are *optional* to the parser, which tolerates
hand-made captures without them. But the parser's fail-closed guards are built
on them: the multi-process refusal reads `Application`, the multi-swap-chain
refusal reads `SwapChainAddress`. Absent, those sets stay empty and the guards
cannot fire. A capture missing them does not fail — it silently loses its
safety checks — so the runner requires them, where it controls the capture and
their absence means something is genuinely wrong.

**Pinning is by digest, not by version string.** PresentMon's console
application does not document a `--version` flag, so there is no supported way
to ask a binary what it is. Asking would be the weaker check anyway: a version
string is a claim the file makes about itself; the SHA-256 of the bytes is not.
Unpinned is refused by default, because a different PresentMon can emit
different columns and the resulting record would not say so.

**Hardware detection runs before the capture, not after it.** It is the step
most likely to refuse — an iGPU beside a discrete card is the common case, not
the exotic one — and refusing after a 90-second capture would throw away a run
the operator has to play again.

**PATH is not searched.** A capture whose tool was chosen by environment is not
reproducible.

**Only a temp directory the runner created is ever deleted, and only once the
process is CONFIRMED stopped.** `--capture-output-dir` can legitimately point
at a folder holding other captures; cleanup that reached outside its own
directory is how a diagnostic tool deletes an operator's data. Separately, on
cancellation or a watchdog timeout, PresentMon is asked to stop (SIGTERM) and,
if it has not exited within a grace period, killed outright (SIGKILL) — but
cleanup never runs off the mere fact that a stop was requested. It runs only
once the process has actually exited, because PresentMon may still hold its
CSV file open until then; deleting the directory around a process that is
still writing to it is the bug this sequencing exists to prevent.

**Every capture the collector takes is recorded on the observation itself.**
`captureTool` carries the executable's name, its SHA-256, and whether that
digest was checked against a pin before this run — not just printed to the
console. A `--csv` run cannot supply it (the collector never touched
PresentMon, so it has no evidence of what produced the file), and that
absence is disclosed as a `captureTool` entry in `detectionGaps` rather than
left unmentioned. An unpinned real capture (`--allow-unpinned-presentmon`)
is disclosed the other way, as a `capture-tool.unpinned` validation warning,
because in that case the collector *does* know what ran — it just was not
checked against a pin first.

**Only one SpecSmith capture can run at a time.** Every capture uses the same
fixed ETW session name and passes `--stop_existing_session` so a session
left behind by a crashed run does not permanently block the next one. Without
a lock, that same flag becomes a hazard the moment two captures overlap — two
terminals, or a retried command that looked hung but was not — because the
second one stopping the session out from under the first would silently
truncate it rather than fail loudly. A lock file (in the OS temp directory,
named after the session it protects) makes a second concurrent attempt fail
immediately instead, naming the pid that holds it. A lock left behind by a
crashed collector is detected as stale (its recorded pid is no longer
running) and cleared automatically, so one crash does not lock out every
future capture.

### Why PresentMon is not vendored

PresentMon is MIT licensed (Copyright (C) 2017-2024 Intel Corporation, verified
against `LICENSE.txt` in `GameTechDev/PresentMon`), so vendoring it would be
permitted. It is still not vendored, because licence permission is only half the
question and provenance is the other half: a Windows binary committed to this
repository could not be shown to be the one Intel published, and a build-host
digest recorded by the same commit that adds the file proves nothing about its
origin. The operator installs an official release and pins its digest — a
pairing that is checkable by whoever runs the capture, which a vendored blob is
not.

## Decisions worth knowing

**`MsBetweenPresents`, not `MsBetweenDisplayChange`.** The former measures
RENDERED frames; the latter measures DISPLAYED frames, which under frame
generation includes frames the GPU never rendered. Mixing them would produce a
frame-generation-inflated number wearing a native label.

**A missing column is rejected, never substituted.** PresentMon 2.x renamed
much of its output. Guessing at an equivalent column would produce entirely
plausible — and wrong — frame times, so the parser names the flag needed
instead.

**The first present is discarded.** It has no prior frame to be measured
against and PresentMon reports `0` for it.

**Dropped presents are RETAINED** and counted. PresentMon 1.9.2 defines
`Dropped` as "whether the frame was dropped (1) or displayed (0)" — it means
NOT DISPLAYED. The application still called Present() and the GPU still
rendered the frame, and `msBetweenPresents` is defined over Present() calls
regardless. Excluding them, which this parser used to do, both discarded real
rendered frames and broke the delta chain: each row's interval is measured
against the previous present row, so removing a row leaves its successor's
interval spanning a gap, and the kept intervals stop summing to the capture
duration. Exclusion is correct for `msBetweenDisplayChange`, which is undefined
for a frame that never reached the screen; it is not correct here.

**Only the first present may have no interval.** PresentMon reports 0 for it
because there is no previous Present() to measure against. Any later
non-positive or non-finite value, and any short row before the last line, is
REJECTED with its CSV line number rather than skipped — skipping quietly
shortens the run and reports a plausible-looking count for it.

**Multi-swap-chain captures are rejected** without an explicit `--swap-chain`.
Two swap chains are two independent present series and cannot be interleaved.

**Multi-process captures are rejected** without an explicit `--process`.
Interleaving two applications' frames would produce a meaningless run.

**The GPU adapter is never guessed.** On a machine with one rendering adapter
it is selected automatically; virtual and fallback display devices (Microsoft
Basic Display, DisplayLink, Parsec, VMware…) are excluded. With more than one —
any iGPU + discrete card combination — the collector **refuses** and asks for
`--gpu-name "<exact name>"`. Picking wrongly would record the wrong GPU *and*
the wrong driver version together, silently, since both are read from the same
adapter object.

**Catalog ids are operator-supplied, and labelled `manual`.** No fuzzy matcher
runs. A wrong automatic match — a laptop part sharing a desktop part's name —
would be invisible afterwards. The raw detected strings are stored beside the
ids so a bad pairing stays auditable.

**Saved only on zero errors.** A rejected run is discarded, not parked. A store
that holds invalid records is not a source of truth. Warnings never block; they
are disclosures that travel with the record.

## Platform games (Roblox, and anything like it)

Roblox is not a game, it is a platform. Its client version says nothing about
what was rendered — two runs of "Roblox" can be unrelated experiences with
completely different performance. An observation carrying only a client version
is not interpretable.

| Field | Obtainable? |
|---|---|
| client version | **Yes** — each build lives in `%LOCALAPPDATA%\Roblox\Versions\version-<hash>\`; read it with `--game-exe` |
| `contentId` (place/universe id) | **By the operator**, from the URL joined — not by the collector |
| `contentVersion` | **Usually not.** Roblox exposes a place version to the experience's creator, not to players. Recorded as a disclosed warning, never guessed |

```
--game-exe "C:\Users\<you>\AppData\Local\Roblox\Versions\version-<hash>\RobloxPlayerBeta.exe" ^
--platform roblox --content-id <place id> --content-name "<experience name>"
```

A `platformContent` block with no `contentId` is an ERROR, not a gap — without
it the run cannot be interpreted at all.

## Games with no comparable preset tier

Roblox has no Low/Medium/High. It has a Manual slider from 1 to 10, and there
is no honest answer to "is Manual 8 high or ultra?" — the scale is not
calibrated against anything outside Roblox. Forcing a bucket would invent a
cross-game equivalence and make the run silently comparable to another game's
"high".

Use `--preset unmapped` with the verbatim setting:

```
--preset unmapped --preset-label "Graphics Quality: Manual 8"
```

`presetLabel` is **required** when preset is `unmapped` — this records more
than a forced bucket would, not less. The shared `Preset` union is deliberately
unchanged, so the source-derived system's meaning of a preset is untouched.

## Fields that cannot be detected, and are marked rather than guessed

Every observation carries a `detectionGaps` array naming these with a reason:

| Field | Why not detected |
|---|---|
| `ram.channels` | Windows exposes DIMM slots, not physical channel mapping; deriving channels needs motherboard-specific knowledge. Operator-supplied via `--ram-channels`. |
| `detected.gpuOverclockDetected` | Needs a vendor SDK (NVAPI/ADL) this collector does not link. Operator-supplied via `--gpu-overclocked`. |
| `settingsHash` | No general way to read an arbitrary game's graphics config. Hashed from operator-attested text, and `settingsSource: 'operator-attested'` raises a warning on every V1 record. |

Detected reliably: GPU name, GPU driver version, CPU name, OS build, total RAM,
configured RAM speed, DIMM count. Note the driver version is the Windows build
(`32.0.15.6636`), not the vendor marketing version (`566.36`) — that is the
value that can be read reliably, so it is the one recorded.

## What the first real Windows run verified

One dry run has been performed on real hardware: a 90-second PresentMon
capture of Roblox on an RTX 5070 / Ryzen 5 5600X / 32 GB Windows 11 machine,
21,354 usable frames, run with `--dry-run` so nothing was recorded. It
confirmed:

- **The Windows probe executes and populates its fields.** GPU name, GPU
  driver version, CPU name, OS build, total RAM and DIMM count all came back
  populated on real hardware.
- **Adapter selection excluded a real virtual display device.** The machine
  reported two adapters — an RTX 5070 and a "Meta Virtual Monitor" — and the
  probe selected the RTX 5070 without needing `--gpu-name`. This exercised the
  virtual-device exclusion list against a real device name. It did **not**
  exercise the refusal path for two genuine rendering GPUs, which still has
  never been seen.
- **A real PresentMon CSV parses.** It also found a defect: the real file
  writes `msBetweenPresents`, not the documented `MsBetweenPresents`, and the
  parser required the documented casing. Column matching is now
  case-insensitive and the real 19-column header is pinned as a fixture.
- **The frame-count and duration minimums, and the plausibility bounds, met a
  real capture** and passed. 21,354 frames at the computed 237.31 fps average
  implies 89.98 s, consistent with the 90-second timed capture.
- **The CLI runs end to end on Windows** through hardware detection, parsing,
  statistics and validation.

Validation behaved as designed on that run: a warning for
`settings.operator-attested` and an error for `conditions.game-version-missing`,
since the run supplied no game version. The record was correctly not produced.

## Windows smoke test for automatic capture

Nothing below has been run automatically. The capture runner's logic is
covered by mocked tests against an injected spawn; PresentMon actually
producing a file is the part that only Aaron's machine can exercise.

### The fast path: one command

`scripts/measured/windows-smoke-test.ps1` runs most of the checklist below
for you — dependency checks, PresentMon location and hashing, finding the
game's process, a dry-run capture, an INTERNAL cancellation with a real wait
for cleanup, all four residue checks, and a pass/fail report — and prints one
report at the end instead of a transcript to read by hand. It pauses only
when it genuinely cannot proceed without you: if the game process cannot be
found yet.

```powershell
.\scripts\measured\windows-smoke-test.ps1 `
  -PresentMon "C:\tools\PresentMon\PresentMon.exe" `
  -ProcessName "RDR2.exe"
```

Run `Get-Help .\scripts\measured\windows-smoke-test.ps1 -Full` for every
parameter. It is dry-run only — it never writes to the observation store —
and it never runs through `pnpm collect:measured`. It calls `node --import`
(tsx's own loader, resolved to a verified absolute path) directly against
the collector for anything that touches cancellation, deliberately skipping
BOTH pnpm's own wrapper process and tsx's `.CMD` shim. See "pnpm's Windows
exit code vs. the collector's own status" below for why: real Windows
retests showed pnpm's own Windows exit-code handling cannot be trusted for
this, and a further patch to the collector's own code cannot fix that,
because the number PowerShell reports for `pnpm collect:measured` is not
read from the collector at all once it has gone through pnpm's wrapper.

**Cancellation is tested internally, not by simulating Ctrl+C.** An earlier
version of this launcher tried to simulate Ctrl+C itself, from outside the
collector, by calling `child.kill('SIGINT')` on it. A real Windows run showed
that does not work at all: Node's `child.kill()` on Windows is not a real
console Ctrl+C event the collector's own signal handler could catch — the
child was simply terminated, ran none of its own cancellation or cleanup
logic, and left the ETW session, lock file and temp directory behind, every
time. Manual, real Ctrl+C in a real console continued to work correctly
throughout — the failure was specific to one process trying to signal
another externally on Windows, which nothing outside a Windows process can
safely do. So the launcher now asks the collector to cancel ITSELF, on an
internal timer, via collect.ts's own `--internal-cancel-after-seconds` (gated
to `--dry-run`, see `validateInternalCancelAfterSeconds` in `collect.ts`) —
the exact same `AbortController` a real Ctrl+C drives (see
`simulateSignal` in `cancellation.ts`), just triggered from inside the
process instead of by a signal delivered from outside it. **This proves the
collector's own cancellation and cleanup logic works. It does NOT prove a
real console Ctrl+C reaches the collector** — that is a genuinely different
question about OS signal delivery this launcher cannot safely test from
outside the process. Smoke-test step 8's manual Ctrl+C check remains the
real test for that, and this launcher does not replace it.

Three further defects a real Windows run then found, all fixed:

- **`node --import tsx` failed with `Error [ERR_MODULE_NOT_FOUND]: Cannot
  find package 'tsx'`** when the launcher was invoked from a different
  directory than the repository — `node --import` resolves a bare specifier
  relative to the caller's own working directory, not this repository. Every
  path the script uses is now resolved from `$PSScriptRoot` (this file's own
  folder), and tsx is resolved to a verified, absolute `file://` URL rather
  than a bare specifier — see `resolveTsxImportUrl` in `smokeTest.ts`, and
  the `.ps1` file's own comments for the PowerShell-side half of the same
  fix. It genuinely does not matter what directory you run it from now, and
  that specific property is covered by `smokeTest.test.ts` (`'resolves tsx
  correctly even when the spawned process's own cwd is nothing to do with
  this repo'`), which fails without the fix.
- **The pnpm dependency check reported ENOENT even on a machine where `pnpm
  install` worked fine from an actual shell.** `execFileSync('pnpm', [...])`
  with no shell does not perform the PATHEXT resolution pnpm's Windows entry
  point (`pnpm.cmd` / `pnpm.CMD` / `pnpm.ps1`) needs. The check's severity
  was fixed alongside it: pnpm was never actually required by this launcher
  (it calls `node` directly, see above), so its absence is informational
  only and can never fail the run.
- **The default `-GameId` was `"marvel-rivals"`, which is not a real id in
  `src/data/games.json`** — the catalog check refused it before capture ever
  started. This is a pre-existing documentation defect the same run
  surfaced, not new to the launcher: the manual checklist below had the same
  wrong value in its own example commands, now fixed there too. The default
  is now `"rdr2"`, a real catalog id, and the one the launcher has actually
  been run against.

A follow-up hardening pass then tightened all three:

- **pnpm resolution no longer uses `shell: true`.** It fixed the PATHEXT
  problem correctly, but by handing a whole command STRING to cmd.exe to
  parse — broader than the fix needed. `resolvePnpmCommand` in
  `smokeTest.ts` does the same PATHEXT resolution itself instead: it walks
  `PATH`, tries each extension `PATHEXT` lists, and finds the real,
  extensioned file (`pnpm.CMD`, `pnpm.exe`, ...) pnpm's bare name resolves
  to. `execFileSync` then runs that file directly, with args passed as an
  array — no shell, and no command string ever built by hand.
- **`smokeTest.ts` no longer has its own `"rdr2"` fallback.** An automatic
  capture always requires an explicit `--game-id` — the same rule
  `collect.ts`'s own `parseRunConditions` already enforces — checked by
  `checkGameId` and reported in the checklist as its own line ("Game id
  provided") rather than failing several steps later with collect.ts's
  generic message. `windows-smoke-test.ps1`'s own `-GameId` parameter still
  defaults to `"rdr2"` and always passes it through explicitly; that is the
  one place a default is allowed to live, because it is a real argument
  being supplied, not an assumption `smokeTest.ts` makes for itself.
- **The report is no longer written into the repository.**
  `specsmith-smoke-test-report.txt` used to land in `specsmithRoot`, an
  untracked file left in the working tree after every run. `resolveReportPath`
  now defaults to the OS temp directory, and still honours an explicit
  `--report-file` / `-ReportFile` exactly as before.

Its own PowerShell syntax has now parsed and run on real Windows across
three runs; what still has not been exercised there is everything past
dependency resolution and cancellation — hardware detection, `logman`,
PresentMon itself — nor has this latest hardening pass been run on Windows
yet. Report anything it gets wrong verbatim.

**What it does NOT cover**, which still needs the manual checklist below:
elevation actually being required (step 6), `--keep-capture` (step 9), the
game closing mid-capture (step 10), and two concurrent captures colliding
(step 11) — none of those are about cancellation or the pnpm boundary, so
there was no reason to move them off the manual, one-command-at-a-time path.

### Before you start

You need: an official PresentMon console release, downloaded and unzipped
somewhere like `C:\tools\PresentMon\`; a terminal — PowerShell is fine; and a
game you can leave running for a few minutes. Every command below is meant to
be copy-pasted, one at a time, in order — each one is checking one specific
thing, and several of them are SUPPOSED to fail with a specific message. That
is the test passing, not a problem.

**Step 0a — install the workspace.** From the repository root:

```powershell
corepack enable
pnpm install --frozen-lockfile
```

This must succeed before anything below will work. (It used to fail on
Windows: the root `preinstall` guard shelled out to `sh`, which cmd.exe
cannot find, so the install died before fetching a single dependency. It is
now a Node script — `tools/preinstall.mjs` — and needs no Unix shell.)

**Step 0b — get the tool's digest, and decide how you'll run it elevated.**

PresentMon needs to open a low-level Windows tracing session, which requires
either an elevated ("Run as administrator") terminal, or your account being a
member of the "Performance Log Users" Windows group (see Requirements above —
an administrator can add you to it once via `Computer Management → Local
Users and Groups → Groups`, and after that you never need to elevate for this
again). Pick whichever you have; both are tested below (step 6).

Open a terminal **as Administrator** for now (right-click Start → "Windows
PowerShell (Admin)" or "Terminal (Admin)"), then run:

```powershell
Get-FileHash -Algorithm SHA256 "C:\tools\PresentMon\PresentMon.exe"
```

This prints a long hex string — that's the file's SHA-256. Copy it somewhere;
you'll paste it into `--presentmon-sha256` below. (The collector also prints
this itself the first time you forget it — step 1 shows that.)

**Find your game's process ID**, so you can tell the collector exactly which
window to measure (replace `RDR2` with something matching your game's window
title or exe name):

```powershell
Get-Process | Where-Object ProcessName -like '*RDR2*' | Select-Object Id, ProcessName
```

Note the `Id` column — that's the pid you'll pass as `--capture-process-id`
below. From here on, `<pid>` means that number and `<sha>` means the digest
from step 0.

### The checklist

Run these in order. The "Expected" column tells you what SHOULD happen —
if you see that message, move on to the next row.

| # | What you're checking | Command | Expected |
|---|---|---|---|
| 1 | The collector refuses an unpinned tool, and tells you the digest | `pnpm collect:measured -- --capture-process-id <pid> --capture-seconds 5 --presentmon "C:\tools\PresentMon\PresentMon.exe" --game-id rdr2 --resolution 1440p --preset high --ram-channels 2 --settings-file settings.txt --dry-run` (no `--presentmon-sha256`) | Refuses, prints "No pinned digest for … Its SHA-256 is …" |
| 2 | It refuses a WRONG digest, rather than trusting it | Same as #1, add `--presentmon-sha256 0000000000000000000000000000000000000000000000000000000000000000` | Refuses: "is not the one this collector was set up against" |
| 3 | It refuses a pid that isn't running | Same as #1 + real `--presentmon-sha256 <sha>`, but `--capture-process-id 999999` | Refuses: "No running process has pid 999999" |
| 4 | It refuses when a process name is ambiguous | `--capture-process-name explorer.exe` instead of `--capture-process-id` (Explorer usually has more than one) | Refuses, lists more than one pid, points you at `--capture-process-id` |
| 5 | It refuses when pid and name disagree | `--capture-process-id <pid> --capture-process-name totally-wrong.exe` | Refuses, names what that pid actually is |
| 6 | Elevation (or the group) is genuinely required | Run command #7 below from a terminal that is **neither elevated nor in Performance Log Users** | PresentMon exits immediately; the error mentions both Administrator and "Performance Log Users" |
| 7 | **The real thing.** With the game running: full capture | `--capture-process-id <pid> --capture-seconds 30 --presentmon "C:\tools\PresentMon\PresentMon.exe" --presentmon-sha256 <sha> --game-id rdr2 --resolution 1440p --preset high --ram-channels 2 --settings-file settings.txt --dry-run` (play normally for the 30 seconds) | Captures, prints Hardware/Attributed/Frames/avg fps, prints a `Capture tool:` line, writes nothing |
| 8 | Cancelling mid-capture doesn't leave a mess | Repeat #7, press **Ctrl-C** once around 5 seconds in | "SIGINT received — cancelling capture", then it *waits*, then exits. Afterwards ALL FOUR must be true: no `SpecSmithMeasuredCapture` in `logman query -ets`; no `$env:TEMP\SpecSmithMeasuredCapture.lock`; no `$env:TEMP\specsmith-capture-*`. **Read "pnpm's Windows exit code vs. the collector's own status" below before running this step** — `$LASTEXITCODE` here reflects pnpm's Windows exit-code handling, confirmed on two separate real retests to read 1, not the collector's own 130; that is expected with this specific command, not a failure, and the four residues are the actual check. |
| 8b | The second Ctrl-C is a real escape hatch | Repeat #7, press **Ctrl-C twice** | "Second interrupt — abandoning the wait", exits promptly, lock and temp directory still removed |
| 9 | You can keep the raw CSV for inspection | Repeat #7 with `--keep-capture` added | Prints "Capture retained at …"; that file still exists afterward |
| 10 | Closing the game mid-capture is handled | Repeat #7, close the game before the 30 seconds are up | Either a short, valid capture, or a clear "presented no frames" message |
| 11 | **Two captures can't collide.** Open a SECOND terminal | While #7 (a real, slow one — use 60+ seconds) is still running in terminal A, run the SAME command in terminal B | Terminal B refuses immediately: "Another SpecSmith capture is already running (pid …)" — it must NOT start, and terminal A's capture must finish normally, undisturbed |

### pnpm's Windows exit code vs. the collector's own status

Two separate real Windows retests of `pnpm collect:measured`, each against a
fix aimed straight at this, found the SAME two symptoms both times:

- PowerShell's prompt reappears before the collector's own final
  cancellation line finishes printing.
- `$LASTEXITCODE` reads 1, not the collector's documented, deliberately-set
  130 — including after a fix (34f97a6) that specifically corrected a
  confirmed bug where the collector's OWN code was overwriting its own exit
  status. That fix was verified: it made a direct, no-pnpm invocation report
  130 correctly, and a real-subprocess regression test fails without it. The
  retest afterward still showed 1 through `pnpm collect:measured`. That rules
  out the collector's own exit-code handling as the cause — the number was
  already correct one layer down.

**What this means, stated plainly: these are two different facts, and only
one of them is under this project's control.**

1. **The collector's own exit status** — what `cancellation.ts` sets, and
   what `collect.ts`'s own code returns to — is CANCELLED_EXIT_CODE (130) on
   a Ctrl-C-initiated cancellation. This is real, tested, and confirmed
   correct on Windows for a DIRECT invocation (`node --import tsx
   scripts/measured/collect.ts …`, no pnpm) via `windows-smoke-test.ps1`.
2. **What PowerShell's `$LASTEXITCODE` shows after `pnpm collect:measured`**
   is a fact about pnpm's own Windows behaviour when its wrapper process is
   hit by the same console-wide Ctrl-C as its child, confirmed on two
   separate real machines to be 1. This is NOT read from the collector once
   the invocation has gone through pnpm's script-running wrapper — a further
   patch to collect.ts's own exit-code handling cannot change it, because by
   the time PowerShell reports it, it is reporting pnpm's own outcome, not
   the collector's. This project does not control pnpm's Windows behaviour,
   and this README no longer claims a mechanism for the prompt reappearing
   early — two consecutive real retests is enough to say it happens
   consistently through `pnpm collect:measured`, not enough to say why, and
   guessing again was explicitly the wrong move once real evidence
   disagreed with the first guess.

**What to actually do about it:**

- For automated checking, use `windows-smoke-test.ps1` (above). It never
  goes through pnpm for anything cancellation-sensitive, specifically
  because of the two facts above, and its own report — not `$LASTEXITCODE` —
  is the pass/fail signal.
- For a manual `pnpm collect:measured` run (step 8), judge cancellation by
  the four residues and the cancellation message actually appearing on
  screen, never by `$LASTEXITCODE` or by when a prompt appears. Both are
  pnpm/PowerShell facts, not collector facts, for this specific invocation
  style.

### What to check on the run that succeeds (#7)

- The console printed a `Capture tool: PresentMon.exe sha256 … (pinned)` line
  — that's `captureTool` confirmed on the record, not just printed during
  capture.
- The header of the retained CSV (`--keep-capture`, step 9) contains
  `msBetweenPresents`, `PresentMode` and `msGPUActive`. If any is absent the
  runner will already have refused — confirm the message names the column.
- The reported frame count is consistent with the duration and the average fps,
  the same arithmetic the existing README did for the 90-second Roblox run
  (21,354 frames at 237.31 fps ⇒ 89.98 s).
- The temp directory under `%TEMP%\specsmith-capture-*` is **gone** afterwards
  when `--keep-capture` was not passed (steps 7, 8, 11).
- No `SpecSmithMeasuredCapture` ETW session is left behind:
  `logman query -ets` should not list it once the collector has exited. This
  is the check that failed before: Ctrl+C used to leave the session running
  and it had to be stopped by hand with `logman stop SpecSmithMeasuredCapture
  -ets`. If it is somehow still listed, that command is the manual recovery —
  and it is a bug worth reporting, not a normal step.
- No lock file is left behind: `Test-Path "$env:TEMP\SpecSmithMeasuredCapture.lock"`
  should print `False` once every capture above has finished.

Then, and only then, the first **non**-dry run — which is also the first time
the store append path and the frame-time archive will have executed for real.

## What remains unverified

- **No record has ever been saved.** Every run so far has been a dry run. The
  store append path, and the frame-time archive being written for real, have
  not been exercised on a real observation.
- **`--game-exe` version detection** has never read a real executable. The
  path is passed through an environment variable rather than interpolated into
  the PowerShell command, so the escaping defect is fixed, but the detection
  itself is unconfirmed.
- **`--platform` / `--content-id` and `--preset unmapped`** have never been
  used in a real run. Their validation rules are covered by tests only.
- **The genuine multi-rendering-GPU refusal** has never been triggered. Only
  the virtual-display exclusion has been seen on real hardware.
- **Frame-generation and upscaler paths** have never been captured for real;
  the `msBetweenPresents` choice that keeps generated frames out of the count
  is reasoned from PresentMon's documentation, not observed.
- **Cancellation cleanup has been fixed AND re-verified on real Windows
  hardware, twice.** Ctrl+C during a real capture used to return to the
  prompt with no message and leave the ETW session, lock file and temp
  capture behind. Both retests since confirmed all four residues are gone
  after one Ctrl+C: no PresentMon process, no ETW session, no lock file, no
  `specsmith-capture-*` directory. That part of the fix is settled.
- **`pnpm collect:measured`'s reported exit code and prompt timing are a
  pnpm/Windows fact, not a collector bug, and are no longer being chased with
  further collect.ts patches.** The first retest found `$LASTEXITCODE` was 1,
  not 130, and traced it to a real bug: collect.ts's own top-level `.catch`
  was overwriting the exit code `cancellation.ts` had already set. That was
  fixed (34f97a6) and is covered by a real-subprocess regression test that
  reproduces the old bug when reverted. A SECOND retest, against that exact
  fix, still showed `$LASTEXITCODE` as 1 and the prompt still reappearing
  early — which rules out the collector's own code as the cause, because the
  fix already made a DIRECT (no-pnpm) invocation report 130 correctly, and
  the retest was through `pnpm collect:measured`, not directly. See "pnpm's
  Windows exit code vs. the collector's own status" above for what is
  actually established: the collector's own exit status is correct and
  tested; what PowerShell shows after going through pnpm's wrapper is a
  separate, confirmed-but-unexplained fact about pnpm's Windows behaviour
  that this project does not control and is not attempting to patch around a
  third time. `windows-smoke-test.ps1` (above) sidesteps the question
  entirely for automated checking by never going through pnpm for anything
  cancellation-sensitive.
- **The launcher's own cancellation test used to simulate Ctrl+C by calling
  `child.kill('SIGINT')` on the collector from a separate process — a real
  Windows run showed this does not work at all on Windows.** Node's
  `child.kill()` there is not a real console Ctrl+C event the collector's
  signal handler could catch; the collector was simply terminated, ran none
  of its own cancellation logic, and left the ETW session, lock file and
  temp directory behind every time — even though manual, real Ctrl+C
  continued to work correctly throughout the same run. This is now fixed by
  testing cancellation from INSIDE the collector instead: collect.ts's new
  `--internal-cancel-after-seconds` (gated to `--dry-run`) triggers the exact
  same `AbortController` a real Ctrl+C uses, via `cancellation.ts`'s
  `simulateSignal`, from a timer the collector starts once capture actually
  begins. This proves the cancellation and cleanup logic itself works; it
  does not and cannot prove real Ctrl+C delivery, which remains smoke-test
  step 8's job alone — see "pnpm's Windows exit code vs. the collector's own
  status" above for the full account, including two further defects
  (`ERR_MODULE_NOT_FOUND` from a bare tsx specifier, and a false pnpm ENOENT)
  that same run surfaced and this fix addresses alongside it. Not yet
  confirmed: whether the internal timer approach behaves identically on real
  Windows, since the two runs that found these bugs predate the fix.
- **Automatic capture has never run.** No PresentMon process has been spawned by
  this collector. The flag set is taken from Intel's documented console options
  and the column requirements from the pinned real fixture, but the pairing —
  these flags, on a real PresentMon, producing a file with those columns — is
  reasoned, not observed. Everything around it (process selection, digest
  pinning, timeout, cancellation, cleanup, column verification) is covered by
  mocked tests only. See the smoke test above.
- **The "Performance Log Users" group has never been tried against a real
  PresentMon capture.** It is documented by Microsoft as an ETW permission
  (quoted in Requirements above), but that documentation is general — it is
  not written specifically about PresentMon, and no real capture has been run
  from an account that is a member of the group but not an Administrator.
  Smoke-test step 6 covers Administrator; it does not yet cover the group.
- **The confirmed-exit termination sequence (SIGTERM, then SIGKILL if
  PresentMon does not respond, then — only then — cleanup) has only been
  exercised against a fake child process.** Whether a real PresentMon
  actually responds to Node's `child.kill('SIGTERM')` by flushing and exiting
  gracefully, or requires the SIGKILL escalation every time, is unconfirmed;
  either way the sequence should behave correctly, but which branch real
  captures normally take is not yet known. Smoke-test step 8 exercises this
  for real.
- **The single-capture lock has never been tested against two real
  `pnpm collect:measured` processes.** Its logic (create, detect a live vs.
  stale holder, release) is unit-tested against an injected filesystem;
  whether two real Node processes on the same machine actually collide and
  refuse the way the tests predict is unconfirmed. Smoke-test step 11 covers
  this.
- **`captureTool` has never been recorded on a real observation.** Its shape
  and the warning for an unpinned tool are tested against synthetic data;
  whether it survives a real capture → assemble → (eventually) save round
  trip unaltered is unconfirmed. Smoke-test step 7's `Capture tool:` line is
  the first real check of this.

A dry run proves the pipeline runs. It does not prove the pipeline records
correctly, because the recording half never executed.
