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
- **Administrator.** PresentMon opens an ETW session, which needs an elevated
  terminal. Without it PresentMon exits immediately.

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

**Only a temp directory the runner created is ever deleted.**
`--capture-output-dir` can legitimately point at a folder holding other
captures; cleanup that reached outside its own directory is how a diagnostic
tool deletes an operator's data.

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

Nothing below has been run. The capture runner's logic is covered by mocked
tests against an injected spawn; PresentMon actually producing a file is the
part that only Aaron's machine can exercise. Run these in order — each one
fails differently, and the point is to see the *right* failure.

Prerequisites: an official PresentMon console release installed, an
**elevated** terminal, and a game you can leave running.

```powershell
# 0. Digest to pin.
Get-FileHash -Algorithm SHA256 "C:\tools\PresentMon\PresentMon.exe"

# Find the game's pid.
Get-Process | Where-Object ProcessName -like '*RDR2*' | Select-Object Id, ProcessName
```

| # | Command | Expected |
|---|---|---|
| 1 | Omit `--presentmon-sha256` | Refuses, prints the computed digest to pin |
| 2 | Pass a wrong `--presentmon-sha256` | Refuses: "not the one this collector was set up against" |
| 3 | `--capture-process-id 999999` | Refuses: no running process has that pid |
| 4 | `--capture-process-name` for something with two instances (e.g. two Explorer or two browser processes) | Refuses, lists both pids, points at `--capture-process-id` |
| 5 | Correct pid + name that disagree | Refuses, names the process the pid really is |
| 6 | Run **without** elevation | PresentMon exits non-zero; error surfaces its stderr plus the Administrator hint |
| 7 | Full run: `--capture-process-id <pid> --capture-seconds 30 --dry-run` | Captures, parses, prints frame count and fps, writes nothing |
| 8 | As 7, then Ctrl-C after ~5s | "was cancelled. Nothing was recorded", temp directory removed |
| 9 | As 7 with `--keep-capture` | Prints "Capture retained at …"; the CSV is still there afterwards |
| 10 | As 7, closing the game mid-capture | PresentMon exits early via `--terminate_on_proc_exit`; either a short capture or a clear "presented no frames" |

What to check on the run that succeeds (#7):

- The header of the retained CSV (`--keep-capture`) contains
  `msBetweenPresents`, `PresentMode` and `msGPUActive`. If any is absent the
  runner will already have refused — confirm the message names the column.
- The reported frame count is consistent with the duration and the average fps,
  the same arithmetic the existing README did for the 90-second Roblox run
  (21,354 frames at 237.31 fps ⇒ 89.98 s).
- The temp directory under `%TEMP%\specsmith-capture-*` is **gone** afterwards
  when `--keep-capture` was not passed.
- No `SpecSmithMeasuredCapture` ETW session is left behind:
  `logman query -ets` should not list it once the collector has exited.

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
- **Automatic capture has never run.** No PresentMon process has been spawned by
  this collector. The flag set is taken from Intel's documented console options
  and the column requirements from the pinned real fixture, but the pairing —
  these flags, on a real PresentMon, producing a file with those columns — is
  reasoned, not observed. Everything around it (process selection, digest
  pinning, timeout, cancellation, cleanup, column verification) is covered by
  mocked tests only. See the smoke test above.

A dry run proves the pipeline runs. It does not prove the pipeline records
correctly, because the recording half never executed.
