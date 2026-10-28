# P02.02 — Independent subframe history review

## Baseline before owner freeze

Read `p02-live-route-events-v17-2026-10-28.json` and `../handoffs/lead-p02-subframe-events-dispatch-2026-10-28.md`. V17 trace identifies the direct cancellation: after expected main START and COMMIT, entry 2 is SAME_DOCUMENT / DID_NAVIGATE_IN_PAGE / SUBFRAME, main current URL EXACT, owner SAME, generation delta 1. It cancels with OWNER_CHANGED / SUBFRAME_HISTORY during NAVIGATING and read_count 0. This identifies v17 only; v16's event was not recorded.

Fixed-script review: the accepted script traverses its own `document` via XPath, query selectors, Range and TreeWalker. It does not read `contentDocument`, `contentWindow`, `frames`, parent-frame documents or execute in an iframe. Its variables named frame/frames model header/clip ancestry, not browser frames. The iframe **element in the main DOM** still participates in reCAPTCHA/overlay barrier detection; accepting a harmless child history event must not remove that check or change public/header/body/identity logic.

Added three narrow reviewer tests to `tests/facebook-post-route-verification-review.test.ts`:

1. Child history after main commit during loading preserves the owned main document and allows the existing one-read comparison.
2. Child history during the fresh read preserves the main body/hash evidence; the child's different URL is not read or copied to the summary.
3. The same child event cannot excuse changes to main URL, owner, view, document generation or an away-return sequence.

The former blanket subframe negative is now explicitly a **subframe event while main URL changed**. The previously harmless frame case is retained in the new positive test, reflecting this dispatch's narrower ownership semantics; actual main-context change still expects INCONCLUSIVE.

Baseline uses the preserved v17 compiled modules under `.test-build-adapter-candidate/subframe-baseline/src/`, copied only within reviewer output. Verifier SHA-256 `e52e1e3749aec1d9b6e55e554c6e61dd6cb7d6010365622c8f3f744f1052f568` was asserted before execution.

```powershell
node --test --test-name-pattern='review subframe history:' .test-build-adapter-candidate/subframe-baseline/tests/facebook-post-route-verification-review.test.js
```

Result: **two expected positive failures** (INCONCLUSIVE instead of REOPEN_MATCH), **one negative table PASS**. This is a unit reproduction of the known cancellation behavior, not a native iframe test or a new source observation. Test and evidence hashes: `adapter-p02-subframe-baseline-files-2026-10-28.json`.

Reviewer stops here pending frozen source/native handoff. Final review must confirm both watchLoss and verifier require unchanged owned main context, retain bounded/sanitized trace and sticky cancellation, and exercise actual iframe history events in loading/read through both watchers. No UI, profile, credentials, runtime/shared build/source implementation or gate changes were made.

## Final frozen review — PASS

Reviewed `../handoffs/p02-subframe-2026-10-28.md`, the final verifier and reader/menu watcher, and the native iframe fixture. **21/21 owned manifest hashes match before and after review; 65/65 isolated native build hashes matched before native execution.** Fixed script and current-post reader controller hashes are unchanged.

Reader `watchLoss` now distinguishes main history from child history. For a child event it checks the captured owned WebContents/view, current main URL and main document counter, without comparing the child URL to the post route. Unknown frame flags fail closed in this reader watcher. Main history still requires exact event and current URLs; full main navigation/loss still cancels. The no-op option remains scoped to current-post/verification; search and metadata retain their strict default.

Verifier accepts only SAME_DOCUMENT events on its subframe branch and still checks main owner, exact current main URL, and generation 0 before commit or 1 after the single commit. Child URL equality is explicitly NOT_APPLICABLE. Other event types on that branch, changed owner/URL/generation and all main navigation rules remain fail closed. The 16-event cap and sticky first cancellation are evaluated before branch handling and were not bypassed.

Fresh compile output `.test-build-adapter-candidate/subframe-final` passed **50/50 related tests**: 14 independent verification, 17 owner verification, 8 independent current-post and 11 owner current-post tests. Both positive subframe baseline tests now pass with their behavioral expectations intact. Negative main URL/owner/view/generation and away-return tests remain passing. Positive tests additionally assert SUBFRAME / NO_OP / NOT_APPLICABLE and expected main URL/generation metadata; no child URL is retained.

Compilation used the same strict options recorded in the preceding route-event review on those four files. Executed:

```powershell
node --test --test-reporter=dot .test-build-adapter-candidate/subframe-final/tests/facebook-post-route-verification-review.test.js .test-build-adapter-candidate/subframe-final/tests/facebook-post-route-verification.test.js .test-build-adapter-candidate/subframe-final/tests/facebook-current-post-review.test.js .test-build-adapter-candidate/subframe-final/tests/facebook-current-post.test.js
```

Independently reran six native scenarios through the existing isolated fixture runner. For `CASE` in `iframe-loading`, `iframe-read`, `iframe-main-change`, `iframe-barrier`, `stop`, `full-same`:

```powershell
node scripts/facebook-public-candidate-smoke.mjs --route-verification --route-case=CASE --output .brain/evidence/adapter-p02-subframe-CASE-2026-10-28.json
```

**6/6 scenarios, 18/18 recorded outcomes PASS.** The iframe is an actual document served by the local protocol fixture, with separate body/header/public/time traps. Its history API emits actual native events. Fixture-only code triggers child history while the original fixed-reader watcher and verifier are active; production fixed script still executes only against the main document. The iframe trap content is absent from the original anchor artifact, and matching fresh evidence preserves the same body hash.

| Native scenario | Result |
|---|---|
| iframe-loading | REOPEN_MATCH; child history observed during NAVIGATING, main URL EXACT/owner SAME/generation 1 |
| iframe-read | REOPEN_MATCH; child history observed during READING through both watchers |
| iframe-main-change | INCONCLUSIVE / ROUTE_CHANGED; presence of child history does not excuse main history change |
| iframe-barrier | Child history NO_OP, then INCONCLUSIVE / CHALLENGE; main barrier remains effective |
| stop | INCONCLUSIVE / STOPPED; no read, native pending fence and consumed anchor remain enforced |
| full-same | INCONCLUSIVE / ROUTE_CHANGED with FULL_NAVIGATION_DURING_READ; exact same URL does not exempt a full navigation |

Saved native traces were checked for ≤16 entries, NOT_APPLICABLE child URL, exact main context on no-op entries, correct phase, and no raw URL/body/identity. Each scenario requested one observed-route reopen and ended with zero remaining windows/webContents. Fixtures use local protocol responses and shared-start/immutable-anchor assertions; no real source request or user session operation was performed by the reviewer.

Final hashes:

- Verifier source: `ab0e8943ef71c9b4471a8b98eeadf26e522cd86c4c951718d8b2fe1da1b37b9b`.
- Verifier compiled: `84657c05fa61115f4c6e6e85489d02a140b12d8207c851d8f541f76a447397f6`.
- Menu source: `332d18e7eff9d1ddf23f030d48bd436571eb755aa799120d7daea31403f4ae8d`.
- Reader compiled unchanged: `d2309718815267a5bbd4bddb5728f172a9c07d1f0b81d71c50403f4997eb5558`.
- Fixed current-post script unchanged: `613d6e954927f34539ce25c86e7332c7fb5c496ba8755f40d0733604db2aa3cd`.
- Reviewer route tests: `3cbbe924f9c5d978cdc74b384e8f260a190ed9ee61d30acf640d66a488495c24`.

Final receipt and artifact hashes: `adapter-p02-subframe-final-files-2026-10-28.json`.

**No blocker found; ready for lead activation and one bounded fresh anchor/verification.** This fixes the event class recorded in v17 under the reviewed main-context conditions. It does not prove future source success or establish the unrecorded event from v16. No relevance/identity/source/valid/gate status is promoted.
