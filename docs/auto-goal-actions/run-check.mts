#!/usr/bin/env tsx
// One executor check job (PILOT_HANDOFF_CONTRACT.md §1A.4 change 13). Trusted code from the reviewed
// executor commit E, run with E's own tsx; the proposal is only the tree it runs in.
//
//   tsx docs/auto-goal-actions/run-check.mts --id <check id> --phase before|after --tree <proposal checkout>
//
// The check id is mapped onto the existing trusted registry (checks.ts): `typecheck`, or
// `vitest:src/<path>.test.ts[x]`. runCheck validates it, runs the exact argv without a shell, and
// reports whether the check's file existed. This exits 0 only when the phase's expectation is met:
//   before: the check ran (its file exists) and failed;
//   after:  the check passed.
// It prints only fixed lines, never the check's output, which comes from proposed code.

import { runCheck, type CheckSpec } from "../../artifacts/SpecSmith/scripts/auto-goal/checks.ts";

export function specFor(id: string): CheckSpec | null {
  if (id === "typecheck") return { kind: "typecheck" };
  if (id.startsWith("vitest:")) return { kind: "vitest", file: id.slice("vitest:".length) };
  return null;
}

export function expectationMet(phase: "before" | "after", result: { exitCode: number; executed: boolean; timedOut: boolean }): boolean {
  if (result.timedOut) return false;
  return phase === "before" ? result.executed && result.exitCode !== 0 : result.executed && result.exitCode === 0;
}

async function main(argv: string[]): Promise<number> {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const id = arg("--id"), phase = arg("--phase"), tree = arg("--tree");
  const spec = id ? specFor(id) : null;
  if (!spec || (phase !== "before" && phase !== "after") || !tree) { console.error("Refusing: not a trusted check request."); return 2; }
  let result;
  try { result = await runCheck(tree, spec, 15 * 60_000); } catch { console.error("Refusing: not a trusted check."); return 2; }
  const met = expectationMet(phase, result);
  console.log(met
    ? `Expectation met: the check ${phase === "before" ? "ran and failed, as required before the fix" : "passed"}.`
    : `Expectation not met: the check ${!result.executed ? "could not run (its file is missing)" : result.timedOut ? "timed out" : phase === "before" ? "passed before the fix" : "failed"}.`);
  return met ? 0 : 1;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main(process.argv.slice(2));
