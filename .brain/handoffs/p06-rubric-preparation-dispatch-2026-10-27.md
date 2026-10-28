# Giao chuẩn bị P06.01 — rubric cho phép thử nguồn

Ngày 2026-10-27. Owner subagent `/root/csd_adapter`; lead `/root` giữ bảng trạng thái. P00.04 và P03.01 đã nghiệm thu. Làm phần độc lập cần cho đánh giá mẫu nguồn, không mở classifier/LLM/UI/storage.

Đọc master P06.01, product contract, campaign.coffee.json, campaign_intent.md và benchmark_protocol.md. Viết rubric relevance ACCEPT/REJECT/UNVERIFIED; tách khỏi quyết định valid tổng hợp (source/publicity/identity/permalink/fields/provenance). Bài liên quan không tự thành bài hợp lệ.

Phạm vi file riêng:

- `.brain/specs/relevance_rubric.md`
- `.brain/specs/relevance_reason_codes.schema.json`
- `tests/fixtures/relevance/rubric-examples.json` — tối đa 24 ví dụ do agent tự viết, đánh dấu SYNTHETIC, không URL/ID người thật, không được tính vào benchmark.
- `.brain/evidence/p06-rubric-preparation-2026-10-27.md`
- `.brain/handoffs/p06-rubric-preparation-2026-10-27.md`

Bao phủ quán/địa điểm café, hỏi gợi ý, hẹn hò, event, brand trùng tên, địa phương ngoài Hà Nội (không tự reject), nhắc keyword ngẫu nhiên, quảng cáo, tuyển dụng, ảnh-only/thiếu nội dung, snippet, nguồn riêng tư/unknown, instruction nằm trong bài. Không tự thêm exclusions hoặc biến uncertainty thành ACCEPT để đủ 1000. Tách các chiều đánh giá rõ nhưng giữ rubric dễ dùng, không tạo framework mới.

Schema reason codes có version và quy tắc cách ghi evidence thiếu/đủ; ví dụ có expected relevance và giải thích ngắn. Kiểm JSON/schema bằng Node/Ajv có sẵn, kiểm đủ các case cần thiết. Không thêm dependency/script npm/source runtime hoặc test engine chỉ lặp nội dung rubric; không build/ghi dist/.test-build. Không fetch nguồn thật, không dùng fixture làm dataset đã gán nhãn thật hoặc quality score. Manifest hash các đầu ra tự sở hữu.

Chỉ phần chuẩn bị offline được bàn giao. P06.01 đầy đủ còn cần bộ mẫu thật và review sau khi nguồn có; agent không tự DONE task/gate. Không sửa master_plan/.brain README hoặc nhắn chat khác. Xong báo lead và dừng, không tự nhận task kế.
