# CSD — current development instructions

The user's latest instructions take precedence. The active development plan is
[ADR-025](.brain/decisions/ADR-025-cost-controlled-csd-rebuild.md), agreed in the
conversation on 2026-11-03. Older dispatch, autonomous-run and spending instructions
inside historical `.brain` sections are not current authorization.

## Cost and evidence

- The user now explicitly selected **Gemini 3.1 Flash-Lite** after the 2.5
  preflight failed. Use 3.1 for new planning/filtering; preserve old model ledgers.
  Do not silently fall back to another model.
- Completed task authorized 2026-11-03: crawl the user's broad piano prompt, compare
  STANDARD/QUALITY, target 1,000 accepted roots per mode, per-query Electron
  windows. Maximum **USD 6 for the entire task**, including planner, preflight,
  classification, reviews and retries. Reuse one cumulative DEVELOPMENT ledger;
  set a conservative operational call cap without asking for more permission.
  Raw data can be shared between both modes to avoid duplicate collection/cost.
  Finished with 1,000 exported roots per mode, 3,222 shared roots, 1,070 task calls,
  USD 1.253847 measured and no held cost. The DEVELOPMENT envelope is closed at
  the existing cumulative ledger totals; unused USD 6 allowance is not a grant
  for another experiment. Only piano-related posts were in scope. See the
  [R7 report](.brain/reports/csd-piano-comparison-20261103.md).
- Agent development and regression tests default to **zero paid model calls**.
  Use mocks, recorded responses and local datasets. Existing API keys, Tier 1
  limits and past benchmark permission are not an unlimited spending budget.
- Confirmed R9 fix: normal USER runs are bounded by their monetary budgets,
  not a cumulative API-call count. Ignore legacy USER `maxCalls` values and
  preserve the spending ledger. Explicit DEVELOPMENT call caps still apply;
  removing the user-facing cap does not authorize agent inference spending.
- Before a live inference test, there must be an explicit user-authorized spending
  envelope with model, maximum calls and cumulative USD cap. Reuse an existing
  envelope when authorized; never reset its accounting by restarting a script,
  creating a worktree, changing the dataset or retrying. A new test proposal in
  the plan is not authorization to spend it.
- On 2026-11-03 the user explicitly authorized one frozen 100-post piano
  STANDARD/QUALITY evaluation: Gemini 2.5 Flash-Lite, at most 25 calls and USD 0.10
  cumulative including preflight. The durable DEVELOPMENT authorization and ledger
  are in `%USERPROFILE%/.csd/spending`; preserve them across retries. This is not
  authorization for arbitrary additional experiments or another model.
- The superseded 2.5 experiment's first request returned HTTP 404 `MODEL_NOT_AVAILABLE`;
  1/25 calls, USD 0 measured/held, zero sample posts evaluated. GET metadata still
  returns 200 and is not proof of generation access. Do not repeat the preflight
  until access/key state changes. The frozen sample and labels remain in artifacts.
- Never print, commit or copy API keys, cookies or raw credentials. Never change
  Google billing/auto-reload settings without the user's explicit instruction.
- Test count, JSON validity and HTTP success are not evidence of classification
  quality. Report measured precision/recall and actual token cost separately.
- Run focused tests for the affected behavior; use a full suite at an integration
  checkpoint. Do not replay thousands of real items through a paid API merely
  because a prompt or model setting changed.

## Product direction

- Confirmed 2026-11-03: the user wants **Vietnamese-language content, including
  Vietnamese speakers abroad**. New UI configurations default to Vietnamese;
  this is a content-language constraint, not a Vietnam-only geography or a
  nationality inference. Enforce it before paid classification and on the
  selected candidate before acceptance; unclear language stays pending.
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
