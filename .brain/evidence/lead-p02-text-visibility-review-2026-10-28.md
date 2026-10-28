# P02.02 — Nghiệm thu code v7 và thử nguồn

Ngày 28/10/2026, Asia/Bangkok. [Handoff owner](../handoffs/p02-text-visibility-2026-10-28.md), [manifest](p02-text-visibility-files-2026-10-28.json), [reviewer lượt 15](adapter-p02-public-candidates-review-2026-10-27.md).

Lead đọc `layout`, Range của text, clip-frame cache/ancestor traversal, propagation của temporal owner, xử lý unknown/partial boundary, schema/validator/writer và fixture. Parent có box không còn đủ chứng minh text hiển thị. Clip không xác định làm boundary incomplete; không lấy prefix để ghép timestamp. R-V1 được đóng cho các ca tái hiện, không đồng nghĩa extractor đã đạt trên nguồn thật.

- Fresh compile cuối: **62/62 candidate tests PASS** (13 owner + 49 reviewer), gồm guard malformed Range length. Reviewer độc lập 49/49 PASS cùng snapshot. Không lặp suite metadata không liên quan.
- Lead chạy lại **3/3 native geometry cases PASS** trên build cuối: [evidence](lead-p02-text-visibility-native-2026-10-28.json). Owner có thêm temporal 3/3 và layout 3/3 PASS; lead đã đọc fixture và kết quả.
- Reviewer hiệu chỉnh padding của shared-budget fixture để workload một mình còn dưới 2500, thêm barrier thì chạm cap và không giữ partial payload. Không bỏ invariant. Native 96/97 dùng `white-space:pre` để whitespace thực sự render; giữ expected rejection của 97.
- **14/14 owned hashes khớp**, `npm run build` PASS, **129/129 frozen entries khớp**. Compiled controller của lead tests/shared dist/owner build giống nhau: `2d757df0e098439e84304412d46ad5efca0b1aeb3c9d6289691e16fe9387c2b4`. Script: `6d33353891fce4612a4e99201ad357b0f043905e997f6a1e59365ef570aa4cba`.

Đóng root20188 qua lifecycle, xác nhận process đã kết thúc; mở root3084/main5706236/source3476476 cùng profile. Session tự khôi phục, không nhập credentials. UI click ban đầu thiếu geometry; reobserve screenshot/activate rồi cuộn phần phiên vào viewport, không dùng tọa độ cũ. Screenshot vẫn có lớp tối/vùng sáng quanh con trỏ như lượt trước; không sửa thiết lập hoặc suy đây là auth barrier.

Query `cafe Hà Nội` và bộ lọc Bài viết công khai đã xác nhận. Chạy **một lượt LIVE v7**, [kết quả](p02-live-text-visibility-v7-2026-10-28.md). Runtime3084/source3476476 giữ profile/query/filter, 1/3 starts. Gate/permission/benchmark giữ nguyên. Bản code đạt kiểm tra nêu trên nhưng kết quả nguồn còn thất bại; giao sửa theo evidence.
