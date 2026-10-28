# P02.02 — Independent current-post performance review

## Frozen v14 baseline, 2026-10-28

Scope: local synthetic DOM in hidden Electron only. No real Facebook request, session, source content, credentials, shared build, or implementation changes. This is a performance reproduction, not source availability or benchmark evidence.

- Dispatch: `../handoffs/lead-p02-post-context-performance-dispatch-2026-10-28.md`.
- Live observation being investigated: `lead-p02-post-context-review-2026-10-28.md` reported TIME_LIMIT before body inspection; there was no measured live XPath stage timing.
- Harness: `tests/fixtures/reviewer/current-post-performance.mjs`.
- Exact frozen module: `.test-build-adapter-candidate/v14-performance-baseline/src/main/facebook-public-candidate-script.js`.
- Exact current-post script SHA-256: `ed4e51967912dab472d37230103a51d42df722cd1896ae0565f876ece8e633cd`.
- Harness SHA-256: `9a159a7d2a658fb3a07fd6a005c04505c0a46dd7469eefbd98d6e66fc0a3184b`.
- Machine runtime: Electron 44.7.0 / Chromium 152.0.7977.130, Windows. One measured pass per case; figures are observations, not stable latency guarantees.
- Full sanitized results and per-case HTML fixture hashes: `adapter-p02-post-performance-v14-2026-10-28.json`.

Command, from repository root:

```powershell
node tests/fixtures/reviewer/current-post-performance.mjs
```

The harness serves only its exact synthetic URL through a temporary in-memory session protocol handler. HTTP/HTTPS requests outside the fixture are blocked and counted. It loads a neutral main area followed by an outer/inner post dialog; every neutral row adds three elements and two text nodes. A temporary wrapper measures each actual native `document.evaluate` call and restores the API after the unchanged frozen script completes. The output retains timings, counters and hashes; no body, author, ID or raw DOM is returned.

| Case | Neutral rows | Whole script ms | Security XPath ms | Dialog XPath ms | Result |
|---|---:|---:|---:|---:|---|
| Small positive | 32 | 9.4 | 2.4 | 0.1 | SAMPLES_READY, 1 sample |
| Large positive | 12,000 | 667.8 | 656.7 | 9.8 | SAMPLES_READY, 1 sample |
| Late auth, sibling | 12,000 | 672.4 | 671.9 | — | AUTH_REQUIRED, 0 samples |
| Late auth, wrapper | 12,000 | 708.8 | 708.2 | — | AUTH_REQUIRED, 0 samples |
| Late challenge text | 12,000 | 627.6 | 626.8 | — | CHALLENGE, 0 samples |
| Late denied attribute | 12,000 | 636.5 | 636.0 | — | ACCESS_DENIED, 0 samples |
| Extra-large positive | 24,000 | 1,275.3 | 1,258.1 | 16.8 | INCOMPLETE / TIME_LIMIT |
| Extra-large late challenge | 24,000 | 1,470.3 | 1,470.0 | — | INCOMPLETE / TIME_LIMIT |
| 17 hidden security candidates | 200 | 10.5 | 9.9 | — | INCOMPLETE / CANDIDATE_LIMIT |
| 17 dialog candidates | 200 | 10.4 | 9.9 | 0.2 | INCOMPLETE / CANDIDATE_LIMIT |

Both 24,000-row cases reproduce `visited=0`, `inspected=0`, `samples=0`, `timeLimit=true`, `nodeLimit=false`: native XPath consumes the time allowance before budgeted barrier inspection. Security XPath accounts for about 98.7% of the extra-large positive's measured time. This proves the bottleneck on the synthetic workload and matches the shape of the LIVE failure; it does **not** establish that all LIVE latency has the same cause.

The 12,000-row cases establish that security markers at the end of the DOM, including inside the outer wrapper, still take priority over a readable post. The extra-large challenge remains fail closed on time exhaustion. Both overflow cases remain fail closed with the existing 16-candidate/17th-sentinel rule. The run observed zero external requests and zero remaining windows/webContents after close.

Harness development notes: initial local attempts did not produce an evidence artifact because a top-level await blocked Electron readiness, and a later attempt exited before writing its report on window close. Those were corrected in this reviewer harness. Only the successful artifact above supplies the baseline numbers; partial runs are not evidence.

Next: retain the same harness and per-case fixture hashes, run the owner’s frozen optimized script, compare stage timings and security/uniqueness/sentinel outcomes, then run affected reviewer regressions. No cap increase or runtime activation is authorized to this reviewer. Await owner code-ready through lead.

## Optimized snapshot — independent review PASS

Reviewed the frozen handoff `../handoffs/p02-post-performance-2026-10-28.md` and manifest `p02-post-performance-files-2026-10-28.json`. All **16/16 owned hashes match before and after this review**. Compiled diff against the frozen v14 baseline changes only the security phrase/predicate construction; barrier processing, dialog uniqueness, candidate extraction, controller and budgets are unchanged.

Exact-set assessment: the original case-normalized duplicate constants collapse to the same seven phrases. The existing `normalize-space` and case translation remain identical. Absent attributes previously became an empty string, which matches no phrase, so checking attribute existence first preserves the selected nodes. Each set item is nonempty, contains no pipe, and is enclosed by pipes; matching inputs containing a pipe are rejected. Consequently empty strings, prefixes/suffixes, or joined phrases cannot acquire a match through `contains`. Union document order and the 17-node snapshot sentinel are preserved. Owner’s actual native predicate-equivalence implementation and its 517-case artifact were read; those cases are owner evidence, not claimed as a separately executed reviewer suite.

Independent compilation and regression commands:

```powershell
node node_modules/typescript/bin/tsc --ignoreConfig tests/facebook-current-post-review.test.ts tests/facebook-public-candidate-review.test.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022 --types node --rootDir . --outDir .test-build-adapter-candidate --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --noImplicitOverride --noFallthroughCasesInSwitch --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --noEmitOnError
node --test --test-reporter=dot .test-build-adapter-candidate/tests/facebook-current-post-review.test.js .test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js
node tests/fixtures/reviewer/current-post-performance.mjs --module .test-build-adapter-candidate/src/main/facebook-public-candidate-script.js --output .brain/evidence/adapter-p02-post-performance-optimized-2026-10-28.json
```

Result: **92/92 reviewer regressions PASS** (84 search, 8 current-post); no reviewer test expectation or harness change. This includes security priority, ambiguous wrappers/dialogs, comments and identity isolation, route changes/Stop/late results, missing APIs, and budget/sentinel guards. VM tests exercise control flow and are not used as proof of native XPath semantics or speed.

Native results use the exact same harness hash and all **10/10 matching fixture hashes**. An independent comparison asserts expected statuses, payload/hint counts, both sentinel failures and no optimized node/time exhaustion. Full comparison and final hashes: `adapter-p02-post-performance-comparison-2026-10-28.json`. Optimized raw sanitized measurements: `adapter-p02-post-performance-optimized-2026-10-28.json`.

| Case | Baseline whole ms | Optimized whole ms | Optimized security XPath ms | Optimized result |
|---|---:|---:|---:|---|
| Small positive | 9.4 | 9.0 | 0.5 | SAMPLES_READY, 1 sample |
| Large positive | 667.8 | 108.8 | 95.3 | SAMPLES_READY, 1 sample |
| Late auth, sibling | 672.4 | 85.9 | 85.4 | AUTH_REQUIRED, 0 samples |
| Late auth, wrapper | 708.8 | 98.6 | 98.0 | AUTH_REQUIRED, 0 samples |
| Late challenge text | 627.6 | 74.5 | 74.0 | CHALLENGE, 0 samples |
| Late denied attribute | 636.5 | 78.3 | 78.0 | ACCESS_DENIED, 0 samples |
| Extra-large positive | 1,275.3 | 166.4 | 148.7 | SAMPLES_READY, 1 sample |
| Extra-large late challenge | 1,470.3 | 160.6 | 160.1 | CHALLENGE, 0 samples |
| 17 hidden security candidates | 10.5 | 1.9 | 1.4 | INCOMPLETE / CANDIDATE_LIMIT |
| 17 dialog candidates | 10.4 | 1.8 | 1.5 | INCOMPLETE / CANDIDATE_LIMIT |

On this workload the extra-large positive falls from 1,275.3 to 166.4 ms; the previously timed-out late challenge is now classified before content extraction. All security outcomes retain zero payload/hint. External requests, remaining windows and remaining webContents are all zero. Measurements are separate single passes on the same host and fixtures, not a statistical benchmark or a guarantee for the live DOM.

Final hashes:

- Script source: `331a5f5a804a8e5984f8f9243e2ad2af553346c61b31e5e577da3dd53b6ef583`.
- Compiled script module: `0eecfabdd96310a5ff584658232f9d3e471ce65cd4e11b3505ded63485842c43`.
- Fixed current-post script: `613d6e954927f34539ce25c86e7332c7fb5c496ba8755f40d0733604db2aa3cd`.
- Compiled controller remains `52bcc208934daa007633bc39c9300e3003e70240d02af2333ce0e6d9ffc05be4`.

No blocker found in the reviewed performance change. Ready for lead’s bounded current-post LIVE action. This reviewer performed no real-source action or activation and makes no claim of valid posts, source availability, benchmark eligibility or gate completion.
