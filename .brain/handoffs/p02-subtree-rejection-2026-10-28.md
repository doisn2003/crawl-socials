# Subtree first rejection facts — frozen

28/10/2026 Asia/Bangkok. Implements [the lead dispatch](lead-p02-subtree-rejection-dispatch-2026-10-28.md) after v23 LIVE reported UNSUPPORTED without a specific failpoint. Worker source/UI/LIVE reads0. Shared runtime/dist/profile/master/README/reviewer files untouched. No automatic hover, pointer action or popup-policy change.

## Metadata contract

Opening schema is now **5**, operation envelope remains1. Actual guard shapes add `subtree_reason`, `subtree_tag`, `subtree_attr`, `subtree_depth`; preflight adds matching `pf_subtree_*` fields. Existing subtree kind and first decisive eligibility stage remain. Facts from the actual classifier call are cached with its result and copied to preflight, without traversing again. Earlier-rejected HREF-qualified records still receive their read-only preflight classifier facts.

Each classifier call records only its **first rejecting branch**. NONE means a completed passing classifier; NOT_CHECKED means the classifier was not reached. Reasons distinguish HTML/SVG tag or namespace, attribute allowlist/namespace/value/API/limit, style API/URL/effect, clip/glyph/fill, structural limits, shared node/time exhaustion and exception. Exception messages are never emitted. No raw tag/attribute name is persisted: fixed lists cover common HTML/SVG tags, CLASS/STYLE/ROLE/ARIA_HIDDEN/ARIA_LABEL/ARIA_LABELLEDBY/ID and supported SVG/CSS property names. Unknown names map to OTHER, ARIA_OTHER, DATA_ATTR or ON_EVENT categories. Depth is a closed D0–D8/OVER_8 enum, plus NONE/UNKNOWN/NOT_CHECKED; D0 is the target itself.

Instrumentation consumes already-read traversal facts, retaining only bounded private node context for later wrapper/target style checks. It does not add DOM traversal or change the attribute/tag/style whitelist, fill proof, eligibility, target policy, candidate state, clip cache or native actions. Original32node/8depth/160text/12attribute/8rect limits and shared2500steps/1s remain.≤5 aggregated shapes,32KiB output and final R-PF1 binding/click budget guards remain. The strict validator rejects arbitrary reason/tag/name/depth strings, extra/raw fields and prior size/counter violations.

## Evidence and tests

Isolated build PASS. **26 focused owner tests PASS**. New complete-script cases compare against the accepted fixed v23 DISCOVER projection and check first failpoint for DIV, SPAN aria-hidden/aria-label/aria-labelledby, data attributes, unknown tags, style attributes and namespace errors, including BLANK/preflight. Recorded tag/name/depth are closed; synthetic private values never appear. Existing ink, raw target160/161/2048, stale, owner/Stop/barrier and full-script deadline/node-cap tests remain passing. Direct classifier tests also retain incomplete structural-limit facts. Default search/current-post accepted hashes are unchanged;46 unchanged reader/verifier regressions were not rerun.

**6 native scenarios PASS**, each compares status/limit flags/targets/first-rejection counters and header eligibility against the hash-pinned v23 baseline before normal execution:

- DIV wrapper: UNSUPPORTED with HTML_TAG / DIV / NONE / D1;0click/read.
- SPAN wrapper with class then aria-hidden then id: UNSUPPORTED with ATTR_NOT_ALLOWED / SPAN / ARIA_HIDDEN / D1, proving first attribute rejection rather than a later id;0click/read.
- Both counterparts with target BLANK retain first stage NEW_WINDOW, actual subtree facts NOT_CHECKED and the same precise facts in preflight;0click/read.
- Native visible SVG text keeps UNIQUE_HEADER_POST_LINK and1click/1read with exact original href.
- Deadline reached in CLICK preflight remains SCAN_INCOMPLETE and0click/read, preserving original eligibility history.

All native cases: external/source network0, windows0/webContents0 after close and one initial search request (no placeholder reload). The baseline is `tests/fixtures/facebook-search-open-v23-scripts.json`, discovery SHA `ba67d8fb3c204b7708b815cdd85b9dfd2e96f6077599856bfa147c7f2cb14f7c`; build helper copies it only into isolated resources. No real Facebook tag/attribute failpoint is asserted from these fixtures.

Evidence: `p02-subtree-rejection-{wrapper-tag,wrapper-attribute,wrapper-blank-tag,wrapper-blank-attribute,svg,time}-2026-10-28.json`. Manifest: `p02-subtree-rejection-files-2026-10-28.json`. Reproduce with the existing isolated build/owner tests and smoke `--search-post-open --search-case=observed-<case>`.

Ready for independent review and one lead facts run. Permission UNKNOWN, benchmark OFF, valid0 and source/candidate/identity UNVERIFIED; no action scope or gate change.
