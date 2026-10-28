# P02.02 — Nghiệm thu search → timestamp → bài (v19)

28/10/2026, Asia/Bangkok. Theo ADR-016. Lead đã đọc controller, fixed script hooks, URL classifier và menu integration, đồng thời đối chiếu các findings R-SO1/R-SO2 với sửa đổi thực tế.

## Kiểm tra độc lập

- 172 tests thuộc search/current-post/route-verifier/search-open và reviewer suites PASS sau compile riêng. Lượt trước có 5 lỗi vì fixture matcher của reviewer chưa hỗ trợ selector heading mới; reviewer sửa harness đúng DOM semantics, không sửa kỳ vọng các ca popup/author/Stop. Không gọi lỗi harness là lỗi nguồn thật.
- Native `obfuscated`, `popup`, `rel-author`, `header-stale`: 4/4 PASS. Timestamp mờ chữ vẫn mở đúng một bài qua handler SPA; menu/author và wrapper bị thay không click. Không external request, không cửa sổ/webContents tồn dư.
- Default search/post fixed script hashes giữ nguyên. Discovery/click variants mới có hash riêng; chọn target cùng header public-group, bind node/root/header/public/body/href, revalidate trước duy nhất một click. Không load placeholder hoặc tạo post route.
- `npm run build` PASS; 31 owned files và 135 frozen artifact/input hashes khớp `p02-search-post-open-files-2026-10-28.json`. Search-open compiled SHA-256 `d659257dcb1eced2ac591241652cdd3fc3f5988c31d1e5de0f1e8ebaaa038b26`.

Reviewer final [PASS](adapter-p02-search-post-open-review-2026-10-28.md):112 checks và3 native scenarios riêng;31 source/67 copied native build hashes khớp. R-SO1/R-SO2 đóng, không blocker còn mở. Lead nghiệm thu cho một thử LIVE.

## Kết quả LIVE v19

Lead graceful restart giữ profile, PID13252. Sau tìm `cafe Hà Nội` và lọc công khai, UI có hai group-public headers; chạy đúng một action mới.

- Run `candidate-e27be489-04ed-4294-b957-3fe9b3a94413`,52ms, **INCONCLUSIVE / NO_ELIGIBLE_TIMESTAMP**.
- Discovery SAMPLES_READY,1.832steps/7examined, qualified_headers2/no_timestamp_headers2, ambiguous_headers0, targets0.
- Click attempts0, click0, post reads0, không navigation event. Không chạy lại trên build cũ.
- Evidence này chứng minh đã qua guard header nhưng chưa qua eligibility của timestamp. Summary chưa phân biệt filter loại target; chưa biết là visibility, URL, viewport, co-location hay điều kiện khác. Không kết luận Facebook chặn hoặc thiếu bài.

[Evidence sạch/hashes](p02-live-search-post-open-v19-2026-10-28.json). Đã giao [instrumentation hẹp](../handoffs/lead-p02-search-target-diagnostics-dispatch-2026-10-28.md) cho main; reviewer kiểm độc lập. Runtime13252/main1900748/source3539992,1/3starts. Giữ permission UNKNOWN, benchmark OFF, valid0; chưa pilot5 hoặc continuation.
