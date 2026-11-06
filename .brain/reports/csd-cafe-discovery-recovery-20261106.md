# A–CONSISTENT discovery recovery — 2026-11-06

Status: COMPLETED. The final export contains 1,000 unique accepted roots. The USD 10 envelope is closed.

## Final result

| Measure | Result |
|---|---:|
| Raw unique roots | 2,143 |
| Retained raw from previous A | 470 |
| Newly collected raw | 1,673 |
| Model accepted, all results | 1,113 |
| Rejected | 979 |
| Pending | 51 |
| Customer export | **1,000** |
| Export from retained / newly collected roots | 295 / 705 |
| Export Facebook / Threads | 273 / 727 |
| Duplicate roots / duplicate permalinks / missing links | 0 / 0 / 0 |
| Comments collected or exported | 0 |
| Final query inventory | 70, across 19 families and four lexical styles |
| Task calls, all launches and planning preflight included | 303 |
| Task measured cost | **USD 0.602978007 / USD 10** |
| Held or unmetered cost at closure | 0 |

The run reached its target around 14:14:45 UTC and finished draining/exporting at 14:15:55 UTC (21:15:55 Vietnam time). The successful final collection segment resumed at 14:07:58 UTC. This is a resumed run with retained raw and assessments, not a cold-start timing benchmark. All repair pauses and planning attempts remain included in the task's accounting. Cumulative DEVELOPMENT closed at 1,771 calls / USD 2.545302042; unused allowance is not another grant.

The workbook was reopened and checked against the immutable result selection: exactly 1,000 current, non-stale, assessed SUITABLE root rows, no duplicates, no missing links, zero Comments rows. All 470 retained raw roots remain available. Evidence: `verification.json`, `closed-spending.json`, `results.json` and `A-CONSISTENT.xlsx` in the task artifact directory. The executable verification is `scripts/benchmark/verify-cafe-recovery.mjs`.

Of the 35 original pending records, 24 were resolved: two accepted and 22 rejected. Eleven remain technical-pending after their existing attempt ceiling. The final 51 pending comprise 27 language-unverified, 22 missing evidence, one invalid evidence format and one incomplete evidence assessment. They are excluded from the delivery; no missing citation was invented to reach the target.

## Scope and accounting

User authorized changes on `production-v2` and a multi-hour retest targeting 1,000 accepted unique root posts. The new envelope is USD 10 inclusive of planning, expansion, filtering, repairs and failed attempts. Model: Gemini 3.1 Flash-Lite only. Operational ceiling: 4,000 new calls. The cumulative DEVELOPMENT ledger begins this task at 1,468 calls / USD 1.942324035 measured / zero held; neither resuming nor correcting the runner resets it.

Prompt: `Tìm nhu cầu tìm quán cafe chill; chia sẻ trải nghiệm đi cafe chill; thảo luận về quán cafe chill.`

Acceptance criteria are pinned to the previous A campaign for a like-for-like retrieval comparison. Vietnamese content, no age limit, geography preference only, POST_ONLY, no comments. Advertising and unrelated material remain exclusions. The target is model-accepted roots; this is distinct from independently measured usefulness precision.

Exactly 470 raw roots from the prior A test are retained, with matching assessment caches. No posts from the historical 1,000-post cafe workbook are imported. New collection and retained data are reported separately. Runtime caps: 20,000 raw roots and 720 minutes. Existing authorized sessions, isolated run data, one BrowserHost writer. The previous five-case E2E and its email heartbeat remain closed/paused.

## Implemented before the first live checkpoint

- Durable per-item assessment attempts and small repair batches preserve successful siblings and do not repeat whole failed batches. Language recognition covers the two verified Vietnamese colloquial cases.
- Completed technical-pending jobs can be requeued once, without resetting assessment attempt histories. Genuine missing context and factual conflicts remain pending.
- Per-query NO_PROGRESS gets two bounded cooldown recoveries; replay and warm productive windows have separate handling. Diagnostics distinguish missing pagination requests, missing response capture, unsupported responses and duplicate roots.
- Target-driven query expansion is connected to accepted/raw/pending counts and query yield, with shared durable attempt accounting and query lineage.
- The authorized runner consumes the existing grant, preserves all costs across restarts, exports unique roots, and stores periodic snapshots.

Source checkpoints: `27461fb`, `d85f8ea`, `e449c82`, `7e4ccad`, `87a061a`.

Offline integration before launch: `npm run check` passed; 1,089/1,089 tests passed; production-v2 UI smoke passed with zero external network attempts, zero model calls and zero renderer errors.

## First live checkpoint and defects discovered

Started 2026-11-06 13:34:31 UTC. Maintenance pause completed at 13:38:01 UTC, preserving the same run and ledger:

| Measure | Value |
|---|---:|
| Raw unique roots | 666 |
| Retained from prior A | 470 |
| Newly discovered | 196 |
| Model accepted | 401 |
| Rejected | 223 |
| Pending | 42 |
| New calls | 97 |
| Task measured USD | 0.096713251 |
| Held USD | 0 |

The planner received the real target and breadth settings (preferred 96, minimum 48, initial 48), but returned only eight queries, supplemented to thirteen by the validator. Its first adaptive wave returned ten instead of forty, all repeating the same literal anchor. Request-hash reconciliation confirms this was the current prompt, not stale cache. Merely including a desired count in the prompt did not enforce breadth completion.

Across 45 recorded native batches, all came from embedded initial-document JSON; none were search-post batches from browser responses. Facebook indicated another page but stopped after roughly five initial posts per query. Captured operations were mostly search suggestions, users and trends, so `unsupported_responses` did not establish a post-parser defect. The hidden-window rendering/pagination path requires a native fixture and a live confirmation before attributing causality.

At the earlier 13:36:44 snapshot, all 470 retained assessment keys matched. Of 35 old pending records, two were accepted, twenty-two were rejected after assessment, and eleven still had technical failures. Successful old primary caches remained reusable; gateway `cache_hits` is a different metric and must not be mistaken for assessment-cache reuse.

## Evidence locations

- Task artifacts: `artifacts/cafe-consistent-recovery-20261106` (ignored, outside commits).
- Live run data: `%APPDATA%/csd-e2e-tests/cafe-consistent-recovery-20261106`.
- Task ID / spending purpose: `cafe-consistent-recovery-20261106`.
- Run ID: `crawl-b8d4fb55-ae43-4512-8995-0c835f386f8d`.
- Token price basis: official [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing): input USD 0.25 / output USD 1.50 / cached input USD 0.025 per million tokens. Measured cost is token usage at the saved price snapshot, not an invoice.

## Native rendering reproduction

The zero-network Electron 44.10.0 fixture reproduced the missing pagination trigger. With the existing hidden `BaseWindow` + `WebContentsView` and `backgroundThrottling: false`, scrolling changed `scrollTop` from 0 to 1,302, but produced zero animation frames, zero IntersectionObserver callbacks and zero scroll events. Only five initial posts remained. `document.visibilityState` reported `visible`, so that signal alone was misleading.

With offscreen rendering and a bounded 15 FPS on the same hidden view, three scrolls produced 39 animation frames, seven IntersectionObserver callbacks and twenty posts across four fixture pages. All native windows remained hidden; external network attempts were zero. Capturing the hidden page did not repair the original path because no display surface was available. Evidence: `artifacts/hidden-pagination-probe/result.json` and `scripts/benchmark/hidden-pagination-probe.mjs`. This confirms the local rendering defect; resumed social collection must separately confirm real pagination.

The historical successful piano runner explicitly called `showInactive()` on collection windows. The R10 hidden-window change removed that rendering condition. The fix retains the user's hidden-window requirement and uses Electron's supported [offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering).

## Real pagination confirmation and planning repair

During the next live segment (13:59:20–14:01:01 UTC), the same campaign gained 285 unique roots, from 666 to 951. Of those, 272 first appeared in real pagination responses. Facebook produced 35 post batches through `SearchCometResultsPaginatedResultsQuery`; Threads produced 20 through `BarcelonaSearchResultsRefetchableQuery`. Neither platform recorded NO_PROGRESS in that segment. This directly confirms the rendering fix restored deeper collection on both sources. Evidence: `pagination-evidence-after-render-fix.json` in the task artifacts.

The first strict breadth schema was rejected with HTTP 400, at zero measured cost but one charged call in the cumulative call ledger. Its exact provider message was not retained, so schema complexity is a hypothesis, not a recorded diagnosis. Collection continued independently while AI paused, preserving 951 roots. The revised schema reduced its size from 35,367 to 2,675 bytes and removed 96 `anyOf` branches: 48 required scalar query slots share a single metadata-array schema. Local grounding, family, lexical and deduplication checks remain mandatory.

A planning-only preflight then succeeded on the same campaign and ledger. Two calls produced 47 additional validated queries (42 in the first response, five more in the repair), giving 70 total. All eight coverage groups were covered, with actual synonym, abbreviation, colloquial and context variants. Examples include `quán cf chill`, `quán cà phê không gian xanh` and `nơi trốn deadline cuối tuần`. These are retrieval hypotheses; acceptance criteria are unchanged. At 14:06:48 UTC: 102 task calls, USD 0.116587001 measured, zero held.

Source fixes after the first checkpoint: `cf39810` (required scalar citation in the model wire format), `0141730` (offscreen rendering), `81ba1e4` (versioned recovery and coverage preflight), `0107bdc` / `b877d25` (durable breadth and compact schema), `2b797d6` / `355df78` (honest terminal reason), `dcf3770` (pipeline and resume evidence), `3436e7a` (scoped preflight and safe error categories).

Integration checks: 1,097/1,097 tests passed before the final compact-schema adjustment; subsequent affected checks passed (49 integration/filter/collector tests, 22 breadth tests, 15 gateway tests). The real UI smoke also passed with zero model calls, zero external network attempts and zero renderer errors. Native BrowserHost/session/login smoke passed with 24 isolated windows. Final verification is recorded below when the live run settles.

## Final checks and interpretation

Final source: `npm run check` passed, and **1,099/1,099 tests passed**, with no failures, skips or cancellations. The workbook/accounting verification passed after the live process exited successfully. The branch remains `production-v2`; no production promotion or deployment was performed.

The primary volume bottleneck was a concrete retrieval regression: hidden views could read initial documents but did not render the frames that trigger further loading. A higher monetary cap or waiting longer would not repair those missing callbacks. Small query portfolios and NO_PROGRESS handling compounded that limit. Restoring actual pagination, completing the query portfolio and preserving recoverable work increased the accepted pool to 1,113 without changing the frozen A acceptance criteria.

This case demonstrates that **1,000 accepted roots is feasible** with the current accounts and topic. It does not establish exhaustive Facebook/Threads coverage, a cold-start throughput guarantee, 5,000 useful posts for every niche, or the long-term monthly target. A field still needs enough discoverable relevant posts; the product should retain honest shortfall/coverage diagnostics when a genuine source or budget limit is reached.

The 1,113 / 2,143 acceptance ratio (about 51.9%) describes filtering throughput, **not output usefulness precision**. The exported result includes 295 retained roots and 705 newly collected roots. These distinctions are necessary when comparing this run with the earlier 293-result test and the historical 1,000-post workbooks.

## Qualitative sample review

A separate assistant reviewed 50 exported roots, chosen by the smallest SHA-256 hashes of the fixed seed `csd-cafe-recovery-qa-20261106` plus platform/root identity. Selection was from the actual 1,000-root delivery, with model explanations hidden from the reviewer. The sample comprised 35 Threads and 15 Facebook posts.

Review result: **43 useful under the agreed broad opportunity criteria, one clear promotion, three unrelated and three unclear**. Some useful records are context/experience/discussion opportunities, not direct purchase intent. This is an AI-assisted qualitative audit, not an independent human-labeled precision estimate. The four clear errors and three uncertain records remain visible in the evidence; the benchmark was not manually relabeled or selectively cleaned after sampling. Ad/off-topic leakage remains an improvement area even though the agreed count target was reached.
