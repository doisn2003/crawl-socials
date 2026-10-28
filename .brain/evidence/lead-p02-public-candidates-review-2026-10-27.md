# P02.02 public candidates — lead review

Ngày 2026-10-27. **Hiện hành: hai finding đã đóng, code được nghiệm thu cho một read diagnostic LIVE theo ADR-010.** Chưa là nghiệm thu bài hợp lệ/benchmark. Phần dưới giữ lịch sử trước sửa; runtime1632 là bản cũ, lead đang nạp cùng profile sau nghiệm thu.

Lead đọc controller, writer, fields, fixed script, native menu/index và owner fixture. Compile riêng `.test-build-lead-candidate`; 31 tests (14 metadata owner +9 metadata reviewer +8 candidate owner) PASS. Đây là baseline, không phủ hết boundary và contact redaction.

Subagent bổ sung8tests độc lập; lead chạy lại chính output cô lập `.test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js`: **6 PASS, 2 FAIL**, exit1. Hai finding đã gửi CSD agent sửa:

1. **P2 — bỏ qua negative label sau body.** Fixture header Public + message + footer `aria-label=Friends` vẫn trả1sample, expected0. `headerOpen=false` sau message làm không xét restricted/ad ở ngoài body phía sau. Nhãn Sponsored cũng dùng guard này. Cần xét negative signals thuộc đúng outer boundary, vẫn loại nested article/comment để không lẫn bài nhúng.
2. **P2 — contact bị tách node lọt redaction.** Fixture các span `090`, `123`, `4567`; script nối bằng newline nhưng regex số không nhận newline, payload còn đủ dãy số. Validator idempotence không bắt được vì dùng cùng redactor. Cần xử lý sau khi ghép snippet và kiểm cờ redaction phù hợp.

Không sửa test của reviewer để làm xanh. Cần owner fixes, rerun review + native fixture và manifest snapshot mới; lead sẽ nghiệm thu lại trước shared build/run thật. Không gate PASS, không tính mẫu synthetic vào candidates/valid. Scope và phân công tiếp tục theo [dispatch](../handoffs/lead-p02-public-candidates-dispatch-2026-10-27.md).

## Nghiệm thu snapshot sau sửa

Lead đọc diff: negative restricted/ad signals ngoài body được xét cả sau body; nested article/comment vẫn prune. Redactor nhận whitespace/newline giữa chữ số, aggregate redaction được phản ánh trong contacts_redacted. Reviewer bổ sung hai PUBLIC siblings để kiểm ambiguity độc lập; case private/public vẫn đòi không lưu nội dung và chấp nhận reason conflict/ambiguity khi cùng có cả hai nguyên nhân. Không giảm invariant để làm tests đạt.

Lead fresh compile + **39/39 tests PASS**; reviewer riêng **8/8 PASS**. Lead native candidate **3/3 PASS** và metadata regression **3/3 PASS**: [candidate](lead-p02-public-candidates-fixture-2026-10-27.json), [metadata](lead-p02-public-candidates-metadata-regression-2026-10-27.json). Snapshot owner lúc14:41:14.295Z có **13/13 owned hashes** khớp. Shared `npm run build` đạt và **129/129 frozen entries** khớp.

- Fixed candidate script SHA256: `5ac3ae298e281911c02d637d213562e184adbc79edb91e23b51dc2a2f7622ed9`.
- Compiled candidate controller SHA256: `7ebc11183a88d2167e7cf3e3c5b6c956ff00fa6322eec74254ddef48730acf6f`.
- Reviewer final test SHA256: `e09ab983c78e4e5c0da35e759d6da9e73f1feeb8404f0461f93f95c3a5246566`.

Owner được yêu cầu giữ snapshot/idle; reviewer đã kết thúc review. Lead duy nhất nạp và chạy thử; không mô tả hai worker còn đang triển khai. Cần evidence LIVE riêng để quyết định sửa selector/continuation, không extrapolate5synthetic samples thành kết quả Facebook.
