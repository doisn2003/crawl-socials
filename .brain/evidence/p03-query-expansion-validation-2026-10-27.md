# P03.02 — Query expansion deterministic: evidence và API

Ngày 2026-10-27; owner `/root/csd_adapter`. Theo [dispatch sau login](../handoffs/lead-post-login-dispatch-2026-10-27.md), master P03.02, product contract và P03.01 đã nghiệm thu. Bàn giao để lead review; không tự thay trạng thái/gate. Không tác động app hoặc session Facebook đang mở.

## Phạm vi đã triển khai

[query-expansion.ts](../../src/application/query-expansion.ts) là module ứng dụng thuần, version `coffee-query-expansion-v1`. Nó nhận `Immutable<CampaignIntent>` từ P03.01 và options có bounds rõ, trả danh sách đề xuất bất biến; không network, LLM, service, dependency mới, planner, SQLite hoặc UI. Không dùng query làm bằng chứng relevance của bài.

```ts
const proposals = expandCampaignQueries(intent, {
  max_queries: 128,             // gồm tất cả originals
  max_depth: 3,                 // original depth = 0
  max_candidate_checks: 2000,   // gồm cả duplicate/filtered/oversize
  strategies: {
    COFFEE_SPELLING: true,
    INTENT_PHRASING: true,
    CONFIGURED_PLACE: true,
  },
});
```

Các số trên là **ví dụ gọi module offline**, không thay caps source probe ADR-009, không cấp quyền chạy query hoặc giả ước lượng HTTP requests. P03.03 sau này chọn jobs theo capability/budget thực từ proposals và campaign snapshot.

### Sinh query và giữ scope

- Grammar so khớp **toàn bộ query** theo NFC/case key: bare café, quán/tiệm, tìm/gợi ý, review/đánh giá, địa điểm đi/đi ở đâu, hẹn hò, sự kiện. Không substring-replace trong Tiny Cafe, Java coffee, tuyển dụng, điều kiện phủ định, URL hay nội dung chỉ thị.
- `COFFEE_SPELLING`: chỉ đổi slot cà phê/cafe/café/coffee. Không bỏ dấu toàn câu, không dùng accent alias làm query hoặc khóa dedup. Các ký tự/địa danh khác giữ nguyên.
- `INTENT_PHRASING`: đổi trong cùng nhóm. Hẹn hò không biến thành sự kiện; review không biến thành mọi chủ đề. Không thêm brand/venue mới vì P03.01 chưa xác minh thực thể.
- `CONFIGURED_PLACE`: ANY dùng preferred_places; INCLUDE chỉ dùng required places, không thêm preferred ngoài phạm vi. Không tự invent địa danh. Query đã có một địa danh nhận diện được không bị thay, bỏ hoặc nối thêm địa danh thứ hai. Query chứa địa danh chưa thuộc grammar giữ original.
- BRAND và EXACT_PHRASE giữ nguyên canonical text và kind, kể cả tên trông như generic café. KEYWORD không khớp grammar cũng giữ nguyên và report `unrecognized_keyword_ids`; `Tiny Cafe` mặc định thuộc trường hợp này. Không tự coi tên khớp là brand đã xác minh.
- Original text dùng canonical normalization của P03.01; `raw_keyword` vẫn giữ nguyên input để đối chiếu. Không thêm quote/operator cho exact phrase: encoding theo adapter thuộc planner sau này.

### Bounds, thứ tự, provenance

Options yêu cầu đủ keys và boolean thật, không coercion. Giới hạn implementation: tối đa 512 queries, depth 3, 10.000 candidate checks; đầu vào tối đa 128 keywords, 32 places tổng, 256 allowlist entries. Text raw và canonical tối đa 1.024 UTF-16 code units. Đây là giới hạn module có version, không giới hạn dịch vụ được user phê duyệt.

Giữ tất cả originals trước. `max_queries` thấp hơn số originals → `EXPANSION_SEEDS_EXCEED_QUERY_LIMIT`, không silently drop query. Depth 0 hoặc candidate checks 0 vẫn giữ originals. Sinh BFS, keyword order giữ theo campaign; strategy order cố định spelling → phrasing → place, không phụ thuộc thứ tự keys trong options. Mọi candidate thử, kể cả duplicate/allowlist-filtered/oversize, đều tiêu budget; vòng sinh không chạy đến vô hạn khi không thêm được query mới.

Dedup theo canonical NFC lowercase, không merge `café` với `cafe`, không dùng text để dedup post. Query đầu tiên giữ derivation; derivation trùng sau bị đếm `duplicate_candidates`. IDs `q0...` chỉ có nghĩa bên trong một kết quả/version/config cụ thể, không global identity. Mỗi query mới có parent đã tồn tại với depth nhỏ hơn đúng 1, root keyword ID, strategy/version, rule, reason và source refs; place/allowlist thêm ref cấu hình. Không bịa bằng chứng venue/brand.

Result deep-frozen và tách options khỏi caller. Không đổi intent/campaign source snapshot. `filter_semantics=UNCHANGED_USE_CAMPAIGN_SNAPSHOT` nhắc consumer phải tiếp tục mang geography/language/exclusions/sources/content types/history của campaign, không suy chúng từ query hoặc coi query thay post validator.

### Fallback và frozen list

DISABLED hoặc tất cả strategies off trả originals và 0 candidate checks. P03.01 chưa đánh giá exclusions; khi exclusions có nội dung, module bảo thủ trả originals với `UNEVALUATED_EXCLUSIONS`, không diễn giải chúng thành denylist hoặc lờ chúng để mở rộng. Geography UNRESOLVED cũng giữ originals với reason riêng.

FROZEN_ALLOWLIST: chỉ phát query vừa dựng được từ parent/rule vừa có trong allowlist đã canonicalize; text xuất theo entry allowlist đó. Không phát intermediate query ngoài allowlist chỉ để có đường đi đến entry sâu hơn. Entries không phát được do grammar/strategy/path/caps xuất trong `unemitted_allowlist_refs`; field này không phân biệt nguyên nhân ngữ nghĩa chưa biết. Originals vẫn giữ. Lead đã đồng ý phương án bảo thủ này vì model chỉ có list strings, không có parent links.

`DEPTH_LIMIT` có nghĩa đã gặp node ở ranh giới depth khi duyệt; không phải ước lượng chắc chắn còn bao nhiêu query unique bị bỏ. QUERY_LIMIT/CANDIDATE_LIMIT phản ánh nơi dừng thực. Unsupported grammar giữ seeds và report, không gọi service fallback. Module không tự biến DRAFT thành BENCHMARK.

## Verification đã hoàn tất

Node 24.19.0, TypeScript 6.0.3; dùng stack hiện có. Compile cô lập vào `.test-build-expansion`, không sửa tsconfig/package và không ghi dist/.test-build chính.

```powershell
node node_modules/typescript/bin/tsc --ignoreConfig tests/query-expansion.test.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022 --types node --rootDir . --outDir .test-build-expansion --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --noImplicitOverride --noFallthroughCasesInSwitch --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --noEmitOnError
node --test .test-build-expansion/tests/query-expansion.test.js
```

Kết quả cuối: **compile PASS, 18 tests PASS, 0 fail**. [Tests](../../tests/query-expansion.test.ts) kiểm scope drift, nhóm intent, brand/exact protection, từng strategy, INCLUDE/ANY, geography đã có, cap số lượng/depth/candidate work, parent graph, frozen list không bịa lineage, fallback, deterministic output và mutation isolation. Unicode có NFC/decomposed, accent aliases không merge, fullwidth không tự nhận dạng, Greek/Cyrillic/umlaut của địa danh không bị bỏ dấu, và canonical text có thể dài hơn raw được kiểm cap.

Edge do lead chỉ ra trong lúc review: grammar dựng query từ place sát cap có thể throw trước nhánh DISABLED. Đã sửa: grammar bỏ composed string quá dài; candidate sinh quá dài tăng `oversize_candidates` và vẫn tính work cap, không làm mất seed set. Regression kiểm place 1.024 units ở DISABLED, all-off, và enabled cap1. Cả ba đạt.

Chạy thử offline với campaign coffee hiện có và options ví dụ phía trên: **8 originals, 101 query proposals**, 372 candidate checks, 279 duplicates, 0 oversize. Tiny Cafe được giữ original và report unrecognized. Đây là output query của module, **không có bài Facebook nào được thu**; không báo yield/precision/benchmark.

## Giới hạn còn giữ rõ

Module không hiểu ngữ nghĩa tùy ý hoặc xác minh tên quán. Không tìm thêm địa phương từ văn bản, không tải nguồn, không chọn filters adapter, không estimate cost và không thực hiện exclusions. Input contract là model đã validate từ P03.01; module kiểm thêm coherence của fields cần dùng và bounds, không thay toàn bộ CampaignSpec validator. P03.03 vẫn chưa triển khai.

[Handoff](../handoffs/p03-query-expansion-2026-10-27.md) · [SHA-256 manifest](p03-query-expansion-manifest-2026-10-27.json).
