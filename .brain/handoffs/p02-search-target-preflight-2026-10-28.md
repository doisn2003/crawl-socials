# HREF-qualified target preflight — frozen for review

28/10/2026 Asia/Bangkok. Worker LIVE/source reads0. Shared dist/runtime/profile/.env/master/README/reviewer files untouched. No target policy or BrowserHost popup policy change.

## Observed problem and contract

Lead's [LIVE v21](../evidence/p02-live-search-fragment-v21-2026-10-28.json) reached2 placeholders after the fragment patch, then rejected both at NEW_WINDOW. Their actual target categories and later guard facts remain unknown. This change supplies those facts; it does not infer `_blank` or permit it.

Nested opening schema is now **3**, operation envelope remains1, base search schema13/current-post schema14 unchanged. Each existing bounded eligibility shape now also has target_kind plus read-only preflight enums. Only records accepted by the HREF classifier are queued for preflight. Earlier records retain NOT_CHECKED fields.

- target_kind: ABSENT, EMPTY, SELF, BLANK, TOP, PARENT, NAMED, INVALID. Reserved keywords are categorized case-insensitively for diagnostics; eligibility still uses the original exact raw target guard. NAMED means1–160 characters in the bounded ASCII name shape; other/oversized values are INVALID. Neither raw name nor length is emitted. NOT_CHECKED is used before HREF qualification or if its read could not run.
- preflight: COMPLETE/INCOMPLETE/NOT_CHECKED. Independent PASS/FAIL/NOT_CHECKED facts cover control, role, download, disabled, popup, author, media and action label. Header co-location and first blocking ancestor category are separate facts. Rendered is YES/NO/NOT_CHECKED; visibility is PASS/FAIL/UNKNOWN/NOT_CHECKED; viewport is PASS/FAIL/RECT_LIMIT/INVALID_GEOMETRY/NOT_CHECKED. Facts describe only the fixed predicates, not permission or identity verification.
- Original first decisive stage, rejection counters, eligible records, descriptors and binding remain authoritative. Preflight facts cannot override them or grant a binding. Shape aggregation includes the additional facts; output still retains at most5 shapes with informational shapes_truncated. Strict validator rejects unknown fields/enums, raw/coerced data and existing size/counter violations.

## Isolation and budgets

The existing scan completes its eligibility decisions before preflight runs. Private work items contain the already observed target/record/header/public references. Preflight reads only the known header and clip frames, the target's DOM attributes/layout/rects and shared remaining budget. It never calls visibleSignal/textClip, writes c, updates clipFrames/layout diagnostics, changes DOM/attributes, normalizes the bound href, selects a target or dispatches an action. Missing clip frames remain NOT_CHECKED/INCOMPLETE; unknown geometry is a reported UNKNOWN fact, not a state mutation.

Every extra operation, header ancestor and inspected rect uses the same remaining2500-step counter and original1s deadline. There is no reset or second allowance. On exhaustion, the current/remaining preflight items stay INCOMPLETE with uncomputed fields NOT_CHECKED. Existing scan nodeLimit/timeLimit flags retain the original scan result; telemetry exhaustion cannot reinterpret a completed eligibility decision. The total visited count never exceeds2500. Private work is bounded by the original record/step caps; persisted output remains32KiB and≤5 shapes. Existing4s main scan/Stop/pending fences,3starts, stale/raw href, one-click/one-read and native popup deny remain.

## Verification

Isolated build PASS; **16 focused owner unit tests PASS**. The suite covers target categories (including prototype-like names), schema bounds/redaction/coercion, shared node/time exhaustion and missing-cache facts, plus existing lifecycle/Stop/navigation tests. Accepted base search/current-post hashes are unchanged. The46 unchanged search/current-post/verifier regressions were not rerun this round.

**14 native scenarios PASS**, each with a read-only DISCOVER projection compared against the fixed v21 script before the normal action. Status, original scan limit flags, all first-rejection/eligibility counters, qualified/empty/ambiguous headers and target descriptors are equal; visited counts may increase. The captured v21 discovery fixture is hash-pinned to `bcbb45e85ce60432c6d7d3eb3702e885151c14718d470b3f631ef2b2dd3ccb5d`.

- Absent (existing fragment), EMPTY, SELF remain1click/1post read. BLANK, TOP, PARENT, NAMED and INVALID remain NEW_WINDOW with0click/0read. All8 requested target categories have native coverage.
- BLANK with popup+author+media+action-label reports all four FAIL and BLOCKED_ANCESTOR while first stage remains NEW_WINDOW,0actions. A separate BLANK off viewport reports visibility PASS/viewport FAIL,0actions.
- BLANK with18 actual client rects beside a valid timestamp reports UNKNOWN/RECT_LIMIT; original target/header visibility invalidations stay0 and the valid timestamp still1click/1read. This explicitly checks R-SO3 cannot recur through preflight.
- Existing changed-fragment stale, pending Stop and7record/5shape cap scenarios retain their original outcomes. Shape cap truncates metadata without suppressing the valid action.

All native reports have source/external requests0, windows0/webContents0 after close, exact original href at any click handler and one initial placeholder document request (no placeholder reload). Native equivalence compares the read-only discovery projection; baseline itself never dispatches a click. No LIVE behavior or real target category is claimed.

Evidence: `p02-search-target-preflight-{fragment,empty,self,blank,top,parent,named,invalid,facts,isolation,viewport,fragment-stale,stop,shape-cap}-2026-10-28.json`. Manifest: `p02-search-target-preflight-files-2026-10-28.json`. Build helper copies the fixed synthetic v21 script fixture into the isolated resources. Reproduce with the existing build helper, focused owner test and native smoke `--search-post-open --search-case=preflight-<case>` (or fragment/fragment-stale/stop/shape-cap).

Next: independent review and one lead diagnostic through the existing action. Use observed target/preflight facts for any next change. Permission UNKNOWN, benchmark OFF, valid0, source/candidate/identity UNVERIFIED; no new click/scroll/retry/pilot or gate change.
