# P02 current-post context — independent review

2026-10-28 Asia/Bangkok, reviewer `/root/csd_adapter`. Contract review only, before implementation/API freeze. Read [ADR-014](../decisions/ADR-014-single-post-context-diagnostic.md), [dispatch](../handoffs/lead-p02-post-context-dispatch-2026-10-28.md) and [lead LIVE v13/UI evidence](lead-p02-public-group-review-2026-10-28.md). No UI, source session, runtime, shared build, credentials, source edits or gate changes.

## V14 implementation review — accepted within scope

Read [handoff](../handoffs/p02-post-context-2026-10-28.md), route parser, global security-before-dialog exemption, wrapper/unique-leaf selection, own-article header/body containment, controller schema/late-result handling, and menu shared budget. Fresh strict compile in reviewer output: **8/8 independent current-post tests PASS**, followed by **84/84 unchanged search regression tests PASS** because the script implementation is shared. No actionable blocker reproduced within this scope.

`tests/facebook-current-post-review.test.ts` uses a separate bounded synthetic DOM harness with ordered XPath candidate selection for the exact security/dialog query families. It does not fabricate AX-to-DOM mapping or read a live page. Positive wrapper+inner dialog returns only POST_BODY with contact redaction and a separate UNVERIFIED string-ID context hint. Comments have their own author/date/permalink/message but cannot fill the post ID/date/body. Own conflicting permalink is rejected. Independent dialogs/wrapper content/cross-article public or body/two bodies/private/quoted marker reject. Auth/challenge/denied outside the inner context wins before any candidate extraction. Dialog sentinel, wrapper work cap, global2500 and deadline retain no partial content.

Controller tests use an in-memory sink: Stop, owner loss or changed observed post ID cannot write late body/context; summary/started omit profile/IDs/body. Schema rejects forged provenance, raw extras, contradictory hint and multiple samples. Search regression fixtures/expectations remain unchanged.

The menu's `enter()` centrally checks active/nativePending and increments one `runs` counter before metadata/search/current-post starts; the wrapper around execute retains native capacity until settlement. `stop()` invokes all engines. This combined-three-start guarantee was reviewed in source; the reviewer Node harness does **not** execute Electron Menu. Owner/lead native combined-budget evidence supplies that integration coverage. There is no claim of a new independent native run here.

[Frozen manifest](p02-post-context-files-2026-10-28.json): **15/15 owned hashes match before and after checks**; search/current fixed scripts and compiled controller all match. Owner sources were stable. Reviewer did not modify owner source, shared dist, runtime, session, credentials, master or gate. Lead may proceed with activation and one current-post diagnostic read; this result does not verify live identity/publicity/yield or benchmark eligibility.

| Snapshot | SHA-256 |
| --- | --- |
| Script source | `dc1981610ceb8a37e0476ded6a04539cbd3442fff1c82d6a09cee26a0166d996` |
| Controller source | `dd87ed65c74bf18462495682c4955c57ef00741202caf760eedd9cc6e84db43f` |
| Fields source | `f76176df6d7de6b1f402a04bab5b16aa8b0f5200c3594cd7e9f278f45bd617cb` |
| Menu source | `8a10bf5b504ebeb719c73213299e3c51e7a90140b6da56548a21f4b1f80ea4b1` |
| Current-post reviewer source | `0c4b23ea2404525463786c27ab05a3464f0f6e6ff35423be7d0a69bce34bac0b` |
| Compiled current-post reviewer | `fc2474e620e1818ec6abba7d41464cd2f1140ed11085f3eec6b0c55148fb967e` |
| Current-post fixed script | `ed4e51967912dab472d37230103a51d42df722cd1896ae0565f876ece8e633cd` |
| Search fixed script | `8d60fece4e43d9b1705626aeb23976e412359975b4e8d6c47c2a02420d3f20fe` |
| Compiled shared script module | `2ce9bb05acf4f78fe4271750b3bacd6b94cd999d633062ab14fe63ce24b6dd50` |
| Compiled controller | `52bcc208934daa007633bc39c9300e3003e70240d02af2333ce0e6d9ffc05be4` |

```powershell
node node_modules/typescript/bin/tsc --ignoreConfig tests/facebook-current-post-review.test.ts tests/facebook-public-candidate-review.test.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022 --types node --rootDir . --outDir .test-build-adapter-candidate --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --noImplicitOverride --noFallthroughCasesInSwitch --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --noEmitOnError
node --test .test-build-adapter-candidate/tests/facebook-current-post-review.test.js
node --test --test-reporter=dot .test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js
```

## Initial contract conclusion

The authorized diagnostic is sufficiently bounded: one current post context already opened by the lead, no navigation/scroll/click from script, route-derived context hint separate from independently verified identity. It can return a useful body plus missing fields while permission/publicity/identity remain unverified and benchmark remains off. No additional Meta permission loop is needed for this diagnostic contract.

Two search snippets are not two verified unique posts. The observed group route is an identity hint from UI, not proof that a generated canonical URL resolves to the same article. No real ID/body/author/URL is copied into this review.

## Implementation boundaries to verify

1. **Unique post dialog, including wrapper.** Bounded enumeration must distinguish exactly one inner post context from two independent post dialogs; a first-match selector cannot establish uniqueness. An outer dialog may only wrap the unique content context when it has no independent post body/header. A sentinel beyond the inspection bound means incomplete, not unique. A dialog title such as a post title is not by itself the author/publicity header proof; title and source header can be separate structural regions.
2. **Barrier precedence.** Known auth/challenge/denied markers must be checked before exempting the content dialog, including markers in an outer wrapper or sibling overlay. Incomplete barrier inspection stays incomplete. The exception cannot become a blanket permission for every dialog or alert.
3. **Route and provenance.** Accept only the supported HTTPS Facebook group path and exactly one string post ID in `multi_permalinks`; reject duplicate decoded parameter names, lists/separators, missing IDs, unsupported path/origin and malformed ID syntax. Never use JavaScript Number for IDs. Store a tracking-free observed route/context hint with UNVERIFIED status; do not fill a verified permalink field. A conflicting identity from a separate post or comment cannot upgrade or replace the route hint.
4. **Single body ownership.** Read only the selected post's bounded message body. Exclude comment/thread/composer/reaction, nested story and quoted marker content before collecting text/identity/date. Missing/ambiguous body is an explicit failure or missing field according to the finalized API, not permission to read whole-dialog innerText. Unbounded date remains nullable; comment timestamps cannot supply it.
5. **Shared lifecycle budget.** Search and current-post actions must share three starts per process, active-owner/Stop behavior and output limits. Two controllers each allowing three starts would violate ADR-014 even if each passed its own unit tests. Late completion after navigation, frame/generation loss or Stop cannot write a body/context hint for a new session.

These are acceptance boundaries, not findings against code that has not been frozen.

## Small fixture set after API freeze

- Positive: one outer wrapper + one inner post dialog, exact public-group source header, one message and separate comments. Expect at most one body snippet; context IDs remain strings/hints; no comment text, permalink or date contaminates output.
- Ambiguity: two independent post dialogs; wrapper with its own body; second post marker inside the chosen context. Expect no mixed snippet and no assertion of unique root.
- Route table: supported one-ID route; duplicate `multi_permalinks` including encoded parameter name; comma/list/encoded separator; missing/empty/oversized ID; wrong origin/path. No raw input URL in summary.
- Barrier precedence: same positive content plus password/challenge/denied marker in wrapper or sibling. Expect barrier stop before payload, even when post dialog is otherwise valid.
- Scope/limits: private/missing/partial public signal; comments with convincing IDs/dates; body/global scan cap; Stop/owner change/late result; combined search+post start capacity. Use existing test seams where possible instead of creating a second framework.

Reviewer has sent these points to lead and is waiting for code-ready/API freeze. No broad test suite written yet; no live source claims.
