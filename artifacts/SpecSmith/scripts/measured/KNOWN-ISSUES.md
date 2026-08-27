# Known issues in the measured-benchmark collector

Findings that are **diagnosed but deliberately not fixed**, because the fix is
a policy decision rather than a mechanical correction. Each entry records the
reproduction so the next person does not have to rediscover it.

---

## 1. A single Ctrl+C can be counted as two, abandoning the PresentMon wait

**Status:** diagnosed, not fixed. Needs a decision on the de-duplication
policy before anything changes.
**Severity:** degrades gracefully, but defeats a guard that exists on purpose.
**Surfaced by:** `scripts/measured/cancellation.test.ts` — "waits for the
collector to finish before the pnpm wrapper exits, run via `pnpm run
<script>`". That test is **intermittently failing, and it is right to fail**.
It is detecting the defect below. Do not relax it.

### What happens

`cancellation.ts` treats the first cancel-class signal as "cancel, and wait
for PresentMon to close its trace session", and a second as "the operator is
impatient, give up waiting":

```
DEFAULT_CANCEL_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGBREAK']   // all share one counter
```

Under CPU contention the collector can receive **two SIGINTs from one Ctrl+C**,
roughly 30ms apart. The second trips the "asked twice" branch, so the
collector prints

> Second interrupt — abandoning the wait. PresentMon may still be running…

and stops waiting — the exact outcome the linger logic exists to prevent. A
stale ETW trace session can be left behind. It is not silent, and a later
capture clears a stale session with `--stop_existing_session`, so the blast
radius is small; but the wait was deliberate and it is being skipped.

### Where the duplicate comes from

Measured, not assumed. A child that logs every cancel-class signal it
receives, launched through `pnpm run` and signalled with one group-wide
`SIGINT`, under saturated CPU:

| child launched via | runs with a duplicate SIGINT |
| --- | --- |
| `node child.mjs` | 0 of 8 |
| `tsx child.ts` | 2 of 8 (second arrived +35ms, +32ms) |

`tsx` runs the program in a child process and **also forwards** the signal to
it, while the group-wide signal already reached it directly. On an idle
machine the collector finishes its linger before the forwarded copy lands, so
nothing trips; under load the forwarded copy wins the race.

Observed failure rate of the test itself: ~1 in 8 runs of the file, ~1 in 20
harness invocations under saturated CPU, and 0 in 20 on an idle machine.

### Reproduction

```
# from the repo root, with the CPU saturated
node_modules/.bin/vitest run scripts/measured/cancellation.test.ts
```

The failure is `expected -1 to be greater than <n>` — `CHILD_EXIT_CONFIRMED`
never reaches stdout because the collector abandoned the wait. Confirmed it is
**not** an unflushed-pipe artefact: instrumenting both `exit` and `close`
showed 0 bytes arriving after `exit` in 40 invocations, and the token absent
at `close` too.

### Why it is not fixed here

The obvious fix is to ignore a second cancel-class signal arriving within some
window of the first, treating it as duplicate delivery rather than a second
request. **That window is a product decision**: too long and a genuinely
impatient operator's second Ctrl+C is swallowed, which is the escape hatch
people reach for when PresentMon hangs; too short and the race survives. It
also changes cancellation semantics during a live capture, which is exactly
the kind of change that should be reviewed rather than chosen unilaterally.

### Not verified

Reproduced on **Linux**, using process-group signal delivery. Windows
delivers Ctrl+C as a console control event to every attached process, and
whether `tsx` produces the same duplicate there has **not** been tested — no
Windows machine was available. The collector's real deployment target is
Windows, so confirm there before choosing a fix.
