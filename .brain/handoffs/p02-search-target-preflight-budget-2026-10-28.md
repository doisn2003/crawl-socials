# R-PF1 — preflight hard budget guard, frozen

28/10/2026 Asia/Bangkok. Supersedes [the initial preflight freeze](p02-search-target-preflight-2026-10-28.md), specifically its claim that telemetry exhaustion could retain the original action outcome. That claim was incorrect: the hard shared budget must prohibit a new binding/click even if original eligibility was established before preflight. Worker LIVE/source reads0; shared runtime/dist/profile/master/reviewer files untouched.

## Fix

The old preflightSpend caught exhaustion without setting the original scan budget flags. FINISH could therefore proceed to CLICK_DISPATCHED after the1s deadline. Reviewer reproduced this with the complete DISCOVER→CLICK scripts, advancing the clock on the second target read (preflight).

`openBudgetExhausted` now marks nodeLimit/timeLimit against the same2500-step cap and original1s deadline. Preflight uses it, and FINISH checks it again **after facts aggregation**, before publishing a discovery binding and immediately before native click dispatch. A discovery observer is disconnected and no binding is published if its setup crosses the deadline. Exhaustion returns SCAN_INCOMPLETE with0confirmed clicks; no main read follows.

Original first decisive stages/counters, eligible records and target descriptors remain available as diagnostic history. Partial facts stay INCOMPLETE/NOT_CHECKED; facts never grant an action. Equivalence with v21 applies when budget remains. Target kinds, target/fragment policy, semantic/header/geometry guards and BrowserHost popup deny remain unchanged. No schema change: opening3, operation1. Default search/current-post script hashes are unchanged.

## Verification

Isolated build PASS. **17 focused owner tests PASS**, including node/time exhaustion in DISCOVER and CLICK plus final-boundary expiry; they assert0native clicks, unchanged recorded eligibility and limit flags. Existing read-only/cache/redaction/lifecycle tests also pass.

**Both frozen reviewer full-script hard-budget repros PASS** against current owner compiled modules, read/copied without changing reviewer files: deadline reached during preflight prevents click, and telemetry consuming the2500th step prevents click. The copied test snapshot SHA is recorded in the manifest. These are owner reruns of the reviewer snapshot, not a new independent review sign-off.

**7 native scenarios PASS**:

- Full fixed DISCOVER and CLICK each advance a fixture-only clock from0to1000ms on the second target read. Both preserve an ELIGIBLE stage/counter yet return SCAN_INCOMPLETE with0click/0read and timeLimit true. DISCOVER publishes no usable binding; CLICK consumes its old binding without dispatch.
- Fragment positive and unknown-geometry BLANK beside a valid timestamp retain1click/1read with sufficient budget. The latter retains zero candidate/header visibility invalidations.
- BLANK with popup/author/media/action facts stays NEW_WINDOW,0actions. Changed-fragment stale and pending Stop retain zero actions.

All native reports have external/source requests0, windows0/webContents0 after close and one initial search request (no placeholder reload). Initial unexhausted discovery projections still match the frozen v21 baseline. Full-script cap exhaustion is covered by the frozen reviewer VM repro and owner hook boundary tests. The46 unchanged search/current-post/verifier tests and9 earlier native categories/cap scenarios were not rerun in this narrow budget correction.

Evidence: `p02-search-target-preflight-budget-{time-discovery,time-click,fragment,isolation,facts,fragment-stale,stop}-2026-10-28.json`. Manifest: `p02-search-target-preflight-budget-files-2026-10-28.json`. Native new cases use the existing smoke `--search-post-open --search-case=preflight-time-discovery|preflight-time-click`; clock/getAttribute wrappers exist only in the synthetic fixture and restore native properties afterward.

Ready for reviewer rerun and lead activation. No LIVE success/target category claimed. Permission UNKNOWN, benchmark OFF, valid0; no source or gate change.
