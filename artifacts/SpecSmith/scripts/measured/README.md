# V1 measured-observation collector

Produces **one** real SpecSmith observation from **one** controlled run on
Windows. Deliberately absent, not unfinished: community submission, accounts,
UI, scheduling, and any multi-game benchmark library.

## Requirements

- **Windows.** The collector refuses to run anywhere else rather than
  assembling a record whose hardware fields describe nothing.
- **PresentMon** ([Intel](https://game.intel.com/us/stories/intel-presentmon/)),
  the established Windows frame-capture tool. PresentMon 2.x must be run with
  `--v1_metrics` so it emits the `MsBetweenPresents` column.

## Usage

```
# 1. Capture a run with PresentMon while playing the game.
PresentMon.exe --process_name YourGame.exe --v1_metrics --output_file run.csv

# 2. Write down the settings you used, verbatim.
notepad settings.txt

# 3. Assemble, validate, save.
pnpm collect:measured -- \
  --csv run.csv --process YourGame.exe \
  --game-id <catalog id> --gpu-id <catalog id> --cpu-id <catalog id> \
  --resolution 1440p --preset high \
  --ram-channels 2 --settings-file settings.txt \
  [--gpu-name "NVIDIA GeForce RTX 4070"] \
  [--game-exe "C:\path\YourGame.exe"] [--upscaler dlss --upscaler-mode quality] \
  [--ray-tracing] [--frame-generation --frame-generation-factor 2] \
  [--render-scale 100] [--gpu-overclocked] [--dry-run]
```

`--dry-run` validates and prints without writing anything.

## What it reuses rather than reimplements

| Concern | Owned by |
|---|---|
| FPS / 1% low / 0.1% low | `src/lib/measured/frameTimes.ts` |
| Validation rules and severity | `src/lib/measured/validate.ts` |
| Record shape | `src/lib/measured/types.ts` |
| Frame-time blob storage | `scripts/measured/frameTimeStore.mjs` |

The collector computes no statistic and enforces no rule of its own. A second
implementation of any of those would be a second definition of what SpecSmith
means by a measurement.

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

**Dropped frames are excluded** and counted.

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

## What remains unverified

**No real run has been performed.** Everything below has been exercised only
against synthetic fixtures on Linux:

- **The Windows probe has never executed.** `detectWindowsEnvironment` shells
  out to PowerShell/CIM and has been tested only for its refusal path off
  Windows. The exact shape of its output, and whether every field is populated
  on real hardware, is unconfirmed.
- **No real PresentMon CSV has been parsed.** The parser is tested against
  hand-written fixtures matching PresentMon 1.x's documented columns. A real
  capture may carry columns, ordering, or quoting these fixtures do not model.
- **Cap detection, the 60s/3,000-frame minimums, and the plausibility bounds**
  have still never met a real capture.
- **`--game-exe` version detection** is untested against a real executable. The
  path is now passed through an environment variable rather than interpolated
  into the PowerShell command, so the escaping defect is fixed, but no real
  executable has been read.
- **Adapter selection has never seen a real multi-GPU machine.** The exclusion
  list of virtual display devices is reasoned from common device names, not
  from observed output.
- The CLI has been run end-to-end on Linux only as far as the platform gate:
  it parses a 9,000-row fixture correctly, then refuses to fabricate hardware.

The first real Windows run is what turns all of the above from "written" into
"verified", and it should be treated as a test of this collector, not as a
finished data point.
