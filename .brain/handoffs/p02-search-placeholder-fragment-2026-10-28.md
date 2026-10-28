# Search placeholder fragment — frozen for review

28/10/2026 Asia/Bangkok. Worker source/LIVE reads0. Build is isolated; shared dist/runtime/profile/master/README/reviewer files untouched.

## Evidence and narrow change

Lead's [LIVE v20 evidence](../evidence/p02-live-search-target-v20-2026-10-28.json) has2 qualified headers and6 records:4 rejected at HREF,2 NOT_LINK, zero visibility invalidation/click/read. Lead's subsequent AX observation records two same-origin/same-search-path timestamp links with only known query keys and fragments in the family `^#\?[a-z]{3}$`. The old classifier rejected every nonempty fragment before checking the placeholder branch. This patch addresses that observed incompatibility; it does not establish that all LIVE eligibility conditions will pass afterward.

`classifySearchTimestampHref` now admits a nonempty fragment **only** when it exactly matches `^#\?[a-z]{3}$` inside the existing same-origin, same-search-path placeholder branch. All existing protocol/host/credentials/port, path, query allowlist/duplicate/count/length, query-topic and multi_permalinks exclusions remain. Post-route fragments still return null, including the accepted fragment family. Other anchors, malformed/encoded/uppercase/longer fragments, different origin/path and new query keys remain rejected.

No fragment stripping, canonicalization, URL loading, href reconstruction or binding change. The original observed href remains in the private binding; the same bound HTMLElement receives its native click after the existing rescan. Only the classifier's compiled DISCOVER/CLICK strings change in production. Default search/current-post script hashes, controller/hooks, operation schemas, action scope and limits are unchanged.

## Verification

Isolated build PASS. **14 focused owner unit tests PASS**: existing lifecycle/Stop/route/barrier/bounds suite plus fragment classifier positives and negatives. The46 unchanged search/current-post/verifier regressions were not rerun this round. Accepted default script hashes remain pinned by the focused suite.

**9 native scenarios PASS**, all synthetic, with windows0/webContents0/source network0 afterward:

| Case | Result | Clicks / post reads |
| --- | --- | --- |
| fragment, opaque label, synthetic query lengths198/6 | OPENED_POST_SAMPLE, UNIQUE_HEADER_PLACEHOLDER | 1 / 1 |
| #target | NO_ELIGIBLE_TIMESTAMP, HREF rejection | 0 / 0 |
| post-route #?abc | NO_ELIGIBLE_TIMESTAMP, HREF rejection | 0 / 0 |
| malformed #?ab1 | NO_ELIGIBLE_TIMESTAMP, HREF rejection | 0 / 0 |
| same element changes #?abc to #?xyz after discovery | STALE_TARGET | 0 / 0 |
| valid fragment + popup | NO_ELIGIBLE_TIMESTAMP, popup rejection | 0 / 0 |
| valid fragment +18 actual client rects | TARGET_VISIBILITY/header invalidation | 0 / 0 |
| valid fragment + challenge before click | CHALLENGE | 0 / 0 |
| existing pending discovery + Stop | STOPPED, pending fence preserved | 0 / 0 |

Positive fixture asserts the exact original href (including fragment) at the native click handler. Every fixture has exactly1 initial search document request; no placeholder reload. The stale counterpart changes only the permitted suffix on the same DOM element and still blocks. Existing private binding observer, raw href equality, owner/document/route checks, body/public/header isolation, semantic exclusions, geometry/viewport limits and one-click/one-read caps remain.

Evidence: `p02-search-placeholder-fragment-{positive,target,post,bad,stale,popup,geometry,pre-barrier,stop}-2026-10-28.json`. Manifest: `p02-search-placeholder-fragment-files-2026-10-28.json`. Reproduce with `node scripts/facebook-dom-diagnostic-build.mjs`, focused owner test, then existing smoke `--search-post-open --search-case=fragment|fragment-target|fragment-post|fragment-bad|fragment-stale|fragment-popup|fragment-geometry|fragment-pre-barrier|stop`.

Next: independent review, lead activation, one existing diagnostic action. If another DOM condition fails, use its existing eligibility counters/shapes before further change. No LIVE success claimed. Permission UNKNOWN, benchmark OFF, valid0, candidate/source/identity UNVERIFIED; no pilot loop or gate change.
