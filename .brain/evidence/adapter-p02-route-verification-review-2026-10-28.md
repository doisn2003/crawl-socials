# P02.02 — Independent observed-route verification review

## Preliminary snapshot, 2026-10-28

Scope per `../handoffs/lead-p02-route-verification-dispatch-2026-10-28.md` and ADR-015: source review plus six focused synthetic unit tests. No native/source UI action, profile/credentials, external request, shared build or runtime change. Final owner handoff/manifest was not available for this review phase.

Read `facebook-post-route-verification.ts`, the current-post completion callback in `facebook-public-candidate.ts`, and menu ownership/navigation/fence wiring in `facebook-dom-diagnostic-menu.ts`. The reviewed flow consumes its anchor once, binds owner/view/current route and document generation, requires one START/COMMIT pair, and binds fresh callback run plus payload/summary hashes to the returned fixed-reader result. The menu shares a three-start limit and retains its native promise fence independently of the outer operation result. These are code observations; Electron event ordering and native integration still require frozen native evidence.

Added reviewer-owned `tests/facebook-post-route-verification-review.test.ts` with six focused tests:

1. Anchor invalidation after away-return navigation and owner/view/document replacement; wrong profile does not navigate.
2. Missing, duplicate, out-of-order or same-document commit cannot start a fresh read.
3. Navigation/loss after a qualifying callback still revokes the pending read.
4. Callback must match fresh returned run ID and both artifact hashes; absent or wrong-capture callback cannot match.
5. Stop fences an unfinished navigation/read; late callback cannot seed a new anchor and a concurrent start remains busy until settlement.
6. A positive match preserves immutable input evidence, sanitized summary and all diagnostic-only/UNVERIFIED validity limits.

Compile/run:

```powershell
node node_modules/typescript/bin/tsc --ignoreConfig tests/facebook-post-route-verification-review.test.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022 --types node --rootDir . --outDir .test-build-adapter-candidate/route-preliminary --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --noImplicitOverride --noFallthroughCasesInSwitch --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --noEmitOnError
node --test .test-build-adapter-candidate/route-preliminary/tests/facebook-post-route-verification-review.test.js
```

**6/6 PASS on the preserved compiled preliminary snapshot.** No blocker found in this narrow executed snapshot. These tests use typed main-process collaborators and an in-memory sink; they do not pretend to exercise Electron navigation events, the full DOM parser or a real user session.

**Source changed during the review window:** verifier read-start hash `475a0818898d64916a733ad7716d8f6b4e87124b630273acc4084a26d49b9700`; read-end hash `386676542ca9e6cafbe7f3835a2fbc29a27b662a5321fb5a95fbb8d853dd859a`. Menu and reader hashes remained unchanged. Do not attribute the six-test result to either source hash without matching the final compilation. The executed compiled verifier is `ae9ef399f5eaa64d0683d7981e54ce5457e90dd52a1dff5330404926af6aaa6f`, retained under `.test-build-adapter-candidate/route-preliminary/`.

Full preliminary source/compiled/test receipt: `adapter-p02-route-verification-preliminary-files-2026-10-28.json`. This is **not final acceptance**. Lead was notified of the hash change; reviewer stopped further reads/runs and awaits final code-ready/manifest for a bounded diff, fresh compilation, relevant regression and native evidence review. No new source observation or gate claim.

## Final frozen review — PASS

Received `../handoffs/p02-route-verification-2026-10-28.md` and manifest `p02-route-verification-files-2026-10-28.json` dated 21:20:29 UTC. Read the final verifier and handoff, qualifying callback and native fixture. **20/20 owned hashes match before and after review**; **65/65 isolated native build hashes match before native execution**.

The final verifier source adds `owner_context` to the local verification proof: profile/view/document-generation references. It does not add those fields to the sanitized summary or change matching/navigation semantics. Freshly compiled final verifier bytes match the preserved preliminary compiled verifier, resolving that preliminary attribution uncertainty. No reviewer test expectation changed.

Final compilation/tests:

```powershell
node node_modules/typescript/bin/tsc --ignoreConfig tests/facebook-post-route-verification-review.test.ts tests/facebook-post-route-verification.test.ts tests/facebook-current-post-review.test.ts tests/facebook-current-post.test.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022 --types node --rootDir . --outDir .test-build-adapter-candidate/route-final --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --noImplicitOverride --noFallthroughCasesInSwitch --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --noEmitOnError
node --test --test-reporter=dot .test-build-adapter-candidate/route-final/tests/facebook-post-route-verification-review.test.js .test-build-adapter-candidate/route-final/tests/facebook-post-route-verification.test.js .test-build-adapter-candidate/route-final/tests/facebook-current-post-review.test.js .test-build-adapter-candidate/route-final/tests/facebook-current-post.test.js
```

**36/36 PASS:** 6 independent verification, 11 owner verification, 8 independent current-post, 11 owner current-post tests. Relevant regression coverage includes the durable qualifying-callback eligibility table, auth/challenge/denied, incomplete/cap rejection, body/comment and route-hint separation, clock/timeout, and the six additional race/ref checks above. Search/current fixed scripts retain the accepted hashes; an unrelated broad search suite was not repeated by this reviewer for this change.

Independently reran all five native route scenarios using the frozen isolated build and existing fixture runner; no owner build/source mutation. For each `CASE` in `match`, `body`, `barrier`, `redirect`, `stop`:

```powershell
node scripts/facebook-public-candidate-smoke.mjs --route-verification --route-case=CASE --output .brain/evidence/adapter-p02-route-verification-CASE-2026-10-28.json
```

**5/5 scenarios, 15/15 recorded outcomes PASS.** Each native process asserts one reopen request, immutable original anchor artifact, shared start limits, and zero windows/webContents after shutdown. HTTPS fixture responses are provided locally through the isolated session protocol handler; these are synthetic observations, not live Facebook evidence.

| Native scenario | Verification result | Reopen/read | Key evidence |
|---|---|---|---|
| Matching body | REOPEN_MATCH / MATCHED | 1 / 1 | New main-document commit, fresh run/hash linkage; technical match only |
| Changed body | REOPEN_MISMATCH / BODY_CHANGED | 1 / 1 | Different content is not accepted |
| Visible challenge after reopen | INCONCLUSIVE / CHALLENGE | 1 / 1 | Security barrier takes priority over content |
| HTTP redirect | INCONCLUSIVE / ROUTE_CHANGED | 1 / 0 | No read after redirect |
| Stop while navigation is held | INCONCLUSIVE / STOPPED | 1 / 0 | Another action is blocked while native pending; late completion leaves no reusable anchor |

Boundary conclusions:

- Anchor input remains a main-owned completion callback, not an IPC/file/URL-import interface. It runs only after both artifacts are written and qualifying sample/context evidence passes; verifier checks mode, route, owner/view, content and artifact refs again.
- Navigation uses the observed clean route exactly once in the existing owned view; commit count and generation must advance once. Redirect/same-document/extra navigation or owner loss cannot become a match. A callback is not enough by itself: the returned fresh read must bind its run and both hashes.
- Reader timeout and verification timeout/Stop remain separate from the menu's native promise fence. Returning INCONCLUSIVE does not allow concurrent native work while the underlying operation is unresolved.
- Summary remains sanitized. Local proof links original/fresh observations without modifying the original hint or artifact. REOPEN_MATCH does not upgrade source/canonical/publication validity, relevance, full text or benchmark eligibility.

Final hashes:

- Verifier source: `386676542ca9e6cafbe7f3835a2fbc29a27b662a5321fb5a95fbb8d853dd859a`.
- Verifier compiled: `ae9ef399f5eaa64d0683d7981e54ce5457e90dd52a1dff5330404926af6aaa6f`.
- Current-post reader compiled: `d2309718815267a5bbd4bddb5728f172a9c07d1f0b81d71c50403f4997eb5558`.
- Fixed current-post script unchanged: `613d6e954927f34539ce25c86e7332c7fb5c496ba8755f40d0733604db2aa3cd`.
- Reviewer route test: `4c9dbeb651c42a4513b33addab0fe84525fd9a283d23046e4edbd0e7e26d250d`.

Full final receipt and native artifact hashes: `adapter-p02-route-verification-final-files-2026-10-28.json`.

**No blocker found; ready for lead activation and one fresh anchor plus bounded LIVE route verification under ADR-015.** This reviewer has not activated a runtime, read another source sample, or changed status/gates. Dynamic content may still yield an inconclusive live result; fixtures establish the implemented behavior, not a source capability guarantee.
