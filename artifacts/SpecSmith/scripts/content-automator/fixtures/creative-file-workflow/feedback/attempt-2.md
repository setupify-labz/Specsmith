# Revision feedback — attempt 2

Status: `awaiting-human-review`

Three generator-authored treatments passed machine checks; no creative score, rendered-media approval or publishing permission is inferred.

## claude-batch-commit-first

Contract eligible: yes

Required:
- Renderer deliverability [promises-absent-element] at beat-5.narration: The Compare page shows a value per build per game and never shows the range around it. A script that tells the viewer to look at the range on this page is pointing at something that is not there. Missing element: the model's estimate range (min–max). Verified: src/pages/Compare.tsx renders bars from single values; FpsGauge (which shows a range) is used only by FpsEstimator. Offending text: "range around"

## claude-batch-three-checks

Contract eligible: yes

No findings.

## claude-batch-vanishing-gap

Contract eligible: yes

Required:
- Renderer deliverability [promises-motion-from-a-still] at beat-1.narration: This promises the picture changes, but the declared capture is a single static frame. Either the copy must stop promising motion, or the concept must declare a capture type that actually moves. Offending text: "Watch what happens"
- Renderer deliverability [promises-absent-element] at beat-1.narration: The Compare page shows a value per build per game and never shows the range around it. A script that tells the viewer to look at the range on this page is pointing at something that is not there. Missing element: the model's estimate range (min–max). Verified: src/pages/Compare.tsx renders bars from single values; FpsGauge (which shows a range) is used only by FpsEstimator. Offending text: "range around"
- Renderer deliverability [promises-motion-from-a-still] at beat-1.onScreenText: This promises the picture changes, but the declared capture is a single static frame. Either the copy must stop promising motion, or the concept must declare a capture type that actually moves. Offending text: "Watch the"
- Renderer deliverability [promises-absent-element] at beat-5.narration: The Compare page shows a value per build per game and never shows the range around it. A script that tells the viewer to look at the range on this page is pointing at something that is not there. Missing element: the model's estimate range (min–max). Verified: src/pages/Compare.tsx renders bars from single values; FpsGauge (which shows a range) is used only by FpsEstimator. Offending text: "range around"

## Next step

Author a revised batch in batches/attempt-3/ addressing every "required" item above.
