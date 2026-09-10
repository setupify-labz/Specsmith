# SpecSmith Engineering Rules

These rules apply to autonomous and interactive work in this repository.

## Product objective

Help a beginner choose a compatible gaming PC for their budget, understand estimated versus verified performance, and find the correct parts to purchase without being misled.

## Sources of truth

1. Security, privacy, legal, affiliate, and data-integrity requirements.
2. Reproducible repository or production evidence.
3. The selected GitHub issue and its acceptance criteria.
4. `SPECSMITH_ROADMAP.md`.
5. Existing tested implementation patterns.

Do not treat an agent summary as proof.

## Work selection

- Work only from an approved, scoped issue.
- Prefer `priority:p0`, then p1, p2, p3.
- Do not start work labeled `blocked`, `awaiting-aaron`, `in-review`, or `do-not-start`.
- Check for an existing branch or PR before starting.
- If one task blocks, document it and continue an independent approved task.
- Do not invent features to remain active.

## Branch and review rules

- Never push directly to `main`.
- Use an isolated branch or worktree.
- Preserve unrelated work and never rewrite shared history.
- Keep changes inside the linked issue's scope.
- Open a PR with exact commands, results, evidence, limitations, and rollback guidance.
- Claude-authored work requires independent Codex review.
- Do not merge without independent approval and repository policy compliance.
- A task is not finished until implementation, verification, review, authorized merge/deploy, and post-deploy checks are complete.

## Data integrity

- Never fabricate benchmark, FPS, price, availability, product, analytics, review, conversion, publication, or user data.
- Keep estimates and verified measurements separate in storage, logic, and presentation.
- Preserve provenance for measured results: source, URL, hardware, settings, resolution, game/version or capture date when available.
- Prefer no match over an ambiguous CPU, GPU, game, or retailer-product match.
- Never present estimated or stale pricing as live.
- Never advance a lifecycle ledger to a state that did not occur.
- Test/demo runs must use isolated temporary stores and must never delete or mutate durable production ledgers.
- Fixture outputs must be explicitly labeled and must not pass production publishing gates.
- Quality and rights approvals must be tied to the exact final media SHA-256; never reuse hard-coded observations for newly rendered bytes.

## Retail and affiliate integrity

- Match exact variants using manufacturer identifiers when possible.
- Preserve retailer, timestamp, availability, variant, and attribution.
- Do not expose retailer/API secrets to the client, logs, fixtures, screenshots, or commits.
- Reject suspicious or ambiguous listings rather than guessing.

## User-facing quality

For applicable changes, verify:

- Success, loading, empty, failure, and recovery states.
- Representative desktop and mobile layouts.
- Keyboard navigation, semantic HTML, focus, contrast, labels, and reduced motion.
- Canonicals, sitemap, robots, metadata, internal links, and prerendered content.
- Performance impact, asset size, layout shift, and unnecessary client work.
- Estimated data is labeled whenever visible, not only later in a flow.

## Testing

- Reproduce a defect before editing when possible.
- Add tests that would have caught it.
- Run targeted tests, typecheck, production build, and the strongest relevant broader suite.
- Do not delete or weaken valid tests to pass CI.
- Distinguish verified pre-existing failures from regressions.
- Large integrations require reproducible CI evidence or an explicitly approved equivalent; local claims alone are insufficient.

## Decisions requiring Aaron

Pause only affected work for spending, credentials, destructive actions, material product choices, legal/policy judgment, public publishing approval, or unverifiable claims. Ask one focused question, label the task `awaiting-aaron`, and continue unrelated work.
