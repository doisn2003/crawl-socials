# P02.02 — Nghiệm thu tối ưu security scan và LIVE v15

28/10/2026 Asia/Bangkok. Lead đã đọc source, tự chạy kiểm tra, nạp build và chạy một lượt nguồn thật. Schema current-post vẫn 14; v15 là nhãn lần triển khai, không phải schema mới.

## Kết luận

Bản sửa đã xử lý được lỗi TIME_LIMIT ở lượt thử này. LIVE **202 ms, SAMPLES_READY, 1 sample, 1 context hint**, 1.696 work steps; không hết node/time budget. Một post dialog bên trong một wrapper, một direct public-group signal, một message group. Không có auth/challenge/deny được phát hiện. Không khẳng định mọi DOM hoặc lần chạy sau đều có cùng tốc độ.

Lead đã kiểm nội dung local: bài nói về sang nhượng một quán cà phê, text 206 ký tự, VISIBLE_SNIPPET, thông tin liên hệ đã redact. Đây không phải xác nhận toàn bộ bài đã được thu; relevance cần audit riêng theo rubric, không tự loại sang nhượng. ID nhóm/ID bài và route lấy từ URL thực đang mở, provenance OBSERVED_CURRENT_URL, verification vẫn UNVERIFIED. Sample post_id/permalink/source_type vẫn thiếu/UNKNOWN; chưa mở lại route để đối chiếu. Không tính bài hợp lệ hoặc unique từ kết quả này.

## Kiểm tra trước khi nạp

- Review predicate: bỏ normalize thuộc tính không tồn tại, bỏ phrase trùng, dùng membership có delimiter và chặn delimiter trong input; giữ tập exact match, thứ tự union, sentinel và guards.
- Lead: 120/120 tests (18 search owner + 84 search reviewer + 10 current-post owner + 8 current-post reviewer).
- Lead native: 5 outcomes, 517 so sánh predicate, 0 sai khác. Cùng workload cũ mới: security XPath 1.078,2 → 99,9 ms; toàn lượt 1.100,3 → 126,4 ms. Tail auth/challenge/denied vẫn dừng với zero payload. Không dùng fixture làm bằng chứng khả năng nguồn.
- [Reviewer độc lập](adapter-p02-post-context-performance-review-2026-10-28.md): 92/92 regression; 10/10 cùng fixture hashes. Workload lớn nhất positive 1.275,3 → 166,4 ms, security cuối DOM/sentinel giữ đúng. Không blocker.
- Build PASS, 16/16 owner hashes và 129/129 frozen hashes khớp.
- Current-post script `613d6e954927f34539ce25c86e7332c7fb5c496ba8755f40d0733604db2aa3cd`; search script `44bebe027dd2694f3e8f72b997abd774963d85f7ebc8406246ca50de8cda4b8d`; controller `52bcc208934daa007633bc39c9300e3003e70240d02af2333ce0e6d9ffc05be4`.

## Lượt thật

Đóng app bình thường và khởi động build mới, giữ nguyên profile; không dùng `.env`, không yêu cầu login mới. Search cafe Hà Nội → bộ lọc bài công khai → timestamp quan sát được → route nhóm có một multi_permalinks và hai dialog lồng nhau. Không giả định kết quả tìm kiếm vẫn là bài cũ sau restart. Chạy đúng một action current-post, không scroll/See more/Join/tương tác.

- Run `candidate-b588a72b-8c8f-495b-8e7f-1d40f7166c42`, UTC 21:01:33.469–21:01:33.671 ngày 27/10.
- [Summary và observations sạch](p02-live-post-performance-v15-2026-10-28.json). Raw payload ở userData ngoài repo, hết hạn 03/11/2026 21:01:33.669 UTC; cleanup thủ công theo policy.
- Summary gốc SHA-256 `3518e615cf2fa123c0c2017afcd26fdf22a4b4d873bc153f2e18f3183bf08e04`.
- Payload SHA-256 `aa27d62070326ef61b0a86426211214085c7037e16adf5dbfeb2615dba5c15d5`.
- Runtime PID 19880, main window 6293944, source window 21238024; đang post dialog, 1/3 combined starts. Không lặp lại cùng đọc khi chưa có mục đích/evidence mới.

## Bước tiếp

Nghiệm thu thay đổi performance. P02.02 tiếp tục: đối chiếu route thực với body qua một lần mở lại có giới hạn, rồi lấy thêm ít mẫu trước continuation. Reviewer có thể audit relevance mẫu thật độc lập trong khi owner triển khai phần đối chiếu. V13 có 2 snippets và v15 có 1 sample; **không cộng thành 3 bài unique** vì chưa đối chiếu identity giữa các lượt. Permission UNKNOWN, benchmark OFF, verified valid 0 và mọi gate giữ nguyên.

### Audit nội dung — lead nhận ngày 28/10, 21:17 UTC ngày 27/10

Đã đọc [audit độc lập](adapter-p02-live-sample-audit-2026-10-28.md), đối chiếu với payload lead đã xem và rubric hiện hành. Chấp nhận **relevance ACCEPT / CAFE_BRAND_CONTEXT** cho sample 0: snippet đủ nghĩa về một quán cà phê; contract không loại sang nhượng. Payload hash và giới hạn evidence nhất quán. Đây chỉ là quyết định relevance, không chứng minh full text, containment không lẫn comment, identity/permalink/source hay valid unique. P06.01 chưa DONE từ một mẫu. Owner đang kiểm route verification; reviewer chuyển sang đọc implementation để phát hiện lỗi sớm, chờ freeze trước nghiệm thu cuối.
