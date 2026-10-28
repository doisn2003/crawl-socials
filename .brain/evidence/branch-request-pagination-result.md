# Request pagination experiment — PARTIAL

2026-10-28, Asia/Bangkok. User authorized this bounded run in the new chat; old workers and automations remained stopped. Meta permission UNKNOWN; no benchmark started.

## Result and dataset

**PARTIAL: 5 unique observed Facebook post links persisted, not 20; no observed pagination operation and no continuation sent.** The 5 posts came from the loaded search document's application/json data, not a successfully correlated CDP search response. Strict B00 request/response correlation was not achieved; B01 and B02 did not pass. No HTTP 200, fixture, or test count is used as collector proof.

Local protected output directory: `C:/Users/Admin/AppData/Roaming/csd-desktop/data/request-experiment-20261028/`.

- Final dataset: `posts-reviewed.jsonl`; SHA-256 `f4dd99c0c5ecab24678dd6fa78d904a767a20f5e59e5f27963dffaaddc6c4623`.
- `posts.jsonl` and `posts-enriched.jsonl` preserve earlier stages; `observed-record-fields.json` preserves only selected post fields.
- `dataset-summary.json`, `response-index-initial.json`, `response-index.json`, `network-metadata.json`, `budget.json`, `final-observer.json` and command snapshots provide local evidence.
- 5/5 text prefixes match the earlier saved DOM snapshot, using Unicode normalization. No post was opened individually, and no permalink was reopened; validation is Story ID + observed permalink + matching search content.
- Sources: 2 PAGE, 3 GROUP, 0 PROFILE. Group publication is established by same-Story associated_group and group title. Page classification is supported by same-Story page_insights page_id_type=page, matching actor and post ID; the generic GraphQL typename User was not treated as proof of personal profile.
- 5/5 have explicit per-Story PUBLIC metadata; search filter alone was not used as visibility evidence.
- 2/5 are clearly relevant cafe brand/location content. 3 recruitment/transfer posts remain relevance UNVERIFIED, not automatically rejected by category. Source + public + reviewed relevance = 2; not benchmark-accepted records.
- 5/5 have publication time, reactions_total, comments_count and shares_count. love_count is null with a reason for 3/5. Observed zero share counts are preserved; absent love entries are not converted to zero.
- Repeat persistence added 0 rows and kept total 5. One sponsored rendering strategy was unsupported by this extraction; this is parser coverage, not a blanket advertising exclusion policy.

## Limits and source evidence

Clock began 10:03:49; source activity ended 10:16:34. Finalization and Git/build verification followed within the original 60-minute allowance. Discovery consumed 2 search loads, 2 scroll commands, 0 active continuation requests; concurrency 1. No new LIVE run is authorized by this result.

The existing logged-in CSD Facebook profile was verified in the current runtime before clean shutdown and reopening through the existing browser host/session persistence. The exact search URL and public filter were observed from the old window, not guessed. No credentials were read into output, copied to another browser, or committed.

1. Reused response observer with bounded overrides: 2 MiB/body, 16 MiB buffer, 32 MiB captured total, 60-second segments. Initial document yielded BODY_UNREADABLE; this was not labeled Facebook denial.
2. Actual GraphQL responses had text/html MIME while carrying JSON. The initial diagnostic decoder wrongly routed those to HTML data-block parsing. A single evidence-based decoder correction tried JSON/NDJSON before HTML. Raw requests and raw response objects stayed in Electron memory; only metadata and selected fields were persisted.
3. The observed search operation was CometSearchBootstrapKeywordsDataSourceQuery, whose variable first=2000 describes keyword bootstrap, not post pagination. It was not replayed as a post query. No post-pagination request template/doc_id was observed after the two scroll commands, so none was invented or sent.
4. Loaded application/json contained `data.serpResponse.results.edges[].rendering_strategy.view_model.click_model.story`, with 5 organic Story records and one different ad strategy. Same connection included has_next_page=true and an opaque cursor. A cursor in document data alone does not prove transport replay capability.
5. Both scroll commands ended at the same bottom position without a new results batch. A diagnostic capturePage also returned UnknownVizError. The reason UI did not produce a pagination request remains unresolved; no claim is made that Facebook denied access or cannot paginate.

No batch B exists. Batch A has 5 unique records; continuation new identities = 0, no-scroll continuation proof = absent. Source discovery cap caused early stop; the clock was not reset and no extra scroll/search was added to force yield.

## Git, checks, and disposition

Initial workspace was not a repository. Ignore was expanded for .env, profiles, credentials, datasets, databases, build/test directories and historical screenshots. Existing source/config/docs were inspected and scanned against .env values before explicit staging. Baseline on main: `46e7d20b8befc90b2530de54dd86fd09ae693058`.

Experiment branch: `experiment/facebook-request-pagination`. Its checkpoint preserves the diagnostic entry point and added transport request ID metadata. Normal app bootstrap was not wired to the experiment. Syntax, TypeScript/build and focused observer checks passed; these are regression checks only.

Disposition: preserve branch, do not merge experiment code. Return to main and rebuild main source before any app launch. The one allowed follow-up is a pure parser for the observed embedded-document Story schema, on a separate branch, with sanitized structure tests. No raw response was retained and a reconstructed projection is not called native replay. No additional LIVE, background worker, account/proxy switch, remote, push or publish.

Final experiment checkpoint: `b273bc2a5aedc46cd68f34c5c3a5df18dfa16f90`. The earlier `110c6db` checkpoint was amended for data hygiene: per-post relevance decisions were moved out of source into the local dataset directory, and diagnostic output redaction was tightened. Failed experimental work and all result files remain preserved.

Fallback checkpoint: `89c844f1ffccea26fa567513ec6b61f96b3a1b55` on `experiment/facebook-embedded-link-first`. The pure parser was implemented and passed focused offline/schema checks; it was not connected to the app or tested on a new LIVE run. See [follow-up](embedded-link-first-followup-2026-10-28.md). Fallback work ran 10:21:56–10:25:39, inside its 30-minute cap.

Final state: main, documentation-only result updates; neither experiment's code merged. Main source rebuilt successfully at 10:26; no Electron process left running, no remote configured, no push/publish. Normal dist/main entry and observer are rebuilt from main, not the experimental scripts. Dataset remains outside Git and .env/profile/build artifacts remain ignored. Main receipt commit is reported in the final user response.
