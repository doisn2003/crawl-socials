# Current-post security XPath — optimized and frozen

P02.02, 28/10/2026 Asia/Bangkok. Worker LIVE reads0; source/runtime/shared dist/master unchanged. Code-ready for independent performance/security review, then lead activation. Schema remains search13/current-post14; controller, guards and limits unchanged.

**Reproduced the LIVE failure offline.** Native Electron44.7.0/Chromium152, Windows x64; same synthetic DOM for frozen accepted v14 and optimized script: 4,500 unrelated cards, 27,000 elements, 22,500 text nodes, 1,125 unrelated aria labels, followed by fixed-position post dialog. The recorded paired run (other offline checks running on this host):

| Stage/outcome | Frozen v14 | Optimized |
| --- | ---: | ---: |
| Predicate preparation | 0.7ms | 0.4ms |
| Global security XPath | 1078.0ms | 98.4ms |
| Dialog XPath | 17.8ms | 10.8ms |
| Whole isolated read incl IPC | 1099.7ms | 117.1ms |
| Result | TIME_LIMIT, visited0 | SAMPLES_READY, 1 candidate/72 steps |

These are local synthetic measurements, not a guarantee for every Facebook DOM. Stage instrumentation exists only in the offline fixture and does not change the production payload/schema/budget.

**Change and equivalence.** Only normalize existing aria-label/title attributes; missing attributes previously normalized to empty, which matches no phrase. Deduplicate phrase literals after their existing case normalization. Replace repeated OR equality with exact delimited-set membership, normalizing/translating once per attribute/text. Every phrase is nonempty and contains no `|`; inputs containing `|` are rejected before membership, so a match cannot span phrases or admit prefixes/suffixes/joined phrases. Empty input cannot match because the set has no `||`. The normalization/case mapping is unchanged. Thus the matching node set and document order remain identical; the same union and16+1 sentinel still apply globally. No fuzzy/subphrase acceptance.

**Proof/checks PASS.** Native predicate comparison: **517 cases,0 node-set/order mismatches,0 expected-match mismatches**, including text/aria/title, neutral aria plus security title, Vietnamese/uppercase/XML whitespace, prefixes/suffixes/empty/pipe joins, and18 matching nodes returning the17-node sentinel. Three visible end-of-large-DOM markers after the permitted dialog independently produce AUTH_REQUIRED (password), CHALLENGE (uppercase title with unrelated aria label), ACCESS_DENIED (text); each0payload/0hint. Combined process start budget still blocks a subsequent search action. Existing native context3/barriers3 also PASS. Owner tests28 PASS (18 search +10 post; security overflow case added to cap table). Native outcomes total11:2 paired offline reads +9 menu-action regression/barrier cases. External network0; windows/webContents0 after close.

Run `node scripts/facebook-dom-diagnostic-build.mjs`, `node scripts/facebook-public-candidate-smoke.mjs --post-performance --output <summary.json>`, plus existing `--post-context`/`--post-barriers`. The isolated build copies the hash-checked accepted v14 script from `tests/fixtures/facebook-current-post-v14-script.json` solely for this offline comparison. No baseline code is selected by the production menu.

Evidence: `p02-post-performance-{native,context,barriers}-2026-10-28.json`. Frozen owner/build/script/controller hashes: `p02-post-performance-files-2026-10-28.json`. Reviewer should check exact membership/attribute filtering, end-of-DOM guards/sentinel and paired workload; lead then tries one current-post action. Permission UNKNOWN, benchmark OFF, valid0; no source AVAILABLE or gate claim.
