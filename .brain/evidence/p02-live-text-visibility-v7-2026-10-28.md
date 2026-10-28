# P02.02 — LIVE v7 chạm budget trong boundary đầu

Ngày 28/10/2026, Asia/Bangkok. Sau [review v7](lead-p02-text-visibility-review-2026-10-28.md), runtime3084/main5706236/source3476476, cùng phiên đã đăng nhập. Query `cafe Hà Nội`, public filter; filter không được dùng thay chứng cứ publicity của bài.

- Run `candidate-9008b4a1-f248-4df0-a1ed-1666a02ad3cc`, schema7/LIVE; UTC `2026-10-27T17:55:54.181Z` → `.215Z`, **34 ms** (00:55:54 giờ địa phương).
- **NO_PUBLIC_CANDIDATE, 0 candidates**, actions1; CLEAR, inspected2/hidden2/visible0. FEED_IN_MAIN/SEARCH_TOP_MIXED, visited2500/examined1/pruned37. **Node limit true**, time limit false; boundary đầu INCOMPLETE, không fallback.
- Text ranges119, misses118, parentBoxes119, rangePositive0, zeroArea57, unknown61, **clipChecks0**. Một Range attempt đang dở khi budget hết nên totals không phải phương trình khép kín.
- Temporal roleLinks2, zeroSegments57/unknownSegments58, rangeSegments0/rangeChars0; char/node text limits0, chưa match ngày. Header1, body0/public0 ở boundary PARTIAL chỉ là phần đã đọc, không chứng minh bài thật thiếu body/public.

Đã có bằng chứng nguồn rằng 57 text attempts không có area dù parent có box. Chưa có bằng chứng 61 unknown cùng một nguyên nhân: schema7 chưa tách nhánh unknown. `textClip` hiện dò tối đa32ancestor từ mỗi text tới body/cache, chỉ ghi cache sau khi resolve thành công. Chuỗi chưa chạm body/cache trả unknown mà không cache, có thể lặp 32 bước cho nhiều sibling; clipChecks0 + node cap phù hợp giả thuyết này, chưa chứng minh chính xác cấu trúc DOM thật. Cần tái hiện và sửa propagation/caching từ traversal đã biết, thêm reason counters; không tăng cap hoặc bỏ clipping để lấy kết quả.

[Summary nguyên bản](p02-live-text-visibility-v7-2026-10-28.json), SHA256 `9f1ad5bc5386f9e40d2a6a6f6bb97892fad3c8e6f2a2d03a5b4bbc7c1e7a9fd1`. Payload rỗng ngoài repo, không đọc/dump; SHA256 `bb6df7cee0fa5347e1b77c45283440caa9313cc4b85e4b7c361261ca11077013`. Script/controller hashes khớp bản đã nghiệm thu. Retention đến `2026-11-03T17:55:54.213Z` theo cleanup thủ công hiện tại.

Giữ runtime3084/source3476476/query/filter, 1/3 starts; không lặp v7. Permission UNKNOWN, benchmark OFF, verified valid0, gates giữ nguyên. [Việc tiếp: clip scope](../handoffs/lead-p02-clip-scope-dispatch-2026-10-28.md).
