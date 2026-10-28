# Giao subagent — P03.01 chuẩn hóa đầu vào/intent

Ngày 2026-10-27. Owner `/root/csd_adapter`, subagent trong chat lead. Gói chuẩn bị P02.02 đã [được review](../evidence/lead-p02-preparation-review-2026-10-27.md); chuyển integration controller sang chat CSD agent. P03.01 đủ dependency P00.01/P01.01, đây là phần độc lập nhỏ; chưa nhận P03.02/03, UI/scale hoặc dịch vụ LLM.

## Phạm vi đầu ra

`src/domain/campaign-intent.ts`, `src/application/campaign-intent.ts`, `tests/campaign-intent.test.ts`, fixture riêng dưới `tests/fixtures/intent/`, `.brain/specs/campaign_intent.md`, evidence/handoff riêng. Domain/application không import Electron hoặc chạy network. Không sửa campaign/schema P00, adapter/observer/main/preload/renderer/package/lock/tsconfig/master/README. Không ghi dist/.test-build; nếu cần compile riêng dùng `.test-build-intent/` với config riêng trong đó và gọi tsc hiện có.

1. Representation ổn định cho raw input + Unicode NFC/space/case normalization; giữ nguyên văn và trace. Phân biệt exact phrase/brand/place/intent/exclusion qua cấu trúc explicit; đừng suy mọi chuỗi thành brand hoặc bỏ dấu để hợp nhất các nghĩa khác nhau.
2. Accent-folded Vietnamese alias chỉ phục vụ đối chiếu có nhãn; không thay raw/exact canonical input, không sinh query mở rộng ở task này. Không gộp thương hiệu chính xác `Tiny Cafe` thành mọi quán cafe. Không tự dịch/mở rộng tên nhãn hiệu.
3. Tương thích campaign coffee đang có: Hanoi là preference, không hard location filter; exclusions rỗng không tự thêm tuyển dụng/sang nhượng/negative review. Điều kiện âm không trở thành substring filter tùy tiện. Nếu phần này chỉ model hóa điều kiện chứ chưa phân xử bài, ghi rõ không phải classifier và không giả đã xử lý ngữ nghĩa.
4. Mapping từ campaign đã validate sang representation phải giữ contract/version/capture-independent provenance; không làm thay đổi source requirements/target hoặc biến DRAFT thành BENCHMARK. API lỗi phải cố định, không echo dữ liệu không cần thiết.
5. Test các trường hợp Unicode decomposed/composed, space/case, input rỗng/sai type, exact brand, accent collisions, mutation isolation/determinism và không tự thêm exclusions. Tránh test chỉ sao chép implementation. Examples/spec đủ cho agent sau dùng đúng, không marketing parser/ngữ nghĩa AI.

Bàn giao manifest SHA-256, lệnh/checks và giới hạn; lead tự nghiệm thu. Không hỏi người dùng vì workload đã chốt. Không tiếp tục mở P03.02 khi chưa được giao. Chat CSD agent đang nắm build chính và controller P02.02; phối hợp chỉ qua lead để tránh cùng sửa file.
