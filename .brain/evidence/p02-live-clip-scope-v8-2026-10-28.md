# P02.02 — LIVE v8 hết ancestor miss, còn clipping uncertainty

Ngày28/10/2026 Asia/Bangkok, sau [nghiệm thu v8](lead-p02-clip-scope-review-2026-10-28.md). Runtime22544/main1315448/source459796; query `cafe Hà Nội`, public filter. Filter không thay chứng cứ public của từng bài.

- Run `candidate-86c2546b-0836-4d1e-a18d-9d5c90b4227f`, schema8/LIVE; UTC `2026-10-27T18:13:13.354Z`→`.409Z`, **55ms**, 01:13:13 giờ địa phương.
- **NO_PUBLIC_CANDIDATE,0samples**, actions1, visited1970/examined2/pruned128; không node/time/boundary/candidate cap. CLEAR/inspected2/hidden2/visible0. MAIN_FALLBACK/SEARCH_TOP_MIXED; feed1/main1, cả hai INCOMPLETE_BOUNDARY, thêm1NO_COLOCATED_BOUNDARY.
- Geometry: range260/positive11/zeroArea123/clipped120/unknown39. **UnknownApi0/Rect0/Ancestor0, UnknownClip6/Partial33**. ClipChecks358/cacheHits311/ancestorSteps17/misses0/propagations342. Counters là attempts và có recheck, không unique text hoặc bài.
- Temporal: roleLinks3/unmatched3, rangeSegments1/rangeChars6, zeroSegments121/clippedSegments120/unknownSegments33; char/node text limits0. Header clusters0; main article thấy public label1 và body region1 nhưng không temporal.
- `fallbackScan=BARRIER_STOP` trong khi barriers=CLEAR là metadata gây hiểu nhầm: code dùng tên đó cho nhánh `examine` trảfalse vì boundary incomplete, không chỉ barrier thật. Không báo user Facebook chặn từ enum này.

V8 xử lý được cơ chế ancestor lặp: không còn ancestor miss hoặc node cap ở lượt này. Chưa biết partial geometry là glyph bị cắt thật, sai số/line-box của model, hay clip style chưa hỗ trợ. Không nới epsilon hoặc bỏ clipping để ép timestamp. Cần reason/geometry shapes nhỏ theo enum/count để phân biệt và fixture native trước khi sửa predicate. Cần tách lỗi local boundary với global stop: một boundary không xác định không được giả làm barrier hoặc tự cắt hết scan các boundary đã tải nếu còn budget; vẫn không lưu sample của boundary đó.

[Summary nguyên bản](p02-live-clip-scope-v8-2026-10-28.json), SHA256 `be686c636dc1f0ecbf0c1ada43c1756c7e1f8893c719c84c3af100fd124b8611`. Payload rỗng ngoài repo, không đọc/dump; SHA256 `0228c291f78b8a18a443fb702ada2b79c6482e6efb888ff5afbebf634b04b5ba`. Script/controller khớp manifest nghiệm thu. Retention đến `2026-11-03T18:13:13.406Z`, cleanup thủ công hiện hành.

Giữ runtime22544/source459796/query/filter,1/3starts; không lặp v8. Permission UNKNOWN/benchmark OFF/valid0/gates giữ nguyên. [Dispatch tiếp](../handoffs/lead-p02-local-clip-dispatch-2026-10-28.md).
