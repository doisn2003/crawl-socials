# CSD3 — Facebook and Threads conversation capture evidence

Date: 2026-10-30, Asia/Bangkok. Owner: `comments_collectors` agent. This document contains aggregate evidence only. Post/comment bodies, source IDs, account names, URLs, credentials, and browser sessions remain outside the repository.

## Result and scope

The reusable conversation collector completed **24/24 live roots**, 12 Facebook and 12 Threads, using the existing Electron browser sessions. It captured **227 unique comments**, including **52 nested replies**, with **zero unresolved parent links in this pilot**. This demonstrates actual post/comment capture and bounded expansion on both platforms. It does not establish full-platform comment recall, classifier quality, platform-wide API permission, or completion of the user's 1,000-suitable-post goal.

The user goal is **1,000 suitable posts in total across the two platforms**, preferentially 800 Threads and 200 Facebook, with 700/300 acceptable. The pilot is capability evidence, not output counted toward that goal.

| Measure | Facebook | Threads | Total |
|---|---:|---:|---:|
| Roots completed | 12 | 12 | 24 |
| Unique comments observed | 115 | 112 | 227 |
| Nested replies with resolved parents | 31 | 21 | 52 |
| Unresolved parents | 0 | 0 | 0 |
| `OBSERVED_EMPTY` | 1 | 3 | 4 |
| `EXHAUSTED_VISIBLE` | 4 | 4 | 8 |
| `PARTIAL` | 7 | 5 | 12 |
| Aggregate capture time, milliseconds | 107,062 | 85,925 | 192,987 |

Facebook source mix: **4 GROUP, 4 PAGE, 3 PROFILE, 1 UNKNOWN**. Threads source mix: **12 PROFILE**. Known Facebook source kinds came from the existing source audit; an unknown source must not be silently promoted. Comment capture must not downgrade an existing known PAGE/PROFILE source to UNKNOWN.

The pilot selected existing café roots across lower and higher reported reply counts, rather than only popular roots. Historical reply counts are not a current empty/nonempty oracle: a Threads root whose older search record reported zero replies returned three comments during the live revisit.

## Capture method and evidence interpretation

- The collector used the actual Electron session, embedded document JSON, and browser-observed response bodies. No replayed private endpoint, synthesized comment text, posting, group joining, friending, or paid model call was involved.
- It navigated to the root, expanded visible comment/reply controls, alternated expansion with scrolling, and persisted incremental observations before the next expansion.
- Pilot limits were 50 comments as an expansion budget, 5 expansion steps, and 35 seconds per root. A received response batch is preserved in full even if it crosses the comment budget; the budget prevents the next expansion.
- Facebook root/comment identity is checked using the observed root context, comment identity, and parent/link evidence. Conflicting roots are rejected.
- Threads captures actual direct-reply and inline-expansion connections. Nested parent recovery uses an ordered branch's reply depth and matching reply-to author evidence together. If that evidence is absent or inconsistent, the comment remains with an unresolved parent; it is not guessed or discarded.
- Zero parent ambiguity in these 24 roots is not a universal guarantee. The first exploratory implementation had unresolved nested Threads parents; the bounded pilot was run after the depth-and-author binding fix.
- `EXHAUSTED_VISIBLE` means no further supported expansion was visible in this capture context. It does not claim all comments globally, including ranked-out, inaccessible, deleted, or moderation-hidden comments.
- `OBSERVED_EMPTY` requires a recognized reply connection, confirmed root, exhausted pagination, no expansion affordance, and no unresolved parents. A root-only payload or unsupported shape cannot become observed-empty.
- `PARTIAL` is preserved when expansion/time limits or pagination evidence prevent an exhaustion claim. A completed inner branch cannot incorrectly exhaust an outer connection; the current aggregate `has_more` handling is deliberately conservative.
- DOM text-prefix verification is diagnostic only. Virtualization means a final visible DOM may contain only a subset of comments already captured; those matches are not an independent recall measurement.

No live media-only or inaccessible-root case was found in this legacy text-oriented sample. Tests exercise these states, but this document does not label them live-validated. No comment classification precision, recall, suitability yield, or API cost-per-suitable result follows from this pilot. Model API spend for this agent's capture/probe work was zero; browser operating cost was not measured.

## Private artifacts and reproducibility

Private base directory on the user's machine:

`C:\Users\Admin\AppData\Roaming\csd-desktop\data`

| Relative directory | Purpose |
|---|---|
| `conversation-probe-20261030` | Initial response-shape and visible-control diagnostics on both platforms. |
| `conversation-collector-validation-20261030` | Four-root reusable-collector validation before the final nested-parent refinement. |
| `conversation-capability-pilot-20261030` | Final 24-root pilot supporting the aggregate table above. |

The final pilot directory contains `config.json`, `manifest.json`, `observations.jsonl`, `receipts.jsonl`, `summary.json`, and per-root verification files. Inspect those locally when identity-level traceability is necessary; do not copy them into the repository. The manifest started at **2026-10-30T13:46:24.482Z**. The process completed normally and flushed the browser sessions.

**Reproducibility limitation:** this pilot's original manifest has no component hashes. The probe was subsequently amended to record component hashes for future runs; current source hashes must not be presented as hashes captured by this earlier pilot. Several lifecycle tests and the search-to-comments drain fix described below were added after this pilot and were verified offline, not by rerunning these 24 roots.

## Implementation and verification

Primary implementation files:

- `src/infrastructure/browser/conversation-parser.ts`: strict root-bound Facebook/Threads parsing, nested parent evidence, nullable unresolved relationships, pagination and coverage information.
- `scripts/conversation-collector.mjs`: reusable bounded capture on an existing owned WebContents, incremental durable callback, temporary debugger ownership, Stop/barrier/navigation handling, final coverage receipt.
- `scripts/conversation-probe.mjs`: developer-only capability runner using existing profiles; private artifacts stay in appData. It is not the product's campaign runner.
- `src/infrastructure/browser/threads-search-parser.ts` and `facebook-search-embedded-parser.ts`: opt-in retention of context candidates; Threads includes replies and media references, Facebook preserves empty-text roots without borrowing quoted/shared text.
- `scripts/facebook-collector.mjs` and `threads-collector.mjs`: search hooks ingest raw observations, yield the owned profile for conversation capture, and resume the next search query.

The collector does not close the caller's host/window. It rejects an already-attached debugger, owns its temporary response listener, detaches on completion/failure, and propagates persistence failures after cleanup. Unknown/missing root content is not a successful empty capture. Unexpected navigation or account barriers remain explicit.

Offline integration audit found and fixed a real handoff race: search readers could be idle while native response retrieval was still pending; stopping the observer then discarded that response. The search collectors now wait for their persistence/request tasks **and observer pending requests, queued results, and active reads**, require two quiet polls, and use a bounded 12-second drain before checkpoint/handoff and observer renewal. Timeout preserves the unfinished query checkpoint and reports `CAPTURE_DRAIN_TIMEOUT`. This does not remove upstream browser response/resource limits; such limits must remain visible as partial/error evidence.

**Subsequent live correction:** the first full campaign attempt exposed that global network-idle waiting is unsuitable for an auto-loading feed: Threads kept issuing real search requests during the page barrier and hit `CAPTURE_DRAIN_TIMEOUT`. Its durable records were retained as engineering-pilot evidence, not promoted to a successful goal run. The corrected design separates a page persistence barrier from a handoff boundary. Normal pages wait for received bodies and persistence without requiring all network requests to finish. Handoff/renewal/close pauses admission of new requests, drains the finite already-admitted set, and then releases the observer. Existing bodies are retained; future requests outside the closed capture boundary are counted as admission-filtered. The handoff bound is now 35 seconds, accommodating the observer's 30-second request timeout; the earlier 12-second all-network design is superseded. Search response capture is restricted to the platform's GraphQL path. Default observer behavior is unchanged unless admission pause is explicitly requested.

Focused validation command:

```powershell
node --test tests/collector-opportunity-hooks.test.mjs tests/collector-runtime.test.mjs tests/conversation-collector.test.mjs
```

Result after the drain fix: **32/32 tests passed** (10 hook integration, 15 collector lifecycle, 7 reusable conversation collector). `git diff --check` passed for the changed search collectors and new hook tests. Relevant parser tests also passed during parser development: `tests/conversation-parsers.test.ts` exercises root isolation, nested-parent evidence, ambiguous parents, no-text/media candidates, identity-fragment retention, and legacy opt-in behavior.

The new hook tests use the real runner and durable legacy store with a synthetic browser/transport. They exercise durable callback ordering, search → conversation → next search, debugger/listener release, Stop before the next query, disk-write failure, media/reply retention, a delayed response arriving during handoff, and timeout without checkpoint advancement. The reusable collector test verifies that all comments in an already-received batch survive a comment cap.

After the subsequent drain correction, focused validation passed **19 hook integration tests**, **15 lifecycle tests**, **7 conversation collector tests**, **19 observer tests**, and **10 conversation parser tests**. Additional regressions distinguish intent/raw/model limits from explicit Stop; allow bounded enrichment after a discovery limit; verify a STOP file inside the hook; prevent duplicate-only batches from resetting Threads progress; OR pagination across multiple Threads search connections; and prove admission pause preserves an already-admitted body while excluding a later request. TypeScript test compilation passed. This validation is synthetic/offline; the next full live campaign must independently establish the corrected behavior and resulting output.

## Packaged SQLite worker smoke

`scripts/conversation-store-smoke.mjs` was extended with `--module <absolute path>`, retaining the default development module path. It imports the exact selected module without a fallback and reports whether the selected path is inside an ASAR.

A real Electron **44.10.0** / Node **24.22.1** process loaded:

`C:\OwnProject\crawl-socials\release\win-unpacked\resources\app.asar\dist\infrastructure\storage\async-conversation-store.js`

The packaged module spawned its worker, ingested one synthetic root, returned the expected SQLite statistics, and closed successfully: `packaged_module=true`, `worker_sqlite=true`, `raw=1`, process exit **0**. The smoke used isolated temporary userData/sessionData and did not touch source accounts, browser profiles, the real application database, or the UI. Logs remain at `C:\Users\Admin\AppData\Local\Temp\csd-asar-smoke-822277a0-c178-4ce8-838f-cb611fb68083`. This verifies the packaged storage path in that archive; packaging must be refreshed when later source changes are released.

Follow-up integration work belongs to the root agent: distinguish explicit user Stop from discovery reaching a budget/target; drain remaining initial comment jobs after discovery where allowed; keep active-watch exports current. Their later completion should be recorded separately rather than inferred from this evidence.

## Native application smoke

The latest main CSD app was tested through the native Computer Use skill after a second instance restored its initially hidden window. This was a UI smoke, not a campaign run.

Observed:

- Opportunity checkbox enabled the prompt and optional brand form.
- The form displayed total goal **1,000**, source ratio **80:20**, raw cap **3,000**, and budget **$3**.
- The authorized café conversation prompt was entered; brand context stayed blank. Saving on blur displayed the local-saved confirmation.
- Both source accounts appeared authenticated. Selecting both enabled Start; Start was not clicked.
- Layout was readable at approximately 1,226 × 933 and at a native-resized approximately 793 × 933 window. The narrower form wrapped into two columns without horizontal clipping.
- The app was closed normally through its UI and no CSD window remained, releasing profiles for the root agent's campaign work.

Restart persistence was not tested through the UI in this smoke. An old legacy result preview was visible before the root agent's later stale-seed fix; it was not treated as a newly collected result. No user changes to `cooler.html` were modified during the smoke.

## Threads discovery reply → root resolution: live proof

Search can expose a reply permalink without its root-post identity. Such records remain durable `CANDIDATE` observations and are not counted as roots. The primary campaign's frozen checkpoint had **770 unresolved candidates**; the pilot below does not retroactively resolve that backlog or add its results to the frozen campaign.

The first bounded resolver pilot found all three requested replies but returned **3/3 `UNRESOLVED`**. Inspection of the private native payloads identified the cause: Threads splits one media entity across Relay fragments. A full fragment supplies the reply's native ID, shortcode and caption; another fragment with the same native ID supplies `text_post_app_info.containing_thread.posts.edges`, but omits the shortcode and caption. Requiring all fields in the same fragment rejected valid ancestry evidence.

The corrected parser first anchors the observed reply ID to the requested permalink shortcode, then joins ancestry-only fragments by that exact native ID. It rejects conflicting shortcodes, conflicting root references, multiple possible roots, and fragments from other entities. A root must have native non-reply evidence, actual content/media context and a usable observed permalink. The reply is never promoted into a root. Provenance retains separate content and relationship paths into the actual payloads. Parent recovery uses explicit parent IDs or a unique predecessor depth together with matching reply-to author; an ambiguous parent remains null.

Offline replay of all three first-pilot captures succeeded after the fix. A fresh **second live pilot** then independently captured the same three observed reply permalinks using the existing Electron session:

| Verified measure | Result |
|---|---:|
| Reply locators resolved | 3 / 3 |
| Distinct actual roots | 3 |
| Unique observed comments, including selected replies | 8 |
| Unique stored entities | 11 |
| Unresolved parents / foreign roots / parent cycles | 0 / 0 / 0 |
| Selected replies incorrectly counted as roots | 0 |
| Aggregate capture time | 8,083 ms |

Each root was proven through its selected reply's native `containing_thread` relationship. All saved observations were replayed from the second pilot's projected native payloads: entity type, text, root ID and parent ID matched exactly. Each parent chain terminated at the corresponding observed root. The second pilot's manifest records hashes for the probe, collector and parser; the private integrity report records the observations-file hash.

Private artifact directories, relative to the private base above:

- `benchmarks\cafe-live-20261030\reply-root-pilot-v1`: supplied reply locators, first-capture diagnostics, offline resolved observations and replay summary.
- `benchmarks\cafe-live-20261030\reply-root-pilot-v2\capture`: fresh manifest, projected payloads, observations, receipts and `integrity-verification.json`.

Implementation: `src/infrastructure/browser/threads-reply-root-parser.ts`, `scripts/threads-reply-root-collector.mjs`, a lazy export from `scripts/conversation-collector.mjs`, and the developer probe `scripts/threads-reply-root-probe.mjs`. **14 focused resolver tests passed**, including native response capture, split-fragment joins in either arrival order, identity conflicts, unrelated media exclusion, unresolved candidates, Stop, navigation/account barriers and persistence failure.

The probe accepts only **1–3 supplied reply locators**, navigates directly to them, and uses a **25-second per-locator limit**. It performs no new search or model call. Production integration has a persistent **50-attempt campaign budget**, at most two attempts per resolver job, and reserves at most one ordinary query-handoff slot for resolution. Resolution produces durable root/comment evidence before ordinary comment enrichment is scheduled.

These are **root-identity and parent-integrity results**, not complete-comment coverage, relevance precision, recall, or a 770-candidate recovery rate. No comment pagination/exhaustion claim follows from resolving a root. The resolver does not infer inaccessible/missing ancestors, fetch hidden content, or guarantee that a resolved conversation is relevant; the normal classifier and bounded conversation collector still perform their separate work.

Subsequent offline integration review tightened three safeguards: historical raw candidates whose comment and root are already projected are excluded from resume backfill; known orphan-root identity is retained/refreshed and passed into the resolver, with conflicting callback observations rejected before ingestion; and a `RESOLVED` audit receipt is written only after the stored root URL and selected reply membership have been verified. Missing evidence now produces an explicit evidence-error receipt rather than a false resolved receipt. Candidate deduplication does not delete raw history, and a later ancestry-only observation can reuse an earlier safe observed permalink for the same native entity. **68 combined storage, pipeline and resolver tests passed**; after the final permalink-recovery refinement, TypeScript compilation and **6 targeted regressions passed**. These integration safeguards were verified offline after the three-reply live capture; they do not constitute another live batch.

## Durable discovery continuation — offline verification

An additional engine audit found that an interrupted search reopened its URL at the beginning, but duplicate-only pages could stop it before its previously observed depth. A query reaching the scroll budget was also advanced beyond the numeric checkpoint, leaving an explicit Resume before the original deadline without further query work.

Intent collectors now keep a versioned discovery frontier alongside the existing checkpoint. Each job is bound to the platform, exact query, mode, run identity and plan hash. `BUDGET_LIMITED` and `STALLED` preserve work for explicit Resume; only observed native pagination end produces `EXHAUSTED`. Records received during replay are still persisted. After the durable record barrier, the collector saves observed scroll depth; Resume traverses that prefix before counting duplicate-only pages as stagnation and grants one new bounded slice. The original manifest/deadline and global raw/model stop callbacks remain authoritative.

This is bounded native-UI replay, not a saved platform cursor or a guarantee that a dynamic feed has unchanged ordering. A prefix deeper than 100 scrolls returns `REPLAY_BUDGET_REACHED` with the frontier retained. Expired-attempt renewal retains its separately audited fresh-search behavior; this change does not carry a cursor across a new attempt ID. Legacy collection semantics remain unchanged. Yield-adaptive allocation and automatic source refill after later decision demotions are not implemented by this change.

TypeScript compilation and **54 focused tests passed**: real runners with synthetic browser transport, lifecycle/Stop and persistence barriers, continuation beyond duplicate prefixes on both networks, interruption after durable raw but before depth checkpoint, native end, global raw stop, original deadline, query/mode mismatch guards and conservative migration of older intent checkpoints. A separate agent reviewed the helper and both collector integrations without finding a blocking issue. No network/model call, user-profile access or dataset mutation was used; native continuation coverage and packaged integration require separate evidence.

Files: `scripts/discovery-frontier.mjs`, both search collector scripts, `src/application/discovery-attempt.ts`, `tests/discovery-frontier.test.mjs`, `tests/discovery-attempt.test.ts`, `tests/collector-opportunity-hooks.test.mjs`, and the existing collector runtime test harness.
