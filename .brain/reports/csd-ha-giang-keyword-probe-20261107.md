# Hà Giang keyword probe — 2026-11-07

Status: delivered the recorded keyword inventory; stopped at the authorized 10-call ceiling and closed the spending envelope. No social collection or post classification occurred.

## Request and evidence

The user asked whether the hidden Electron collection problem was fixed, then requested the current algorithm's actual keyword decomposition of this prompt. The user approved Gemini 3.1 Flash-Lite, at most 10 calls and USD 0.20 inclusive of repairs and expansions. Existing cumulative DEVELOPMENT accounting was reused.

> Timg người đang muốn đi du lịch Hà Giang. Tìm người đang có nhu cầu đi phượt, du lịch xe máy. Tìm bạn đồng hành đi du lịch Hà Giang, hoặc là đang tìm kiếm tour đi Hà Giang. Các bài viết hỏi về Hà giang, hỏi về địa điểm du lịch ở đó, hỏi về kinh nghiệm lưu trú, trải nghiệm, thực phẩm,... Tóm lại là tất cả những thứ gì có thể có của du lịch Hà Giang.

The prompt, including its typo, was unchanged. The runner uses production `prepareSemanticDraft` and `createCoverageExpansion`, CONSISTENT, Vietnamese, POST_ONLY, a target of 1,000 solely for calculating planner breadth, no age limit and no mandatory geography. It does not invoke collection. The plan records Hà Giang as preferred geography; this is a travel destination, not evidence of an author's residence.

## Result

| Measure | Actual |
|---|---:|
| Unique output keywords | 69 |
| Initial validated plan | 21 |
| Added by five expansion calls | 33 + 8 + 6 + 1 + 0 = 48 |
| Original source facets retained | 11 |
| Family labels represented | 17 |
| Lexical styles recorded | 4 |
| Structural minimum / preferred size | 48 / 96 |
| Actual dispatched calls | 10 |
| Measured task cost | USD 0.076236125 |
| Held / unmetered cost | 0 |
| Cumulative DEVELOPMENT | 1,781 calls / USD 2.621538167 |

The structural breadth validator reports COMPLETE; the preferred count of 96 was not reached. After the tenth dispatched call, the durable spending guard rejected the next attempted dispatch before charging it. There are eleven recorded request intentions but only ten actual billed/ledger attempts. A local finalizer exported preserved valid work without another model call and closed the monetary envelope. This is a call-limit stop, not monetary exhaustion or exhaustion of social-network search results.

Outputs, all ignored and kept outside commits:

- `artifacts/ha-giang-keywords-20261107/keywords-ha-giang.md`: full grouped list and caveats.
- `keywords.txt`: exact query strings, one per line.
- `keywords.json`: exact strings with their production metadata and provenance.
- `summary.json`, `closed-spending.json`, `runner-stop.json`: counts, original stop, accounting and closure.
- `model/model-ledger.jsonl`, `requests.jsonl`, nested `collections/.../opportunity/intent-attempts`: original requests, responses, validation failures and cost evidence.
- `finalize.mjs`: offline count/source reconciliation and export. No keywords were manually added, rewritten or selectively removed.

## Defects exposed and narrow fixes

The original source checkpoint `44a44de` did not successfully complete the prompt. Four invalid planner responses were preserved and cost USD 0.020845875 in total:

1. The model cited product-policy/system text as user CONTEXT even though CONTEXT was null. The validator correctly rejected the fabricated attribution.
2. The previous generic repair instruction could erase explicitly requested traveler roles while repairing unrelated fields.
3. After correcting evidence in a later repair, the model changed `intent_revision` from 1 to 2. The validator again correctly rejected it.

Fix `4cb65bc` makes opportunity-mode repair target the reported evidence/schema errors, keeps the explicitly requested roles, and forbids treating policy as user statements. Fix `973694e` reinforces that existing source contract on the initial wire request and binds the response revision to the input through the request schema. Legacy semantic behavior and canonical saved recipe identity remain readable. Raw failed responses were not edited or accepted retroactively.

The fifth planner call succeeded and the existing validator produced the 21-query initial campaign. The subsequent five calls used the existing expansion algorithm without manual keyword changes. The delivered result therefore belongs to production-v2 at `973694e`, after these disclosed protocol fixes; it is not a successful unchanged-baseline result.

Validation: focused 27/27 tests passed; `npm run check` passed; full `npm run test:unit` passed 1,100/1,100 with no failures, cancellations or skips. Tests use mocks/local data and zero paid calls. Test counts demonstrate regression checks, not semantic keyword precision.

## Semantic findings still open

Useful, specific output examples include `phượt HG 3n2d`, `tìm người ghép đoàn đi Hà Giang`, `homestay nào đẹp ở Đồng Văn`, `ăn gì ngon ở Hà Giang` and `review cung đường đèo Mã Pí Lèng`.

However, the current inventory also contains literal source fragments such as `Timg người đang muốn đi du lịch Hà Giang`, `hỏi về địa điểm du lịch ở đó`, `trải nghiệm` and `thực phẩm`. The literal fallback preserves source-facet accounting but does not reliably turn those facets into useful standalone search queries.

Expansion accepts generic contexts such as `cần giải tỏa áp lực công việc`, `ai đi cùng mình không` and `hỏi về thời tiết hiện tại`. Their model rationale names a relevant branch, but the actual independent search string does not necessarily retain travel or Hà Giang. Family and lineage validation are insufficient evidence of semantic grounding. Broad motorcycle/travel intent can legitimately be part of the user's scope; destination-dependent food, lodging and local-information branches need more context than an isolated generic phrase.

Later expansion waves yield progressively less new valid work. Across 240 returned slots, 48 new queries were accepted; the rest failed local checks including duplicates. More repeated calls to this unchanged expansion pattern would not establish wider useful coverage. No retrieval precision/recall or post-volume claim can be derived from this planning-only probe.

Follow-up direction, not implemented or paid-tested in this probe: separate preserved source facets from executable queries; preserve destination dependencies when rewriting dependent branches; distinguish anchored query variants from explicitly broad exploration; and direct subsequent waves toward genuinely missing subject matter instead of repeatedly filling the same buckets. Do not satisfy a count by padding generic terms or manually editing the recorded benchmark.

## Electron status

The earlier A–CONSISTENT result is independent evidence: the hidden-view integration defect was fixed with offscreen rendering, real Facebook/Threads pagination was verified, and the final export contained 1,000 unique accepted roots out of 2,143 raw and 1,113 accepted. Of the exported roots, 295 were retained and 705 newly collected. See [the completed recovery report](csd-cafe-discovery-recovery-20261106.md).

The defect was in CSD's use of hidden Electron views, not proof that Electron as a whole cannot collect enough posts. The fixes and this probe remain on production-v2. No portable executable was repackaged and no production promotion was performed in this task.
