# Conversation opportunity filter v2: measured calibration

As of 2026-10-30. Filter `conversation-opportunity-v2.0.3`, Gemini `gemini-3.1-flash-lite`. This is a completed calibration on an already-seen historical sample, **not a production release gate**. The goal remains 1,000 suitable root posts total, with Threads:Facebook 80:20 or 70:30.

## Reference and scope

The frozen reference has 300 posts (150 per platform), 158 preserved human anchors and 142 previously unlabeled records completed by AI. Two independent prompts used the same small model; a third pass adjudicated 77 disagreements/human conflicts/audit cases. The agent independently reviewed all 20 model disagreements and 30 random agreements (50 distinct records), with 16 overrides. This is an AI-adjudicated reference with an independent agent audit, **not human gold**. Model-family correlation remains a limitation.

All reference text is frozen post-only historical data. No later comment or current interpretation of a deleted/changed post is retroactively added. This sample cannot certify comment collection, comment-driven opportunities, freshness, discovery recall, or network-wide yield.

Private artifacts remain outside the repository at `C:\Users\Admin\AppData\Roaming\csd-desktop\data\benchmarks\coffee-intent-20261030\conversation-reference-v2`. Canonical reference: `reference-final-agent.jsonl`; immutable source hashes and IDs: `manifest.json`; audit: `agent-audit-summary.json`; final predictions: `classifier-predictions-v2.0.3.jsonl`; metrics: `calibration-metrics-v2.0.3.json`. Original human workbook unchanged.

## Final calibration result

| Metric | Facebook | Threads |
| --- | ---: | ---: |
| Evaluated posts | 150 | 150 |
| Reference suitable | 39 | 58 |
| Model accepted | 38 | 60 |
| True positive / false positive / false negative | 31 / 7 / 8 | 53 / 7 / 5 |
| Precision against this reference | 81.58% | 88.33% |
| Recall within this sample | 79.49% | 91.38% |
| Accepted output yield | 25.33% | 40.00% |
| Technical pending/failed | 0 | 0 |
| Related records wrongly marked unrelated | 2.80% | 15.20% |

Precision does not reach 90% on either platform. Facebook recall does not reach 85%. Wilson 95% precision intervals are 66.58–90.78% (Facebook) and 77.82–94.23% (Threads), descriptive only because the sample and reference are not an independent representative production holdout. Preserve every raw record, including unrelated decisions, so research misclassifications remain recoverable.

The initial long-output classifier had severe false negatives on consumer reviews. The final version emits only snapshot ID, atomic case code, evidence IDs and a short explanation; software derives class/need and the action target from the first evidence span. Substantive consumer reviews qualify without requiring a question; sparse check-ins and provider promotions remain research unless an observed consumer exchange qualifies. This iteration improved calibration, but further tuning on these same labels cannot establish a release gate.

## Cost and bounded planning assumptions

Actual v2.0.3 usage: 38 requests, 181,111 input tokens, 39,791 output tokens, zero thinking/cache tokens; **$0.10496425** at the recorded list prices. No unknown usage occurred in this final run. This is token usage priced at Google's published rates, not an invoice reconciliation.

That is $1.071 per 1,000 model-accepted records if this exact mixed sample workload repeated. Approximate allocation of batch cost by record count gives $1.434/Facebook and $0.841/Threads per 1,000 accepted: **$0.960 at 80:20**, **$1.019 at 70:30**. These are conditional budgeting scenarios, not measured production cost or a promise of 1,000 genuinely suitable records. Applying observed sample yields would require approximately 2,789 raw records for 80:20 or 2,934 for 70:30 before any verifier rejection. Fresh queries/comments may change both yield and token cost materially.

Before verifier ablation, offline reference passes and calibration iterations consumed $0.565916275 known cost plus $0.05203525 conservative upper bound for unresolved timeout/interrupted attempts. Including verifier and primary-model ablations below: **$0.634743775 known + $0.18097375 conservative unknown upper = $0.815717525 total upper**, within the $1 offline allocation. Smoke diagnostics separately cost $0.00327725. Offline labeling is separate from the recurring $3/1,000 runtime objective. Cached results retain their original cost metadata: use the gateway ledger summary rather than summing cached result prices again.

## Optional verifier recommendation

Use an evidence-focused second pass only on tentative suitable decisions before delivery. Verify concrete consumer intent/experience, provider versus consumer voice, exact action-target evidence, parent/comment context, and explicit constraints. Keep substantive reviews; do not require a question. Missing context/technical failure stays pending. Related promotion or check-in stays research. Do not send first-pass reasoning to the verifier as truth.

Read-only `models.list` with the current key returned HTTP 200 and advertised `generateContent` support for `gemini-3.5-flash-lite`, `gemini-3.8-flash`, and `gemini-2.5-flash`. Actual generation availability differed, as measured below. Official standard prices on 2026-10-30: 3.5 Flash-Lite and 2.5 Flash $0.30 input/$2.50 output per million; 3.8 Flash $0.75/$3.75 through 2026-12-31, then $1.50/$7.50 from 2027-01-01. [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).

The pre-ablation planning assumption was 700 input plus 150 output tokens per candidate: verifier-only cost $1.0875/1,000 candidates for 3.8, or $0.585 for 3.5. At an assumed 90% verifier survival, primary plus 3.8 would be roughly $2.27–$2.34/1,000 delivered, before planner/comment overhead and retries. **Observed results do not justify those survival or availability assumptions.** Reserve part of the same $3 total before production verification, pause on exhaustion, and never weaken labels to reach the target.

Gemini 3.8 requires `low` thinking or above and rejects `minimal`; deprecated sampling parameters must be omitted. The gateway handles this model separately. Its thinking tokens count toward the assumed output allowance and may exceed 150 tokens per candidate substantially. The current estimate must not be treated as a cap or observed 3.8 usage. [Google 3.8 migration requirements](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.8).

The optional `verifyTentativeOpportunities` function returns original and verified decisions for audit, never promotes a first-pass rejection, and marks invalid/missing evidence, missing snapshots, changed campaign or budget failures pending. Runtime integration remains optional, with the shared production budget managed by the parent pipeline.

### Bounded real verifier ablation

Selected 32 primary-accepted historical candidates by fixed SHA256 order, 16 per platform, before running alternatives. Same frozen snapshots and AI reference; reference labels and primary reasoning were not sent to the verifier. No prompt/reference tuning followed. Artifacts: `verifier-ablation-v1/report.json`, `verifier-ablation-2.5-v1/report.json` under the private reference directory. This accepted-only sample measures conditional retention, not recall over raw discovery.

| Model/platform | Initial TP / FP | Retained TP / FP | FP removed | New FN | Pending | Precision after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 3.5 Flash-Lite / Facebook | 12 / 4 | 5 / 1 | 3 | 7 | 0 | 83.33% |
| 3.5 Flash-Lite / Threads | 15 / 1 | 15 / 1 | 0 | 0 | 0 | 93.75% |
| 3.8 Flash / Facebook | 12 / 4 | 0 / 0 | 0 | 0 | 16 | Unknown |
| 3.8 Flash / Threads | 15 / 1 | 0 / 0 | 0 | 0 | 16 | Unknown |
| 2.5 Flash / Facebook | 12 / 4 | 0 / 0 | 0 | 0 | 16 | Unknown |
| 2.5 Flash / Threads | 15 / 1 | 0 / 0 | 0 | 0 | 16 | Unknown |

3.5 Flash-Lite completed four calls: 17,107 input and 4,359 output tokens, no thinking/cache tokens; **$0.0160296 actual priced usage**, or $0.501/1,000 candidates on this workload. It retained only 41.67% of the Facebook true positives and removed no Threads false positives. That loss is too high to enable it by default based on this evidence.

3.8 Flash produced no valid decisions: five attempts ended with HTTP 503/no usage, including a timed-out attempt, then the $0.15 shared ablation cap prevented further calls. Measured priced usage is unavailable, not free: conservative unknown upper **$0.1289385**. 2.5 Flash returned HTTP 404 `MODEL_NOT_AVAILABLE` on its first request despite appearing in model discovery, then the gateway stopped network calls; priced cost $0. Technical failures are not semantic rejections or evidence of zero quality.

**Decision: leave the optional verifier disabled for now.** Use the primary classifier for collection and an independent agent audit on fresh outputs before delivery. Neither this calibration nor the unsuccessful verifier alternatives establish the production precision gate.

### Separate primary-model comparison: unchanged classifier prompt

To distinguish model behavior from the strict verifier strategy, a second fixed SHA256 sample selected 50 Facebook and 50 Threads records across all reference labels. Gemini 3.5 Flash-Lite ran the unchanged `conversation-opportunity-v2.0.3` classifier prompt. Its predictions were compared with already-recorded 3.1 predictions for the exact same 100 IDs. No 3.1 API calls, prompt edits or label changes were made. This remains historical model-selection evidence, not a fresh release gate.

| Platform/model | TP / FP / FN | Precision | Recall | Accepted / raw | Technical failures |
| --- | ---: | ---: | ---: | ---: | ---: |
| Facebook / 3.1 Flash-Lite | 12 / 3 / 4 | 80.00% | 75.00% | 15 / 50 | 0 |
| Facebook / 3.5 Flash-Lite | 12 / 1 / 4 | 92.31% | 75.00% | 13 / 50 | 0 |
| Threads / 3.1 Flash-Lite | 18 / 4 / 0 | 81.82% | 100.00% | 22 / 50 | 0 |
| Threads / 3.5 Flash-Lite | 18 / 3 / 0 | 85.71% | 100.00% | 21 / 50 | 0 |

Paired outcomes: 3.5 removed three false positives and introduced none; it recovered one true positive and lost one other, so net recall was unchanged. This small difference supports testing 3.5 as a **primary classifier**, not enabling the stricter verifier. Facebook recall and Threads precision still miss the proposed thresholds; small sample sizes and correlated AI reference errors remain material.

3.5 usage: 13 calls, 60,793 input tokens, 13,824 output tokens, zero thinking/cache tokens; **$0.0527979 known cost**, no unknown usage. Conditional cost is $1.553/1,000 model-accepted records for this sample workload. The matching 3.1 subset has an estimated $0.0351183125 cost allocated proportionally from original eight-record batches, approximately $0.949/1,000 accepted; it was not metered as a separate 100-record run. Raw token volume, comments and discovery yield may change production costs. Private artifacts: `primary-3.5-ablation-v1/manifest.json`, `predictions-private.jsonl`, `model/model-ledger.jsonl`, and `report.json`.

The planner now emits two-to-five-word lexical anchors. Code drops generated query terms absent from explicit user context plus a generic discovery vocabulary; it preserves supplied seeds and never truncates sentences. This prevents invented cities/brands in search queries at the cost of dropping unsupported synonyms. The literal fallback remains explicitly literal. Planner purpose is `campaign-planner-v1.1-grounded-short`.

Next gate: freeze a fresh set including posts with comments; use blinded independent agent review and report precision, recall, verifier rejection/retention, source mix and full ledger cost. This historical calibration must remain separate.

## Validation

TypeScript test compilation passed. The gateway/classifier/planner/verifier/metric suite covers durable budget reservations, unknown usage, duplicate-call coalescing, key secrecy, evidence/action validation, comment opportunities, technical failures, total target, short grounded search queries, fail-closed verification and metric denominators. Live smoke validated a generic planner and five synthetic classifier boundary cases. Semantic production accuracy remains an empirical question.
