# Theme follow-up — September 9, 2026

Product-photo frames now use #13131A in dark mode and #FFFFFF in light mode. Verified both computed values and rendered builder views by switching the actual theme control. Source photographs are unchanged; baked-in backgrounds remain visible. See builder-theme-dark.jpg.

Validation: visualRefresh.test.tsx and retailBuilder.test.tsx, 34/34 passing; git diff --check clean. No production deployment.

FPS placement is already implemented in Claude PR #105, inspected at 16ae3abd5bbdba8f71eab370aea33a46b7c75bd7. RetailBuilder accepts an estimator slot, places it under the desktop build summary, and above the catalogue on narrow layouts. This visual PR does not duplicate or copy that active implementation. That PR still requires its own review before integration.
