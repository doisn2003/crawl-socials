# P02.01 — Adapter contract 1.0.0

Ngày: 2026-10-27. Trạng thái task/gate chỉ theo [master plan](../master_plan.md). Contract này triển khai ranh giới phần mềm offline, chưa chứng minh quyền hoặc khả năng lấy bài Facebook thật.

## File và trách nhiệm

| File | Trách nhiệm |
| --- | --- |
| `src/domain/adapter-contracts.ts` | Capability, request/query/access context, checkpoint, candidate/provenance, page/error/continuation; forward contracts job/decision/snapshot |
| `src/application/ports/social-adapter.ts` | Interface initialize, checkAccess, discoverSources, searchPosts, fetchBatch, verifyPermalink, stop |
| `src/application/adapter-capabilities.ts` | Registry có snapshot độc lập, kiểm request runtime và capability/filter theo mode |
| `src/infrastructure/adapters/fake-social-adapter.ts` | Fake adapter, cursor có context binding và lỗi điều khiển được |
| `tests/fixtures/adapters/facebook-pages.json` | Nội dung tổng hợp, không có tài khoản hoặc bài thật; có field cố tình giả LIVE để kiểm chống nâng provenance |

Domain/application không import Electron. Fake adapter chỉ dùng `node:crypto` để tạo namespace cursor từng instance; không mở browser, network hoặc DB.

## Capability, permission và xác minh

`AdapterCapabilities` khai báo source types, scopes, modes, `filters_by_mode`, pagination, authentication, readable fields, permalink/checkpoint support, adapter/contract version và mức kiểm chứng. `verification` không cấp quyền nguồn.

Registry giữ một adapter version mỗi adapter ID; register trùng ID bị từ chối. Đổi version tạo registry mới ở composition root, không sửa âm thầm bản khai báo trong run đang thực thi. Get/register clone dữ liệu để caller không mutate registry.

`validateAdapterRequest` kiểm cấu trúc request, trường ngoài allowlist, ID/version, scope/mode/source/filter hỗ trợ, filter timestamp/ngôn ngữ, budget nguyên dương và access-context consistency. Source permission DENIED trả ACCESS_DENIED; adapter yêu cầu USER_SESSION mà binding chưa VERIFIED trả LOGIN_REQUIRED. UNKNOWN permission được giữ nguyên trong phép kiểm capability; live preflight phải đánh giá quyền/route riêng, không coi `null` validation error là được phép crawl.

Các enum access-context và raw candidate được kiểm đúng kiểu string, không ép `String(value)`. JSON array/object mang giá trị giống tên enum vẫn là input sai: context trả INVALID_REQUEST; raw post/source trả SCHEMA_CHANGED. Điều này ngăn `['DENIED']` lọt kiểm enum nhưng né nhánh so sánh permission DENIED.

JOINED_GROUPS và GROUP_POST_SEARCH có chỗ trong type extension, nhưng fake adapter **không hỗ trợ** chúng; CampaignSpec 1.0.0 không bị đổi và không bật riêng tư.

## Query, context và checkpoint

- Query có run/query/parent/policy, adapter/version, scope/mode/source, keyword, filters, priority và `max_candidates`.
- Access context chỉ gồm internal IDs, account binding và permission state; không có cookie/token/password hoặc platform account name.
- Mọi lời gọi nhận context rõ ràng; không lấy default session.
- Cursor trả ra là opaque state. Fake chỉ hỗ trợ **SAME_INSTANCE**; không ghi xuống ổ và không hứa resume qua process restart.
- Cursor được bind toàn bộ selection context: run/query/parent/policy, source/mode/scope, filters, keyword, budget, adapter version và account/profile/access context. Đổi context phải tạo truy vấn mới; không đem cursor cũ dùng lại.
- Cursor instance khác hoặc không được cấp trả INVALID_CURSOR. Context/version không khớp trả CHECKPOINT_MISMATCH. Cursor không vào log/evidence công khai.
- `fetchBatch` bắt buộc checkpoint có đúng envelope; null/undefined/thiếu field/sai kiểu/trường lạ trả INVALID_CURSOR, không dùng sentinel của initial search. NOT_INITIALIZED/STOPPED được kiểm trước lỗi input để lifecycle nhất quán.
- Retry một checkpoint trả cùng tập candidate và continuation. Observation time có thể thay nếu clock injection tiến; persistence idempotency/dedup thuộc P05/P07, fake không đánh dấu bài đã commit.

## Kết quả và lỗi

Result là discriminated union: `status: OK` có page; `status: ERROR` có code/retryability/retry_after_seconds, **không có page rỗng thành công**.

Continuation phân biệt MORE + checkpoint, END/SOURCE_EXHAUSTED và STOP với BUDGET_REACHED/NO_PROGRESS/PROVIDER_LIMIT. Fake phát sinh MORE, SOURCE_EXHAUSTED và BUDGET_REACHED; các reason còn lại là contract dành cho adapter sau. Lỗi rate limit/login/challenge/schema/cursor không được map sang exhausted.

Post ID luôn string hoặc null. PostCandidate chưa phải một bài ACCEPT. Source context tách author type; visibility UNKNOWN vẫn UNKNOWN. Fixture `verifyPermalink` chỉ trả MATCHED_FIXTURE hoặc UNVERIFIED, chưa xác minh permalink live.

Capture mode của fake luôn FIXTURE; parser tạo object theo allowlist và gắn provenance từ request/context của host. Raw field `capture_mode`, raw provenance hoặc extra field không được truyền qua. Ingestion LIVE tương lai phải tự gắn provenance theo route thực; không tái dùng fake rồi đổi nhãn.

## Fake fixture và phạm vi mô phỏng

Fake nhận `posts`, `sources`, `page_size`, optional faults và clock injection. Đầu vào fixture được clone; kết quả không chia sẻ object có thể mutate với storage nội bộ.

- Đây là tập kết quả tổng hợp đã chuẩn bị để mô phỏng một truy vấn; **không triển khai tìm keyword, ranking hoặc ước tính độ phủ Facebook**.
- Post search/feed lọc source type/source ID, language và published range theo `[from, to)`; ngày thiếu không đạt filter thời gian. Không lọc relevance thay cho P06.
- Source discovery có pagination riêng và không hỗ trợ filter publication/language. Registry lẫn adapter đều từ chối các filter này.
- `max_candidates` tính cả observation trùng; không phải quota unique. Giữ duplicates để consumer kiểm identity/persistence.
- Fault theo batch index có thể phát một lần hoặc lặp; rate limit có retry-after giả 5 giây, không sleep thật. Lỗi không advance checkpoint.
- Field sai hoặc ID dạng number trả SCHEMA_CHANGED cho batch; không âm thầm loại record lỗi rồi báo exhausted.
- Initialize idempotent trước Stop; Stop idempotent và terminal, xóa cursor/fault state. Muốn chạy mới tạo instance mới.

## Phần chưa triển khai

Không có adapter Facebook live, login/membership verification, durable checkpoint, DB transaction/lease scheduler, classifier, audit evaluator hoặc benchmark. CollectionJob/ValidationDecision/RunSnapshot mới là forward types theo master plan; readonly TypeScript không thay cơ chế persistence bất biến. Cần protocol/preflight và gate hiện hành trước nguồn thật.

## Kiểm chứng

[Báo cáo P02.01](../evidence/p02-adapter-validation-2026-10-27.md) ghi lệnh tái hiện, phạm vi tests và giới hạn. Không tăng valid LIVE count hoặc thay trạng thái G00/G01/G02 từ fixture.
