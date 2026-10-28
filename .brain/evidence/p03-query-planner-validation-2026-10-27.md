# P03.03 — Planner thuần theo capability/budget: evidence và API

Ngày 2026-10-27, owner `/root/csd_adapter`. Theo [dispatch](../handoffs/lead-p03-planner-dispatch-2026-10-27.md). Dependency P03.02/P02.01 đã được lead nghiệm thu. Bàn giao để review, không tự đổi task/gate hoặc tác động phiên Facebook.

## Đầu ra và boundary

[query-planner.ts](../../src/application/query-planner.ts) cung cấp `planQueries(input): Immutable<OfflineQueryPlan>`, version `query-planner-v1`. Nhận model P03.01, proposals P03.02, capability snapshot, target/access context và budget rõ. Output gồm request templates, lineage catalog, effective budget/allocation, quyết định PLANNED/DEFERRED/REJECTED và reason codes.

**Không có execution trong module.** Mọi output có `execution_authorized=false`. Template không có `run_id`, Start, deadline, lease, attempt hoặc cursor. Host tin cậy sau này phải bind run đã được preflight, đối chiếu capability/context hiện hành và thực thi budgets; không dùng plan như source grant. Không scheduler, retry loop, network, Electron, DB, UI, LLM hoặc dịch vụ ngoài.

Điều kiện capability `LIVE_VERIFIED` áp dụng cho template LIVE thông thường của planner này. **Source probe P02.02 không phụ thuộc planner hoặc điều kiện đó**: phép thử capability lần đầu dùng protocol/preflight riêng đã được lead chốt, để tạo bằng chứng trước khi cập nhật capability. Không được biến check của planner thành điều kiện vòng tròn buộc probe có kết quả trước khi được probe.

API input:

```ts
planQueries({
  intent, proposals, capability,
  targets: [{
    search_mode: 'POST_SEARCH', source_type: 'PAGE',
    source_id: null, source_evidence_ref: null, access_context,
  }],
  context: { namespace: 'fixture-example', mode: 'FIXTURE', geography_policy: 'POST_VALIDATE' },
  budget: {
    task: { jobs: 8, candidates: 24, request_units: 40, cost_units: 0 },
    global_remaining: { jobs: 8, candidates: 24, request_units: 40, cost_units: 0 },
    per_job: { candidates: 3, request_units: 2, cost_units: 0 },
    request_unit: 'ADAPTER_CALLS', currency: 'VND', cost_unit_scale: 1,
    request_basis_ref: 'fixture:two-calls-whole-job',
    cost_basis_ref: 'fixture:no-external-service',
  },
});
```

Đây là **ví dụ fixture**, không ngân sách nguồn thật đã được user giao. Unit tests tạo campaign snapshot giả trong RAM với budgets cụ thể; `campaign.coffee.json` trên đĩa không đổi. Campaign hiện còn null budget sẽ nhận DEFERRED/CAMPAIGN_BUDGET_UNRESOLVED, không bị tự nâng thành sẵn sàng chạy. Host tương lai cần snapshot/manifest có quyết định budget thực, không xóa null chỉ để qua planner.

## Capability, filter và nguồn

| Điều kiện | Hành vi |
| --- | --- |
| Mode/source/scope không khai báo | REJECTED với UNSUPPORTED_MODE/SOURCE/SCOPE; không đổi từ posts thành SOURCE_DISCOVERY. Planner này chỉ chuẩn bị post jobs. |
| Nguồn out-of-scope/unknown | Out-of-scope bị reject, `in_scope=null` bị defer. Source requirement/minimum chưa rõ được report riêng, không coi null là quota0. |
| Language hoặc RANGE cần filter chưa hỗ trợ | DEFERRED LANGUAGE_FILTER_UNSUPPORTED/DATE_FILTER_UNSUPPORTED. RANGE đòi cả from/to; không gửi nửa điều kiện hoặc bỏ filter âm thầm. |
| Geography INCLUDE | FilterName không có geography: chỉ lập job nếu config chọn POST_VALIDATE, giữ nguyên campaign/evidence_rule. DEFER policy → GEOGRAPHY_POST_VALIDATION_REQUIRED. Keyword chứa Hà Nội không thay filter. |
| Geography ANY | preferred_places chỉ ưu tiên input proposals; không biến thành required adapter filter hoặc yêu cầu loại bài ngoài nơi đó. UNRESOLVED → defer. |
| EXACT_PHRASE | DEFERRED EXACT_PHRASE_UNSUPPORTED vì capability/QueryPlan chưa mô tả syntax/semantics exact phrase. Không tự quote/encode Facebook. BRAND đi nguyên text và còn cần relevance/entity validation sau thu. |
| SOURCE_FEED/GROUP_POST_SEARCH | Cần opaque source ID và caller-verified source evidence ref. GROUP mode chỉ PUBLIC_GROUP. Không nhận permalink bài làm source ID. Ref là trace, planner không tự đọc/xác minh nguồn qua mạng. |
| POST_SEARCH | Source ID/ref phải null; source-specific request dùng mode tương ứng đã khai báo. Không giả thêm source-id filter capability ngoài mode. |

Source-specific target giữ source evidence ref trong target snapshot, job trỏ qua target_index. Caller phải cung cấp ref nguồn đã xác minh; chuỗi ref không tự chứng minh source type hoặc quyền. Trùng tuple mode/source/context được reject ở target sau, không nhân allocation chỉ vì lặp target.

FIXTURE_ONLY không thành LIVE_VERIFIED. Capability UNKNOWN bị defer. LIVE templates đòi declaration LIVE_VERIFIED và source_permission ALLOWED; UNKNOWN không được planner chuyển thành ALLOWED. USER_SESSION cần account_binding VERIFIED. DENIED bị reject ngay cả fixture. Các declarations này vẫn **không** là quyết định G00 hoặc quyền execution; dữ liệu nguồn thật chỉ được gắn capture provenance bởi host/adapter thực. `expected_capture_mode` của plan là yêu cầu, không ghi đè provenance của candidates.

## Budget và đơn vị

- Job/candidate/request/cost limits của task và global remaining dùng chung cho toàn bộ query × target, không reset mỗi nguồn. Effective requests/cost còn bị chặn bởi campaign max_requests/max_cost. Target nào được xét sau sử dụng phần còn lại, không tự clone ngân sách.
- Mỗi job giữ một candidate allocation ≥1 và ≤per-job cap; cuối budget có thể allocation nhỏ hơn. Candidate là **observations**, chưa loại trùng/relevance, không phải quota bài hợp lệ. `max_candidates` truyền thẳng vào adapter contract cho cả job.
- Request unit phải khai báo ADAPTER_CALLS/CONTROLLED_ACTIONS/HTTP_REQUESTS cùng basis ref. Nó mô tả đơn vị của cả campaign max_requests, task/global limits và per-job reservation trong frozen configuration; nếu unit thực chưa biết phải để null → defer. Không suy 1 job = 1 HTTP request hoặc 1 request = 1 post. Mỗi job reserve một upper bound cho **toàn bộ** search + continuations/retries, không chỉ trang đầu.
- Cost dùng integer units theo currency và scale rõ: 1/100/1.000/1.000.000 units cho một đơn vị currency. Per-job cost là upper-bound reservation từ caller, không pricing do planner đoán. Campaign cap được chuyển qua decimal string, không làm tròn lên; ví dụ USD0.29, scale100 →29 units; USD0.291, scale100 bị defer vì không biểu diễn chính xác.
- Currency mismatch, thiếu task/global/per-job value, thiếu unit/basis hoặc campaign budgets còn null → không tạo jobs. **Unknown không thành 0.** Zero cost chỉ được dùng khi khai báo rõ số0 và basis; allocation0 khi không có job nghĩa chưa reserve gì, không là estimate chi phí dịch vụ đã biết.
- Các chiều wall time/operator time/storage được ghi `unallocated_dimensions`; planner không tạo lịch chạy hoặc giả đã bảo đảm chúng. Campaign limits phải được chốt trước khi tạo jobs, executor sau này vẫn phải giữ những giới hạn này và gate hiện hành.

Module không tạo continuation job hoặc retry reservation mới. Đó là trách nhiệm scheduler sau này dùng allocation còn lại của job hiện hữu; không được coi template là quyền refill budget.

## Determinism và lineage

Planner tái dựng proposals bằng P03.02 từ intent/options và đối chiếu canonical JSON để từ chối lineage/text/config đã bị sửa rời rạc. Không tự sửa proposals. Snapshot capability/config/targets được clone, output deep-frozen; caller không bị freeze.

Originals được xét trước expansions, target order cố định theo input; không hứa tối ưu yield hoặc bảo đảm mọi nguồn nhận job khi budget hẹp. IDs bind SHA-256 của version, campaign snapshot, toàn proposals, capability snapshot, context/budget/targets. Mỗi job/request query ID còn có target index và local query ID, không va chạm giữa các nguồn hoặc giữa hai campaign/capability/context khác nhau.

`lineage_catalog` giữ **tất cả** proposals, không chỉ query được chọn thành job. Parent references đã namespace bằng plan hash. Job có lineage_id riêng; `request_template.query.parent_query_id` trỏ tới node cha trong catalog, không đòi node đó có execution job. Catalog giữ nguyên root keyword, strategy/rule/version, source refs và raw input P03.02. Query IDs `q0...` của expansion không được xuất làm global adapter IDs.

Plan có full campaign snapshot và `validation_policy=ALL_CAMPAIGN_CONDITIONS_BEFORE_VALID_UNIQUE_COUNT`. Relevance, exclusions, identity/permalink, public source, fields, time/provenance vẫn phải kiểm sau thu; query và source allocation không thay validator. `source_coverage.valid_source_mix_proven=false` luôn luôn, kể cả đã có jobs của cả ba nguồn.

## Verification đã chạy

Node24.19.0/TypeScript6.0.3 có sẵn. Compile riêng, không package/tsconfig/shared/build chính:

```powershell
node node_modules/typescript/bin/tsc --ignoreConfig tests/query-planner.test.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022 --types node --rootDir . --outDir .test-build-planner --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --noImplicitOverride --noFallthroughCasesInSwitch --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --noEmitOnError
node --test .test-build-planner/tests/query-planner.test.js
```

**Compile PASS; 18 tests PASS, 0 fail.** [Tests](../../tests/query-planner.test.ts) kiểm unsupported filter/capability, geographic hậu kiểm, exact phrase, unresolved budget/unit, decimal cost, tổng allocation nhiều nguồn, zero vs null, permission/capture boundaries, verified source refs, duplicate targets, originals priority, full lineage, hash binding, immutability/determinism và malformed runtime enums.

Luồng fake adapter: bind một template bằng run ID synthetic **trong test**, initialize/checkAccess/searchPosts/fetchBatch theo contract. Hai adapter calls dùng nguyên request/job allocation3, thu **3 observations / 2 identities** vì fixture có duplicate; tất cả capture_mode FIXTURE dù raw fixture có field giả LIVE. Source_permission vẫn UNKNOWN, không raise thành ALLOWED; không proof source mix hoặc 1.000 bài. Không gọi Facebook/session thật.

## Giới hạn

Input model vẫn phải đi qua CampaignSpec validator/P03.01; planner không thay source-access assessment, không tự xác minh capability declaration, ref quyền, pricing hoặc source identity. Hash là binding/reproducibility, không chữ ký xác nhận quyền. Không có capability Facebook giả từ ảnh UI và không sửa fake adapter/registry/shared contracts. Không mở scheduler, live driver hoặc task kế tiếp.

[Handoff](../handoffs/p03-query-planner-2026-10-27.md) · [Manifest](p03-query-planner-manifest-2026-10-27.json).
