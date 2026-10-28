# V14 — Nghiệm thu code và lỗi thời gian ở lượt đọc thật

Lead đọc route hint parser, global security scan trước content-dialog exception, unique nested dialog/wrapper audit, article/header/body ownership và menu shared start budget. Independent reviewer: 8 post-context +84 search regression PASS. Lead fresh compile **120/120 tests PASS** (28 owner +92 reviewer), native current-post 3/3 và barriers 3/3 PASS, external requests0. Shared build PASS;15/15 owned và129/129 frozen hashes khớp trước activation.

Current-post script `ed4e51967912dab472d37230103a51d42df722cd1896ae0565f876ece8e633cd`; search script `8d60fece4e43d9b1705626aeb23976e412359975b4e8d6c47c2a02420d3f20fe`; controller `52bcc208934daa007633bc39c9300e3003e70240d02af2333ce0e6d9ffc05be4`. Đóng25524 bình thường, nạp25552/main1837224/source2230372 cùng profile; phiên tự phục hồi, không đọc.env.

Lead tìm lại cafe Hà Nội, chọn Bài viết công khai, mở đúng timestamp của một kết quả có graphic `Đã chia sẻ với Nhóm công khai`. Kết quả tìm kiếm đã thay đổi so với v13; không khẳng định đây là cùng bài. UI xác nhận numeric group path, đúng một numeric `multi_permalinks`, outer/inner post dialog. Không bấm Tham gia nhóm, không thu comments, không chạy search extraction lần nữa. Một action `Đọc 1 bài nhóm đang mở` được gọi.

[LIVE v14](p02-live-post-context-v14-2026-10-28.json): run `candidate-5620f5c6-63cd-43cb-a14e-0c5346c9bfad`,20:40:07.883–20:40:09.457Z,1574ms. **BARRIER_SCAN_INCOMPLETE / TIME_LIMIT**, visited0/inspected0/examined0,0samples/context hints. Script hết1s trước bước xử lý barrier candidate đầu tiên; không evidence AUTH/CHALLENGE/DENIED. Không được báo Facebook chặn hoặc retry nguyên build.

Source trước điểm này dựng/evaluate XPath security với nhiều `translate(normalize-space(...))` lặp trên mọi element/attribute/text, rồi evaluate dialog snapshot. XPath security là điểm nghi ngờ chính; chưa có stage timings để phân rã chính xác. Cần tái hiện trên native DOM đủ lớn và tối ưu predicate giữ nguyên semantics/sentinel. Không tăng1s/2500 hoặc bỏ security scan. Nếu cần timing thì chỉ fixed stage enum/count/ms trong summary, không DOM/text.

Summary SHA `1cdda07149c9de7e4f1483c4b664aeb14468ecc6322252c8047acdf21ed81eae`; empty payload SHA `c5af472c61fcfa3dbc14defea317f72e8c02ac12a19ec715e230053997f7b046`, ngoài repo, expires2026-11-03T20:40:09.454Z/manual cleanup. Runtime25552/source2230372 giữ post dialog,1/3 combined starts. V13 đã có2snippets thật nhưng chưa identity/valid; v14 không bổ sung bài. Permission UNKNOWN/benchmark OFF/valid0/gates giữ nguyên.

Giao [tối ưu quét security và native workload](../handoffs/lead-p02-post-context-performance-dispatch-2026-10-28.md), owner triển khai và reviewer kiểm độc lập. Sau freeze/review phải nạp và đọc source, không dừng ở fixture PASS.
