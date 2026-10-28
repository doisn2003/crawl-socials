# Search-open eligibility diagnostics + R-SO3 — frozen

28/10/2026 Asia/Bangkok. Code ready for review and one lead diagnostic. Worker LIVE reads0; shared dist/runtime13252/profile/.env/master/README/reviewer files unchanged. This does not identify the cause of LIVE v19; that run lacks per-filter evidence.

## Small instrumentation contract

Existing native action/menu/controller remains unchanged in scope: discovery≤5, one bound click if eligible, one post read, no retry/scroll/new action. Nested `opening` schema is now **2** (operation envelope remains1). `opening.eligibility` is present in both persisted proof and sanitized summary for a received/validated scan:

- Fixed counters for accepted/qualified/empty-record headers, temporal record facts, first rejection at each scope/href/action/header/geometry/viewport stage, pass counts, eligible records and bound/ambiguous/visibility-invalid headers. Counters count records, not unique posts. Header counters≤5; record counters≤2500.
- ≤5 aggregated shapes, each only enum/count fields: record category, scope, rendered/visibleSignal, href kind, action category, viewport, header co-location, first decisive stage and `header_invalidation`. `NOT_CHECKED` means a prior filter stopped the record. No href, text, ID, attribute value, CSS, coordinates or DOM dump.
- `header_invalidation=TARGET_VISIBILITY` plus target_visibility_unknown identifies which potentially actionable record raised sticky header visibility uncertainty. headers_visibility_unknown identifies the resulting boundary-level block. Known invisible versus unknown geometry remain distinct.
- shapes_truncated is informational; all counters continue, shapes stay5 and action guards do not change because metadata reached its cap. Strict validator rejects unknown fields/enums, raw values, oversized/coerced counters/arrays. Stop before scan receipt keeps discovery absent, rather than fabricating zero counters.

Node/time/32KiB output/shared3starts, barriers, stale binding, public/body/identity checks and pending fences remain. Default search/current-post strings retain accepted hashes; instrumentation flag in visibleSignal is emitted only for the new opening variants and never resets the existing visibility state.

## R-SO3 fix with native proof

Already-impossible hrefs/actions/non-co-located records are filtered before side-effectful **target visibility**. An irrelevant group-only link no longer sets c.visibilityUnknown and suppresses a separate valid timestamp. The same href/action/header predicates and all geometry constraints remain; potentially actionable timestamps still fail closed. This is a concrete record-isolation bug, not proof of the LIVE v19 root cause.

- Native group-only link has **18 actual client rects**; it is rejected at HREF with visibility NOT_CHECKED/header_invalidation NONE. Separate valid timestamp gets1click/1read/OPENED_POST_SAMPLE, with zero header visibility invalidation.
- Counterpart actual timestamp has18rects:0click/0read, NO_ELIGIBLE_TIMESTAMP; TARGET_VISIBILITY shape and header_invalidation TARGET_VISIBILITY; target_visibility_unknown1/headers_visibility_unknown1. Rect cap stays8.
- Shape-cap fixture has7records: first5 shapes retained with shapes_truncated true, counters include every first rejection, and the separately valid timestamp still1click/1read.

**PASS:13 focused owner unit tests**, including strict metadata bounds/redaction/coercion negatives and accepted default script hashes. **PASS:9 focused native scenarios**: group-geometry, timestamp-geometry, shape-cap, opaque positive, popup true, author rel, stale replacement, pre-click challenge, pending discovery+Stop. Source network0/windows0/webContents0; shared start cap/pending fence preserved. The46 unchanged search/current-post/verifier regressions were not rerun this instrumentation-only round; their fixed code hashes/contracts are unchanged.

Evidence `p02-search-target-<case>-2026-10-28.json`; manifest `p02-search-target-files-2026-10-28.json`. Reproduce with existing isolated build and smoke `--search-post-open --search-case=group-geometry|timestamp-geometry|shape-cap|obfuscated|popup|rel-author|stale|pre-barrier|stop`.

Next: independent review of bounds/first-rejection attribution and R-SO3 isolation; lead activates and invokes one existing search-open diagnostic. If eligible, at most the one click/read already allowed by ADR-016 may occur; otherwise the new counters/shapes identify the next specific condition to inspect. Candidate/source/hints UNVERIFIED, permission UNKNOWN, benchmark OFF, valid0/gates unchanged. No new telemetry framework, waits, retries, permission or pilot loop.
