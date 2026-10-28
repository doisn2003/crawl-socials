# P02.02 — Review và nguồn thật v16: đối chiếu route

28/10/2026 Asia/Bangkok. Nghiệm thu code bounded verification theo ADR-015; nguồn thật còn một lỗi xử lý navigation cần sửa. Không chạy lại cùng verification hoặc nâng gate.

## Review và kiểm chứng

Lead đọc verifier mới, menu/fence/document counter, qualifying completion callback của reader và fixtures. Anchor chỉ từ successful owned run đã persist, consume-once; exact observed route, new document và liên kết fresh run/hash; không lấy URL tùy ý hay xây `/posts/`. Stop/redirect/owner change và native pending vẫn chặn kết quả muộn. Chỉ bản proof local có owner/context; summary không có body/IDs/URL.

- Lead 138/138 tests PASS: owner40, reviewer98; gồm search/current reader và verifier.
- Lead tự chạy 5 native scenarios /15 outcomes: match, changed body, challenge, redirect, pending navigation + Stop. Tất cả PASS, không external source request, không cửa sổ/webContents tồn đọng.
- [Reviewer frozen PASS](adapter-p02-route-verification-review-2026-10-28.md):36 tests liên quan +5 native/15 outcomes, không blocker. Phân biệt receipt sơ bộ và hash frozen cuối.
- Owner20/20 hashes và shared131/131 frozen hashes khớp. Fixed script vẫn `613d6e954927f34539ce25c86e7332c7fb5c496ba8755f40d0733604db2aa3cd`; reader controller `d2309718815267a5bbd4bddb5728f172a9c07d1f0b81d71c50403f4997eb5558`; verifier `ae9ef399f5eaa64d0683d7981e54ce5457e90dd52a1dff5330404926af6aaa6f`.

## LIVE sau activation

Đóng app bình thường, giữ profile và đăng nhập. Search cafe Hà Nội + bài công khai, mở timestamp đã quan sát; đúng group route có một multi_permalinks và nested post dialog. Không tự coi bài tìm được sau restart là bài cũ.

1. Anchor `candidate-a68b24e6-3d54-43a1-a4e0-c972f11287e9`: UTC21:30:39.359–.806,447ms; SAMPLES_READY/1sample/1hint/1696steps, no cap/barrier.
2. Verification `candidate-a9ca472e-dc1d-46b1-8f55-36bb1a82607e`: UTC21:31:00.903–21:31:01.794,891ms; **INCONCLUSIVE / ROUTE_CHANGED**,1navigation/1read/fresh_document=true. Fresh reader `candidate-b05823b3-9e87-43c0-906a-8fd0c215eaaf` dừng STOPPED,0sample. Verifier không có fresh read ref vì bị cancel trong khi đọc. Chưa ghi loại event gây cancel, vì vậy không kết luận chắc là same-document event hay redirect.
3. Sau khi UI ổn định, lead đọc AX: route cuối có đúng một multi_permalinks; URL **khớp chính xác** anchor observed_route; hai dialog và direct public-group signal còn hiện. Không bằng chứng auth/challenge/deny.
4. Dùng start thứ ba/cuối cho **một current-post diagnostic riêng** ở trạng thái đã ổn định, không retry verification: `candidate-d91f26d1-6266-4b80-8fae-e150f183b256`,UTC21:32:25.174–.385,211ms,SAMPLES_READY/1sample/1hint/1696steps. Lead so local artifacts: redacted body, context hint và text quality khớp anchor byte-for-byte; vẫn VISIBLE_SNIPPET, không tuyên bố full text. Đây là evidence thuận lợi cho route/body, không sửa INCONCLUSIVE lịch sử thành REOPEN_MATCH.

[Bốn summary và quan sát sạch](p02-live-route-verification-v16-2026-10-28.json) giữ refs/hashes/timestamps. Raw local artifacts theo userData/TTL7ngày/manual cleanup. Không thêm unique vì đọc lại cùng context; valid0, permission UNKNOWN, benchmark OFF/gates giữ nguyên.

Runtime PID10544/main1836010/source1246228, post dialog; **3/3 combined starts đã dùng**, không đọc thêm hoặc restart chỉ để reset budget.

## Kết luận và bước sửa

Khả năng mở lại trang và đọc body sau ổn định đã có evidence; automated verifier chưa xử lý được một navigation event trong giai đoạn read. Cần event trace nhỏ có enum/phase/URL-equality/generation, không raw URL. Tái hiện same-URL SPA history event và những trường hợp thay đổi thật. Có thể giữ nguyên operation với same-document event chỉ khi URL chính xác không đổi và document generation/owner không đổi; khác URL, redirect, full navigation, owner loss phải tiếp tục dừng. Phải kiểm riêng fixed-reader watchLoss, không chỉ sửa outer verifier. Chỉ xem đây là giả thuyết sửa có kiểm chứng, không tuyên bố đã tìm chắc event gây lỗi LIVE.

Giao theo [dispatch event handling](../handoffs/lead-p02-route-events-dispatch-2026-10-28.md), giữ ADR-015 limits; sau freeze/review lead thử một anchor + một verification mới.
