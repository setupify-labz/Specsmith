# MASTER #2 independent audit findings

## P1 — unsupported/disputed claims can bypass the evidence gate by adding a generic hedge

`checkScriptAgainstResearch()` currently suppresses a hard failure for any matched unsafe or disputed claim whenever the line contains one of the generic hedge words in `HEDGED` (`may`, `might`, `could`, `around`, `about`, etc.).

That contradicts the contract itself: `UnsafeClaim` is documented as a claim the Creative Director **may not state**, and disputed claims must be presented as disputed if mentioned. A word such as `may` communicates uncertainty but does not supply missing evidence or disclose that sources conflict.

Examples that currently bypass the gate:

- unsupported: `Widget-9000 may outrun Widget-8000 by 40 percent`
- disputed: `Widget-9000 may outrun Widget-8000 by 40 percent`

The new `creativeContract.audit.test.ts` contains adversarial expectations for both cases. The audit test is intentionally expected to fail on Claude's MASTER #2 implementation until the gate is repaired.

### Required repair

1. Unsafe factual claims must remain blocked merely because a generic hedge was added. If the system later supports explicitly framed hypotheses, that needs a separate typed hypothesis/creative contract path rather than a regex escape hatch.
2. Disputed claims may only be mentioned through an explicit dispute-reporting path that communicates the conflict; generic uncertainty words are insufficient.
3. Remove/update the existing test that explicitly expects `may` to make an unsupported claim acceptable.
4. Add negative controls proving removal of these guards fails tests.
5. Re-run exact-head typecheck, focused research tests, full suite, production build/prerender, and pipeline CI.
