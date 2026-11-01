# CSD conversation pipeline — implementation and live verification

Status: **0.3.0-rc.1 packaged**, not a production semantic-quality sign-off. The user's latest clarification is to improve the reusable, multi-topic collection/filter engine, not manually curate a 1,000-post café deliverable. The configurable target is **1,000 suitable unique roots TOTAL**, preferably 800 Threads + 200 Facebook, with 700 + 300 available as another configuration. A comment, revision, or duplicate observation never adds another refined post. This overrides older per-network targets.

## Implemented behavior

- A general campaign planner turns the prompt into versioned criteria and lexical query anchors. Generated queries are short and grounded in supplied context; exact explicit seeds are retained. Legacy keyword configuration remains separate.
- Collection awaits durable raw ingestion before continuing. A SQLite worker maintains roots, revisions, evidence spans and durable jobs. Classification runs beside collection with backpressure and incremental UI updates.
- Both source collectors yield their profile window to bounded comment collection at query boundaries. Root/parent links, actual coverage and account barriers are preserved. New evidence reopens classification; stale decisions remain history.
- Suitable / Not yet / Unrelated are business labels. Missing context, provider errors and paused work remain technical pending, rather than false rejection.
- Watch jobs use 2/8/24-hour visits, a 72-hour TTL and three scheduled attempts. Missed visits coalesce. Stop preserves jobs; a later explicit Resume may continue. Merely reopening the app does not start a crawl/watch.
- Expired discovery can create a separately identified attempt while retaining the original manifest, cumulative raw allocation and campaign/model ledger. It does not reset the original deadline or cost.
- The UI shows three groups, evidence, source counts and model cost. JSON exports use a transactional data watermark; Excel exports preserve exact IDs, comments, historical evidence and the cost capture timestamp. Existing raw-only exports remain supported.

## Verification completed

- Final release-candidate build/test run: **693 tests passed**, zero failures/skips; main, renderer and test TypeScript checks pass. This includes reply-root handling, version isolation, primary-flow multi-topic fixtures, configurable source ratios, comment scheduling and streaming export regression coverage.
- Real Electron SQLite worker smoke passed on Electron 44.10.0 / Node 24.22.1.
- The worker also passed when imported from the packaged `app.asar`, with isolated temporary data. This proves packaged storage loading, not a complete packaged UI acceptance test.
- Final portable build succeeded: `release/CSD-Portable-0.3.0-rc.1.exe`, 102,378,147 bytes, SHA256 `b9e12943d38f135d3b296f1c81a3a03248ec0ab08102b5397c8d0efcd8f89e3d`. Both native and exact packaged-ASAR SQLite worker checks were rerun successfully for this build. No real campaign/profile was opened by those isolated checks.
- Native UI was inspected at normal width and approximately 800px, with saved café prompt, total target and Threads preference. Login/account state was available for both sources. Restart persistence and final packaged UI still need their own evidence.
- Actual comments pilot: 24 roots, 227 comments, 52 nested replies across both networks. See [comment evidence](conversation-comments-2026-10-30.md). Coverage is partial; this is not network-wide comment recall.
- Calibration and alternative model results are recorded separately in [filter evidence](opportunity-filter-v2-2026-10-30.md). Historical calibration does not certify production precision/recall.

Release-candidate hardening also fixes source ceilings that could stop Facebook prematurely under a larger configured raw cap: intent mode accepts up to 10,000 local candidates, with the shared unique-root cap authoritative; legacy retains 3,000. Qualified stop targets use the chosen 80:20 or 70:30 ratio. Unknown comment-count metadata now schedules lower-priority initial capture rather than pretending the count is zero; related promotional posts join the bounded watch policy. Full Excel exports include roots awaiting classification and suppress stale labels on newer content. Existing user exports were not regenerated or relabeled.

## First live pilot and repair

Run `crawl-529d7e4d-ad66-482b-a9de-5d27dedf1b23` was stopped after Threads raised `CAPTURE_DRAIN_TIMEOUT`. Its 119 roots and four comments remain intact; 82 roots were still pending. It is not a completed yield benchmark. Known model usage cost was $0.01827475, with a conservative $0.0150935 unresolved-usage upper bound.

The page was continuously loading more search requests. The corrected collector uses a persistence barrier during paging, and stops new observer admission before a strict query/window handoff, then drains already-admitted requests. Regression tests cover continuous request arrival and preserve already-admitted response bodies. It does not declare a source exhausted merely because capture hit a limit.

Query inspection also found lexical ambiguity: “tìm quán cafe làm việc” predominantly retrieved employment groups on Facebook. “xin quán cafe yên tĩnh” changed that source mix. This is a discovery-quality issue, not proof that the filter itself failed. No automatic joining, friending, posting or commenting was performed.

## Active campaign and evaluation

The repaired live run is `crawl-4e3faa2e-c67d-4353-86f8-734febb4b683`. It uses 26 short query anchors, interleaved Top/Recent searches on Threads, a 3,000-root raw cap and a $3 model budget. All private data is under the application's `data/collections` folder, outside the repository. Runtime counts must be read from the latest snapshot, not copied from an intermediate status here.

The primary run has now completed. Its frozen export is `data/benchmarks/cafe-live-20261030/final-primary-v1/frozen-export.json`, SHA256 `158eaca4c0bd79be3baf68570e6604c34b224ca4b6d71e7234aa6d74a889ac5e`. This immutable checkpoint contains:

| Network | Unique root posts | Model suitable | Not yet | Unrelated | Pending context | Comments |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Threads | 2,121 | 820 | 626 | 665 | 10 | 340 |
| Facebook | 880 | 209 | 542 | 128 | 1 | 230 |
| Total | 3,001 | 1,029 | 1,168 | 793 | 11 | 570 |

The final received batch exceeded the raw cap by one root; no raw-cap extension was used. Model-accepted yield is 34.29% overall (Threads 38.66%, Facebook 23.75%). These are operational classification rates, not reference-confirmed precision. Another 770 distinct Threads reply candidates still lacked a projected identity binding to a root at this checkpoint; they are retained raw and excluded from root-post counts.

At daily quota exhaustion the original Gemini 3.1 ledger was preserved, and an explicit switch to Gemini 3.5 was recorded in `model-routing.json`. Known token-priced costs are $0.9188975 for 3.1 plus $0.5457145 for 3.5, totaling **$1.464612**, with **$0.0422825** unresolved-usage upper bound: **$1.5068945** conservative campaign total. There are 413 finished attempts, 407 successful, and zero unfinished reservations. This is API usage at recorded list prices, not an invoice or total crawl/hardware/labor cost. Development/reference experiments are separate in [filter evidence](opportunity-filter-v2-2026-10-30.md). Switching models did not reset the shared $3 budget.

The delivery helper selected exactly **800 Threads + 200 Facebook**, all current ASSESSED SUITABLE unique roots, using the deployed frozen ranking order. Private output: `final-primary-v1/delivery-model-v1/`. It includes JSON, XLSX, the unchanged full pool, a hash manifest and a separate top-20 diagnostic. Structural audit passes with zero findings for both pool and selection. The workbook contains 1,000 conversation rows, 221 comment rows and 1,057 decision-history rows. **These labels remain model-assessed, not individually human-verified.**

Comment coverage is selective: only 20 of the selected 1,000 roots have an attempted comment capture; 980 are NOT_ATTEMPTED. Eight selected decisions cite comment evidence, including two whose action target is a comment. Do not represent 221 comments as full coverage or interpret absence of captured discussion as absence of demand. Structural PASS does not certify semantic quality.

The optional verifier is implemented with evidence validation and shared model-budget accounting, but **disabled** for this run: the tested cheap verifier removed too many true positives, while other tested endpoints failed. A later focused verifier remains explicit experimental only. It is not enabled for new product campaigns by default, and has not been applied to the frozen dataset.

## Reference benchmark and change of implementation focus

An independently labeled AI reference sample contains 100 Facebook and 200 Threads roots, with a second review of 60 and three adjudications. It is not a human gold set. Previously exposed roots and detectable text copies were excluded before drawing the sample; author exclusion was incomplete where metadata was absent. Sixteen reference cases remain unresolved.

| Platform | Precision on resolved reference | Recall on resolved reference |
| --- | ---: | ---: |
| Facebook | 78.95% (95% CI 56.67–91.49%) | 88.24% (65.66–96.71%) |
| Threads | 87.30% (76.89–93.42%) | 93.22% (83.82–97.33%) |

The weighted candidate-frame estimate is precision 85.63% and recall 92.26%; confirmed suitable yield is 23.83%. This fails the desired 90% precision gate. Recall is within collected candidates, not recall over all social-network posts. The sample and complete calculation are retained under `data/benchmarks/cafe-live-20261030/fresh-holdout-v1/`. Once its errors inform development it is no longer an untouched release holdout.

The focused verifier diagnostic reached 25 KEEP, seven downgrades and eight unresolved technical outputs among 40 development cases. Eight outputs cited entity IDs instead of valid evidence-span IDs; they were not silently repaired into successful decisions. Including this diagnostic and its retry, the campaign's conservative API-cost upper bound is $1.5734064; the primary frozen export retains its earlier cost capture. The experiment did not mutate the 3,001-root dataset, change labels, extend the raw budget or reset the model budget.

At the user's explicit correction, further café-specific tuning, backfill and collection to fill a quota stopped. Work now hardens the engine: campaign-specific limits, version-isolated queues/results, comment-driven revisions, crash recovery, and primary-flow contract tests for consumer products, travel, education and café. Offline transport fixtures verify software behavior; they do not establish multi-topic model accuracy.

The unchanged previous dataset was copied to Downloads on request: `CSD-cafe-full-3001-20261030.json` (same SHA256 as the frozen export) and `CSD-cafe-1000-model-selected-20261030.xlsx` (SHA256 `f3042e964d0161a9beb23e7be28845a8b9c1fc6dcd2cdc77c1ec74d92c91a6d6`). The 1,000 rows remain model-selected, not individually verified refined posts.

## RC2 engine changes, 30–31 October

The optional plan-review flow now uses the real service, preload and renderer contracts: preview, immutable manual revisions, preset save/apply and Start from the exact selected draft. Planner allocation is journaled before a model request, so interrupted previews retry against the same ledger. Unsupported recipes remain inspectable but cannot silently start. Presets preserve platform-specific queries and bounded watch settings. Legacy policy fields not consumed independently by the classifier are read-only in the editor; no silent conversion of old presets or recipe hashes occurs.

Discovery now persists a frontier per platform/query/Threads mode. A bounded search slice is not source exhaustion. Explicit Resume inside the same attempt replays saved depth before looking for new items; replay is bounded and can stop with `REPLAY_BUDGET_REACHED`. A fresh expired attempt keeps its existing audited behavior. This is approximate browser continuation, not a server cursor or demonstrated live continuation accuracy.

The experimental `conversation-opportunity-v2.1.0` policy captures an evaluation time and evidence-backed deadlines. The store suppresses expired or superseded labels, retains history and schedules same-snapshot reassessment. Deadline evidence must belong to the selected opportunity entity, so an old root deadline cannot expire an unrelated newer consumer comment. Stop cancels monitoring; model-budget pause allows read-only expiry updates without new requests. This policy remains opt-in and is not a migration of the frozen café results or a default-policy semantic improvement claim.

Workbook Conversations and DecisionHistory append evaluation time, validity deadline and temporal evidence; the Manifest records the snapshot time. Legacy missing timestamps stay missing. Platform targets now use one shared integer allocation in the pipeline and both windows: 1,001 at 80:20 becomes 801 + 200, not two rounded-up denominators.

Verification for this source revision: `npm run check` and `npm test` passed, **767/767 tests**, zero skipped. Added regressions exercise interrupted preview costs, preset/revision safety, dirty-editor recovery, source-scope preservation, bounded watch edits, temporal target validation, expiration/export consistency and durable discovery continuation. A native 1,100px smoke used the actual built renderer/preload/service with an isolated fake model transport: preview, edit/save, preset save/apply succeeded; exactly one fake model request occurred and preset application cost was zero. No real API or social session was opened. These checks establish software behavior, not semantic precision or complete comment coverage.

The RC2 portable build succeeded: `release/CSD-Portable-0.3.0-rc.2.exe`, **102,396,309 bytes**, SHA256 `b53ec823ef873dfec92f27fc62c173eb38e9e577aae0beec68e7d13057a155ca`. ASAR inspection confirms version 0.3.0-rc.2 and the new planner, shared allocation helper, draft service, discovery frontier and SQLite worker; no test or `.brain` files are packaged. The exact ASAR SQLite worker smoke passed on Electron44.10.0/Node24.22.1.

A second native smoke loaded the exact packaged main/preload/renderer at 800px with an isolated appData copy of the synthetic draft/preset. It restored the edited topic and zero-cost applied preset and rendered the plan editor without clipping. This used the installed Electron runner to import the packaged entry, not the portable self-extraction launcher; its version badge reflects that runner. No login/crawl/model call was made. Both test windows were closed. Private test/package/action/worker logs are retained in `data/campaigns/engine-rc2-20261031/`; the original Downloads datasets and RC1 portable remain unchanged.

The completion audit still identifies required V1 work: replay retained raw under a new campaign, prompt-to-structured geographic/language/age constraints, source registry/feed collection, campaign queue-byte/disk/retention controls, honoring `max_run_minutes`, and age-based expiry when no explicit request deadline exists. Presets are complete criteria reuse, not raw-data reuse. Source-kind metadata is not source-feed discovery. These are implementation gaps in addition to semantic benchmark and live-coverage gates.

## Rollback and remaining limits

Before the first explicit v2 config save, the app preserves the legacy configuration as `user-config.json.v1.backup`. Disabling intent mode in this build returns to the legacy collector. If rolling back the binary to a version that accepts only v1 configuration, close CSD first, preserve the current v2 config separately, then restore the saved v1 config; retain all collection directories and raw journals. No rollback was performed against the user's actual data.

Remaining quality work is an independent semantic benchmark across topics and better measured discovery/comment coverage. Automatic query reallocation from measured yield, additional source-feed discovery and selective OCR/vision are not implemented in this release candidate. The watch policy has deterministic lifecycle coverage but has not been observed live for a full 72 hours. No claim of 1,000 independently confirmed refined posts or production semantic readiness is made.
