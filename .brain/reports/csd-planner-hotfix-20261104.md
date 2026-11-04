# R12 — bản vá lập kế hoạch 0.4.0-rebuild.5.1

Ngày 04/11/2026, người dùng yêu cầu bản vá portable sau khi máy khác gặp
`CAMPAIGN_SEMANTIC_VALIDATION_FAILED` ngay lần chuẩn bị đầu ở STANDARD.
Nhánh riêng: `codex/csd-r12-planner-hotfix`, nền **e49b51d** (rebuild.5/R10).
Không đưa phần QUALITY v2 đang phát triển trên nhánh R11 vào bản vá này.

## Nguyên nhân được xác nhận

Người dùng cung cấp hai trường `target_roles` của phản hồi lỗi. Cả hai đánh dấu
CONFIRMED và trích dẫn:

> học piano, học piano giá rẻ, trung tâm piano, dạy piano, cho mượn piano

Prompt thật có thêm `piano giá rẻ` giữa `học piano giá rẻ` và `trung tâm piano`.
Trích dẫn đã ghép các đoạn không liền nhau. Đồng thời LLM mô tả người tìm kiếm
dịch vụ, trong khi yêu cầu gốc là các bài viết liên quan danh sách từ khóa.
Người dùng xác nhận xóa cụm ở giữa thì bản cũ chạy được; điều này khớp với phép
kiểm tra trích dẫn, không chứng minh keyword đó bị cấm hoặc máy kia hỏng.

Đối chiếu e671af2 (rebuild.4) với e49b51d (rebuild.5): không thay đổi
semantic-campaign, semantic-keywords, compile-campaign hoặc gemini-gateway.
Chưa có bằng chứng lỗi do phần cứng, cài đặt key hoặc thay đổi model giữa máy.

## Thay đổi

- Giữ nguyên phép kiểm tra bằng chứng. Bổ sung chẩn đoán có cấu trúc cho các
  trường mục tiêu: giá trị rỗng, thiếu bằng chứng hoặc quote không có trong nguồn.
- Khi chỉ lỗi bằng chứng vai trò và yêu cầu có dạng rõ ràng tìm bài liên quan
  một danh sách từ khóa, dựng lại kế hoạch từ chính các từ khóa người dùng đã nhập.
  Giữ nguyên cụm từ, chỉ gộp mục trùng; trường hợp thực tế có **11** cụm khác nhau.
  Vai trò để UNSPECIFIED, không tự suy ra người mua hoặc người tìm dịch vụ.
- Chỉ khôi phục cục bộ khi không có context, câu trả lời, chỉnh sửa hoặc seed bổ
  sung; không áp dụng cho danh sách có mệnh đề điều kiện, danh sách quá lớn hoặc
  hình thức không nhận diện chắc chắn. Kế hoạch dựng lại vẫn đi qua validator.
- Lưu nguyên phản hồi model sai, diagnostic và nguồn khôi phục
  `EXPLICIT_USER_TOPIC_LIST`. Dự thảo ghi `plannerRecovery` để không nhầm kế hoạch
  cục bộ với phản hồi model đã đạt kiểm tra. Trường hợp này không gọi thêm lượt
  model sửa vai trò; lần planner đã phát sinh vẫn được tính đủ.
- Trường hợp khác giữ tối đa một lượt sửa với hướng dẫn trích nguyên văn liền
  mạch và không tự thêm vai trò vào yêu cầu tìm bài rộng.
- Giữ recipe/hash lịch sử, ledger, ngân sách, model 3.1, bộ phân loại, ngôn ngữ,
  giao diện và cơ chế cửa sổ ẩn của R10. Không sửa hoặc xóa AppData thật.

## Kiểm chứng

- `npm run check`: đạt.
- Kiểm thử tập trung: 29 đạt; gồm hai trường lỗi thật, bảo toàn từ khóa/phạm vi,
  từ chối khôi phục ngoài phạm vi, giới hạn lượt sửa và retry cùng allocation.
- `npm test`: **999 đạt, 0 lỗi** (994 từ nền + 5 kiểm thử hồi quy).
- `npm run dist:portable`: đạt.
- `scripts/planner-hotfix-smoke.mjs` trên ASAR đóng gói: tái hiện trường lỗi đã
  báo, khôi phục đủ 11 từ khóa, không giới hạn tác giả, giữ tiếng Việt, khôi phục
  sau restart không lập lại kế hoạch, Start dùng đúng kế hoạch. Recipe hash
  planner đối chiếu với ASAR rebuild.5 giữ nguyên. Chỉ một phản hồi transport giả.
- `scripts/rebuild-app-smoke.mjs`: main/preload/renderer của ASAR đạt với dữ liệu
  tạm; chế độ OFF không gọi model, tiền và mặc định giao diện được giữ.
- ASAR trong portable cuối giống byte với ASAR đã smoke-test. File rebuild.5
  cũ giữ nguyên. Bằng chứng cục bộ ở `artifacts/r12-planner-hotfix/` của worktree.

**0 lần gọi API inference thật, 0 USD phát triển.** Chưa chạy lại API hoặc crawl
trên máy DELL; kiểm thử mock không phải số đo precision/recall hay chi phí thật
của một lượt người dùng. Bản vá giải quyết trường hợp đã xác nhận; không cam kết
mọi phản hồi LLM sai đều có thể khôi phục tự động.

## File bàn giao

`C:\OwnProject\crawl-socials\release\CSD-Portable-0.4.0-rebuild.5.1.exe`

- Dung lượng: 102.491.596 byte.
- SHA-256: `5d01b2389358224daeff18a5ab3f8b7fbc2ca4f5022afe20ad4eedecba52c3c1`.
- Đóng bản cũ, mở bản mới bằng cùng tài khoản Windows, dùng lại prompt gốc và
  chọn Thử lại kế hoạch/Xem tiêu chí trước khi thu. Không cần xóa dữ liệu hay key.
- Bản vá được commit trên nhánh riêng; không tự merge vào nhánh R11 hoặc
  production và không thay baseline được duyệt.
