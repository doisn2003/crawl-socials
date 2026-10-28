# P03.01 — Campaign intent model 1.0.0

Ngày 2026-10-27. Phạm vi theo [dispatch](../handoffs/p03-intent-dispatch-2026-10-27.md), [product contract](product_contract.md) và [coffee workload](campaign.coffee.json). Trạng thái task do lead quản lý trong master plan.

**Đây là chuẩn hóa và mô hình hóa cấu trúc explicit. Chưa có classifier/ngữ nghĩa, query expansion, entity resolver hoặc bộ kiểm relevance bài viết.** Không biến một term BRAND hay địa danh được khai báo thành bằng chứng entity đã xác minh.

## API và dữ liệu

- [Domain](../../src/domain/campaign-intent.ts): `CampaignIntent`, `IntentText`, `KeywordDeclaration`, versions và error codes.
- [Application](../../src/application/campaign-intent.ts): `normalizeIntentText(unknown)` và `buildCampaignIntent(input, validator, explicitDeclarations?)`.
- Dùng port `CampaignValidator` hiện có. Builder gọi validator trước, tạo snapshot tách biệt rồi map; không import Electron, network, DB hoặc LLM. Caller cung cấp validator tin cậy của ứng dụng, không truyền validator từ payload ngoài.
- Result là object deep-frozen và typed `Immutable<T>`; source input không bị sửa/freeze. Không có timestamp/random ID nên cùng input/declarations/version cho cùng output.

`source_snapshot` giữ nguyên toàn bộ CampaignSpec đã validate: campaign/schema/contract version, mode/confirmation, sources/minima, target, history, budgets, discovery policy, language/content types và open questions. `provenance` là CAMPAIGN_SPEC; không có capture mode, session, run ID hoặc quyền nguồn giả. Model không nâng DRAFT thành BENCHMARK.

## Chuẩn hóa có trace

Version `nfc-space-case-vi-alias-v1`:

| Trường | Ý nghĩa |
| --- | --- |
| `raw` | Nguyên văn đầu vào, giữ dấu/case/khoảng trắng để đối chiếu |
| `nfc` | Unicode NFC, chỉ hợp nhất dạng composed/decomposed tương đương |
| `canonical` | NFC + gom Unicode White_Space/BOM thành một space rồi trim; giữ chữ hoa/thường, dấu và punctuation |
| `case_key` | canonical lowercase theo Unicode mặc định, NFC; khóa so sánh không phụ thuộc locale của máy |
| `accent_alias.value` | Mapping tập ký tự nguyên âm tiếng Việt có dấu đã NFC sang a/e/i/o/u/y, đ→d; purpose COMPARISON_ONLY |
| `trace` | Cờ nfc/whitespace/case/alias thay đổi, cùng raw để truy ngược; không giả offset mapping ký tự |

Không dùng NFKC, không dịch, không stemming/fuzzy matching, không thay punctuation bằng khoảng trắng. Fullwidth `Ｃａｆｅ` khác `Cafe`; `Müller` không bị fold thành `Muller` vì dấu umlaut không thuộc bộ dấu tiếng Việt đã chọn. Ký tự format không phải whitespace được giữ nguyên; không quảng cáo chống homograph/invisible-character abuse. Surrogate hỏng, control characters còn lại, empty/whitespace-only và input không phải primitive string bị từ chối; không ép array/object thành text.

Sau sửa R05, alias chỉ thay ký tự có trong bảng tiếng Việt; không NFD rồi xóa combining marks trên toàn chuỗi. Cyrillic `й`/`и\u0306` giữ alias `й`, Greek `ά`/`α\u0301` giữ alias `ά`; marks ngoài bảng không bị xóa. `Đặng`→`dang`, `café`→`cafe`: é là cùng một Unicode character trong bảng, không phải vì module nhận diện ngôn ngữ của từ. Đây là mapping ký tự cơ học, không NLP/language detection. Raw/canonical vẫn giữ nguyên như trước sửa.

Alias không là query và không là identity. `ma`, `má`, `mà` có alias `ma` nhưng vẫn là ba term riêng; `Tiny Cafe` và `Tiny Café` không bị gộp. `accent_alias_collisions` báo nhóm keyword cần đối chiếu bằng term IDs và canonical forms. Không tự dùng nhóm collision để gộp brand hoặc nới intent.

Keywords trùng `case_key` sau NFC/space/case normalization bị lỗi `INTENT_DUPLICATE_KEYWORD`, không silently drop một dòng và mất trace. Đây là ràng buộc set keyword của representation; không phải quy tắc dedup bài hoặc xác minh hai entity là một. Exclusions và địa danh không bị âm thầm gộp.

## Explicit kinds và matching chưa thực hiện

| Kind | Nguồn khai báo | Hành vi hiện tại |
| --- | --- | --- |
| KEYWORD | `workload.keywords[index]`, mặc định | Giữ nguyên cụm; không tự nhận dạng brand/place nằm trong câu |
| EXACT_PHRASE | Declaration theo keyword index | Giữ literal phrase; không tự thêm dấu quote cho search, regex hay substring matcher |
| BRAND | Declaration theo keyword index | Giữ đầy đủ tên; `Tiny Cafe` không thành mọi quán cafe, entity_verification vẫn NOT_PERFORMED |
| PLACE | `geography.places` hoặc `preferred_places` | Tách REQUIRED_LOCATION/PREFERRED_LOCATION; không suy nơi của bài từ query |
| INTENT | `workload.intent` | Condition NOT_EVALUATED, null vẫn null ở DRAFT |
| EXCLUSION | `workload.exclusions[index]` | Condition NOT_EVALUATED; không tách từ âm thành substring denylist |

Một declaration gồm đúng `keyword_index`, `kind` BRAND/EXACT_PHRASE, `declaration_ref` opaque không rỗng. Chỉ gán loại cho keyword đã có, không thêm query. Một index chỉ có một declaration. Ref là trace tới quyết định cấu hình; không là proof quyền hay verification thương hiệu. Các enum yêu cầu scalar string; index là safe integer trong phạm vi. Không nhận field bổ sung hoặc URL query có token trong ref.

Ví dụ dùng workload coffee đã chốt:

```ts
const model = buildCampaignIntent(campaign, campaignValidator, [
  {
    keyword_index: 6, // campaign.coffee.json: Tiny Cafe
    kind: 'BRAND',
    declaration_ref: 'contract://1.0.0/coffee-workload/tiny-cafe',
  },
]);
```

Nếu không có declaration, `Tiny Cafe` vẫn được giữ nguyên trong KEYWORD; không tự phân tích văn bản intent để sinh annotation. Khi keyword list đổi thứ tự, caller phải cập nhật declaration tương ứng trước khi build; IDs là source paths của snapshot, không là ID thương hiệu toàn cục.

Coffee hiện `ANY`, `preferred_places = Hà Nội`, `places = []`: required_places rỗng; không loại bài ngoài Hà Nội. `exclusions=[]` trả về rỗng, không tự thêm tuyển dụng/sang nhượng/quảng cáo/negative review. Phrasing như “chỉ loại tuyển dụng khi không có nội dung trải nghiệm” được lưu nguyên condition; model **chưa hiểu hoặc thực thi điều kiện đó**. P06 hoặc evaluator sau này phải đánh giá theo rule/version/evidence riêng.

## API lỗi và giới hạn

| Code cố định | Trường hợp |
| --- | --- |
| INTENT_TEXT_INVALID | Text sai type, rỗng, control/lone surrogate |
| INTENT_CAMPAIGN_INVALID | Validator CampaignSpec từ chối, gồm RANGE from >= to; không echo lỗi/input của validator |
| INTENT_KEYWORDS_EMPTY | DRAFT có list rỗng nhưng chưa đủ đầu vào để tạo intent model này |
| INTENT_DUPLICATE_KEYWORD | Hai input keyword có cùng case_key |
| INTENT_DECLARATION_INVALID | Declaration sai shape/kind/index/ref hoặc lặp index |

Model không thêm schema field vào CampaignSpec; annotations là đối số riêng, gắn raw source path và ref trong result. Không mở P03.02, không query expansion, không NLP/LLM hoặc UI. Thử nghiệm [16 tests](../../tests/campaign-intent.test.ts) gồm invariants dữ liệu, boundary và mutation isolation; chưa có kết quả bài Facebook/benchmark.

[Validation](../evidence/p03-intent-validation-2026-10-27.md) · [Handoff](../handoffs/p03-intent-2026-10-27.md).
