# CSD — current development instructions

The user's latest instructions take precedence. The active development plan is
[ADR-025](.brain/decisions/ADR-025-cost-controlled-csd-rebuild.md), agreed in the
conversation on 2026-11-03. Older dispatch, autonomous-run and spending instructions
inside historical `.brain` sections are not current authorization.

## Cost and evidence

- The user selected **Gemini 2.5 Flash-Lite**. New implementation must use that
  model for planning and filtering. Do not silently fall back to 3.1, 3.5 or a
  more expensive model. The RC7 runtime has not been migrated yet.
- Agent development and regression tests default to **zero paid model calls**.
  Use mocks, recorded responses and local datasets. Existing API keys, Tier 1
  limits and past benchmark permission are not an unlimited spending budget.
- Before a live inference test, there must be an explicit user-authorized spending
  envelope with model, maximum calls and cumulative USD cap. Reuse an existing
  envelope when authorized; never reset its accounting by restarting a script,
  creating a worktree, changing the dataset or retrying. A new test proposal in
  the plan is not authorization to spend it.
- This planning turn authorizes no paid inference. A read-only model metadata
  request was made; it does not verify generation or billing access.
- Never print, commit or copy API keys, cookies or raw credentials. Never change
  Google billing/auto-reload settings without the user's explicit instruction.
- Test count, JSON validity and HTTP success are not evidence of classification
  quality. Report measured precision/recall and actual token cost separately.
- Run focused tests for the affected behavior; use a full suite at an integration
  checkpoint. Do not replay thousands of real items through a paid API merely
  because a prompt or model setting changed.

## Product direction

- Persist crawl results independently of AI. An AI billing/quota stop pauses AI,
  while collection may continue within the user's raw/storage limits.
- Three filter modes: OFF, STANDARD, QUALITY. OFF makes **zero model calls**,
  including prompt planning, review and background watch. It uses entered
  keywords or a previously saved plan and exports unassessed results truthfully.
- Each `(platform, profile, query)` has an independent job/checkpoint and may own
  a dedicated Electron window. Window concurrency is measured/adaptive, not a
  fixed platform allotment. Do not promise exhaustive social-network coverage.
- No Facebook/Threads percentage or minimum-platform quota in the new policy.
  Use one global target; accept unique qualifying records in durable completion
  order, without preferring a platform.
- Keep raw data, results and recipe versions independently reusable. Preserve
  collected evidence when changing model or filter mode.

## Git and data

- `codex/csd-rebuild` is the new integration branch, based on the fixed RC7 tag.
  Create short-lived `codex/csd-rN-*` branches per milestone when work starts.
- Existing `codex/csd-next`, `codex/ai-foundation`, `codex/crawl-throughput` and
  production branches retain their checkpoints. Do not merge their old behavior
  into the rebuild automatically.
- Keep cost control, collection, filter policy and integration changes in
  reviewable commits. Do not hard-reset away newer work to change the AI engine.
- Source changes and local commits within the requested scope need no repeated
  permission. Do not promote a candidate to production solely because tests pass.
- AppData, exported posts, artifacts, keys and portable executables stay outside
  commits. Preserve user changes and untracked exports. Test with isolated data;
  never run two writers against the same production AppData.
