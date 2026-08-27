# RDR2 benchmark segmentation from PresentMon: what three runs established

**Status: research. Nothing here is a measurement path, and nothing here is
publishable benchmark data.** Branch `claude/rdr2-segmentation-research-v1`.

The question was whether RDR2's five built-in benchmark scenes can be
isolated **reproducibly from PresentMon data alone**. The answer, after three
real Windows captures, is **partly**: the four inter-scene transitions are
solved and reproduce tightly. The final gameplay/results boundary is **not**
solved, and the two acceptance routes and the candidate ranking built for it
should now be treated as **unvalidated research**.

## The captures

| run | length | outcome | RDR2 displayed avg |
| --- | --- | --- | --- |
| 1 | ~300s | truncated mid-scene-5; correctly `unresolved` | 69.6925 |
| 2 | 419.9s | complete, results screen confirmed | 68.0624 |
| 3 | 419.93s | complete, results screen confirmed | 68.0902 |

Runs 2 and 3 are the two complete runs and are the basis for everything below.

## Established: the transitions reproduce

Both complete runs were segmented with no knowledge of each other. Comparing
transition **onsets** relative to each run's own gameplay start:

| | run 2 onset | run 3 onset | spread | run 2 duration | run 3 duration | spread |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | +25.05s | +24.92s | **0.13s** | 4.88s | 4.81s | 0.07s |
| T2 | +54.89s | +54.71s | **0.18s** | 5.08s | 4.60s | 0.48s |
| T3 | +85.41s | +84.30s | **1.11s** | 9.67s | 9.04s | 0.63s |
| T4 | +120.28s | +120.04s | **0.24s** | 13.51s | 9.56s | 3.95s |

Run 3's gameplay started at 87.15s against run 2's ~37.94s — a 49-second
difference in absolute time, and the onsets still land within 1.11s of each
other. That is the reproducibility claim this work set out to test, and for
the transitions it holds.

What carries it: the GPU **utilisation ratio** (`msGPUActive / frameTimeMs`),
a dimensionless quantity that separates RDR2's black transition screens —
presented at the engine's internal cap with near-zero GPU work — from
GPU-bound gameplay at the same frame rate. The idle/busy cut is read from
each capture's own bimodal histogram, and the sustained-block floor scales
with each capture's own median rendered frame, so nothing in the rule carries
an absolute time or frame rate.

**One qualification.** Transition *onsets* reproduce; transition *durations*
do not, and T4's varies by 3.95s. Scene 5's start is the end of T4, so while
it is located confidently *within* each run, its position **relative to
gameplay start** differs by 4.19s between the two runs (+133.79s vs
+129.60s). Scene-5 start is reliable as a within-run boundary and should not
be quoted as a reproducible offset without that caveat.

## Not established: the final boundary

Two acceptance routes were built and each was falsified by the next real run.

1. **Trailing GPU-idle block.** Falsified by run 2: RDR2's results screen is
   GPU-busy, and the analyzer wrongly reported the benchmark never finished
   while a screenshot showed it had.
2. **Stationarity** — the results screen holds still while gameplay drifts.
   Falsified by run 2 as well: every possible suffix was rejected. Real
   margins were not close.
3. **Distribution change** — the results screen is internally consistent and
   unlike everything the benchmark already showed. Also fails on run 2.

Run 2's real margins, all three failing substantially:

| measure | run 2 value | required |
| --- | --- | --- |
| stationarity | 0.0261 | < 0.0033 |
| distinctness | 0.1484 | > 0.3359 |
| self-agreement | 0.1406 | < 0.0762 |

### The ranking is falsified too

Run 2's top-ranked candidates clustered at 328.8s, 326.3s and 327.6s, which
independently matched a separately-observed stable-results neighbourhood
around 326s. That looked like the ranking pointing at the right place even
though it could not clear its own bars.

Run 3 settles it: its top-ranked candidate was **216.76s, which is scene 5's
start** — the first window of the final busy block, and unambiguously not the
results screen. The ranking is not reproducible. With n=2 and one hit and one
miss, run 2's apparent agreement is best read as coincidence.

### Why, most likely

Offered as a diagnosis to be tested against future data with ground truth,
**not** as something to go fix against these same captures.

In both complete runs the operator left the results screen up for a long
time, so the final busy block is mostly results screen: 203s of block after a
scene 5 of roughly 30s in run 3, 248s in run 2. Every measure the ranking
uses is an aggregate over the candidate suffix, so a suffix that wrongly
includes scene 5 is still ~85% results screen and barely penalised for it.
The preference for the earliest qualifying start — chosen because the longest
suffix is the most that can honestly be claimed — then pushes the ranking
toward exactly the wrong end. A discriminator whose sensitivity depends on
how long the operator happened to sit on the results screen is not a
discriminator.

## Conclusion

**PresentMon data alone has not been shown sufficient to locate RDR2's final
gameplay/results boundary.** Three signals were tried — GPU load,
stationarity of level, and distributional change — and each was falsified by
the next real capture. The ranking that survived the acceptance failures has
now been falsified as well.

This is a negative result about a specific boundary, not about the approach:
the transition detection built on the same signal reproduces to within about
a second across runs that differ by 49 seconds in when they started.

Two more captures would not settle it. There is currently **no ground truth**
against which any fourth discriminator could be validated, so inventing one
from these captures would only be fitting to two samples. The operator marker
added on this branch supplies ground truth for one run at a time, by hand;
what is missing is a way to get it automatically, on every run.

## Recommendation: recognise the screen, don't infer it

The smallest reliable design is to stop inferring the boundary from frame
timings and **observe it directly**. RDR2's results screen carries a fixed
"End of benchmark" title in a fixed layout — recognising a known string in a
known place is a far easier and far more testable problem than inferring a
regime change from frame-time statistics, and it does not depend on how long
anyone sat on the screen.

Sketch, deliberately minimal — **not implemented, and not to be implemented
until the validation step below is agreed**:

- **Sample slowly.** A low-rate grab (order 2 Hz) of the game window during
  capture, each sample stamped with the *same monotonic counter* the operator
  marker already uses, so it lands on the same capture timeline.
- **Crop, don't keep frames.** Match only the title region. Retain the crop,
  not the full frame, and discard even that once the timestamp is derived
  unless explicitly asked to keep it.
- **Report an interval, not a frame.** The boundary is bounded by the last
  negative sample and the first positive one. That interval is the honest
  answer, exactly as the marker's two anchorings already produce one.
- **A distinct evidence kind.** Emit a *different* `kind` from the operator
  marker (`rdr2-results-visual-marker`, say) rather than flipping
  `automaticDetection` on the existing schema — the current reader refuses a
  file claiming automatic detection, and that refusal should keep working so
  human-confirmed and machine-detected evidence never get mistaken for each
  other.
- **Validate before trusting.** Run visual detection *alongside* the operator
  marker for several runs and publish the agreement. Only once it agrees
  within the alignment uncertainty across multiple runs does it become the
  boundary source. Until then it is a second opinion, ranked next to the
  PresentMon candidates and nothing more.
- **Measure the perturbation.** Any capture that touches the GPU can move the
  numbers being measured. Run with and without it and report the difference
  before it is used for anything.

### Privacy defaults, non-negotiable

- **Off by default.** Nothing is captured unless the operator opts in per run.
- **Local only.** Images are written to a local directory **outside** the
  research bundle, so the atomic bundle publisher cannot pick them up.
- **Excluded from uploads by default.** The observation and upload paths must
  carry an explicit deny for image artefacts, tested the way the settings-path
  and dry-run gates are tested — a regression test that fails if an image ever
  reaches a bundle or an observation.
- **Only the derived timestamp travels.** What may ever leave the machine is
  the interval and a boolean, never a frame or a crop.

## What was NOT done here

- No acceptance bar was loosened, retuned, or otherwise moved.
- No fourth discriminator was added. There is no ground truth to validate one
  against, and these two captures are not enough to invent one from.
- No ranking winner was converted into a candidate result. Runs 2 and 3 both
  remain `unresolved`, exit code 2.
- Nothing was merged and no pull request was opened.

## What stays, and how it is labelled

The transition detection, the integrity checks, the fail-closed behaviour and
the operator marker stand. The final-boundary acceptance routes, the ranking
and the tail diagnostic stay in the tree — the diagnostic is how run 3's
failure was diagnosed at all — but are now labelled **UNVALIDATED RESEARCH**
in the code, in the README and in the analyzer's own output, so no reader can
mistake a ranked candidate for a finding.
