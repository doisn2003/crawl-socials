# Handoff P06.01 — Chuẩn bị rubric offline

Ngày 2026-10-27, owner `/root/csd_adapter`, gửi lead `/root`. Theo [dispatch](p06-rubric-preparation-dispatch-2026-10-27.md). **Đã sẵn sàng review phần chuẩn bị; chưa hoàn tất toàn P06.01 vì chưa có bộ mẫu thật.** Không tự đổi task/gate.

## Đầu ra

| File | Nội dung |
| --- | --- |
| [relevance_rubric.md](../specs/relevance_rubric.md) | Trình tự phân xử ACCEPT/REJECT/UNVERIFIED, ranh giới workload, rule versions, evidence/cutoff và cách xử lý chỉ thị nằm trong bài. |
| [relevance_reason_codes.schema.json](../specs/relevance_reason_codes.schema.json) | Draft-07 schema cho quyết định relevance riêng, 13 codes, evidence ref/version/hash và missing evidence. Không phải schema overall validity. |
| [rubric-examples.json](../../tests/fixtures/relevance/rubric-examples.json) | 24 ví dụ SYNTHETIC/FIXTURE, đủ các case dispatch; không bài/URL/ID người thật, không đủ điều kiện benchmark. |
| [evidence](../evidence/p06-rubric-preparation-2026-10-27.md) | Kết quả và lệnh inline Node/Ajv tái kiểm chỉ đọc file, giới hạn. |
| [manifest](../evidence/p06-rubric-manifest-2026-10-27.json) | SHA-256 năm file đầu ra, không tự hash chính manifest. |

## Điểm cần lead xác nhận

- Relevance chỉ là một chiều. Ví dụ private/unknown source có thể đúng chủ đề nhưng vẫn bị loại/giữ chờ ở overall validity; mọi fixture luôn không đạt benchmark provenance.
- Hà Nội ưu tiên, không cấm tỉnh/thành khác. Quảng cáo/tuyển dụng/sang nhượng có quan hệ rõ với quán được nhận; keyword hoặc tên Tiny Cafe đơn lẻ chưa đủ xác minh brand.
- Snippet đủ nghĩa có thể phân xử; snippet bị cắt, ảnh chưa có bằng chứng nội dung và entity/context mâu thuẫn giữ UNVERIFIED. Không đặt độ dài tối thiểu hoặc ép nhãn để đủ 1.000.
- Reason codes mới nằm trong schema tài liệu, chưa sửa enum/runtime. Mapping dự kiến CONTENT_MATCH/OFF_TOPIC/CONTENT_INSUFFICIENT chỉ phục vụ P06.02 sau này, không trực tiếp biến relevance ACCEPT thành overall ACCEPT.

## Verification

Node 24.19.0 / Ajv 8.20.0 strict, không type coercion: 24 expected decisions PASS; 29 coverage tags; 13/13 codes; 26 evidence hashes và bindings khớp; 23 ca JSON sai bị từ chối. UNVERIFIED không evidence được chấp nhận khi nêu phần thiếu. Chi tiết và lệnh tái kiểm có trong evidence.

Đây là kiểm schema/fixture, không kiểm classifier hay báo precision/recall. Không thêm runtime/test engine/dependency/npm script; không build, chạy live, sửa source/browser/observer hoặc master/README. Không đụng output build của CSD agent đang xử lý R06.

Phần còn lại: khi lead có nguồn và mẫu thật phù hợp data policy, chọn mẫu khó có xuất xứ, làm sạch, gán nhãn và review bất đồng theo rubric. Không cần người dùng chọn lại workload hay xác nhận Meta app để bàn giao phần offline này. Chờ lead review và giao tiếp; không tự mở P06.02.
