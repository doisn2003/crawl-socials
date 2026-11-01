# Manual comment-value audit: development pilot

On 2026-10-30, an independent agent manually read all 24 pilot root posts and all 227 captured comments. No Gemini calls or production database writes were made. An isolated external ConversationStore rebuilt immutable snapshots from the existing observation file. The original source hash is recorded and verified.

This is a purposive development capability sample, **not a fresh holdout or a production precision/recall benchmark**. All 24 roots must be excluded from the final fresh evaluation sample.

| Platform | Roots | Captured comments | Suitable from post alone | Suitable with observed comments | Added opportunities |
| --- | ---: | ---: | ---: | ---: | ---: |
| Threads | 12 | 112 | 3 | 4 | 1 |
| Facebook | 12 | 115 | 2 | 4 | 2 |
| Total | 24 | 227 | 5 | 8 | 3 |

Two Facebook additions are clear: one sparse check-in gains concrete questions about food availability and the address; one brand advertisement gains a specific customer complaint and a request for a 24-hour venue that the observed brand reply does not satisfy. Exact comment text, evidence-span IDs, action targets and parent chains are retained privately. The Threads addition has clear location questions, but the thin post's boundary between generic praise and a substantive review is less certain; treat the two Facebook cases as the stronger causal examples.

The audit also found useful negative controls. Real questions about rental or transfer prices belong to business transactions, not a customer's need to visit a café. A café advertisement has two captured comments with empty text, which provide no readable intent. Several apparent questions already have answers in the captured parent/reply chain. Generic tags, invitations, vendor promotion and off-topic questions do not automatically create a qualifying conversation.

The rubric preserves substantive consumer reviews without requiring existing comments. The two manual reviews agreed on 23 of 24 post-only/with-comments label pairs. The single disagreement concerned a dining-only birthday-date request: root adjudication applies the current café-search scope, so the post is unrelated; a café provider's promotional reply changes the combined record to research-only, not suitable. The initial broader dating-venue interpretation is preserved privately. Final counts are therefore **5 suitable post-only and 8 with comments**, still three additions. A mixed business-case/review post and a partly answered event discussion have explicit boundary notes. These judgments should not be converted into human gold or used to claim population uplift.

Coverage remains limited: 12 roots are `PARTIAL`, 8 are `EXHAUSTED_VISIBLE`, and 4 are `OBSERVED_EMPTY`. Three partial captures also report `has_more=false`; the partial status and step-budget stop reason take precedence over assuming completeness. Two roots advertise comments but have none observed. Three captured comment entities have empty text. Every captured comment parent is present in this pilot's reconstructed snapshot, allowing the annotated reply chains to be checked. No image/video content was inferred. Historical text and absent replies cannot establish current freshness, posting access or whether an unobserved reply has resolved a need.

Private artifacts are outside the repository at `C:\Users\Admin\AppData\Roaming\csd-desktop\data\conversation-capability-pilot-20261030\manual-comment-audit-v1`:

- `manifest.json`: frozen source hash, observation cutoff and 24 snapshot IDs.
- `annotations-adjudicated-private.jsonl`: final manual labels, rationale, exact evidence and parent chains.
- `annotations-private.jsonl`: original annotations, preserving the broader dating-venue alternative.
- `scope-adjudication-private.json`: the one scoped disagreement and root adjudication.
- `snapshots-private.jsonl`: immutable reconstructed inputs.
- `summary.json`: sanitized counts and limitations.
- `holdout-exclusion-keys.json`: platform/root pairs to exclude from final evaluation.

Evidence validation checks every saved quote, parent relationship, span offset and action target against the frozen snapshots. The original observations and live campaign data remain untouched.
