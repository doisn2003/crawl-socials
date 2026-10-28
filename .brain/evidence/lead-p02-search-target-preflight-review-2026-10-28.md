# P02.02 — Review target preflight (v22)

28/10/2026, Asia/Bangkok. Theo [dispatch](../handoffs/lead-p02-search-target-preflight-dispatch-2026-10-28.md). **R-PF1 CLOSED; v22 đã nạp và chạy ba lượt LIVE.** Runtime26544/source2887068 đã dùng3/3starts; không reset budget của bản cũ.

Lead đọc schema3, classifier target kind, deferred preflight và đường FINISH. Preflight chỉ đọc known frames/attributes/rects, không gọi `visibleSignal`/`textClip` trên candidate state. Output enum/count,5shapes. Compile riêng và16 owner tests PASS; native isolation/facts/viewport do lead chạy độc lập PASS, network0. Các kiểm tra này chưa bao phủ chặn action sau khi preflight làm hết hard deadline.

## R-PF1 — Hết deadline trong preflight nhưng vẫn click

Lead phát hiện `preflightSpend` throw khi deadline/cap hết nhưng catch không cập nhật stop flags, còn FINISH chỉ nhìn flags scan cũ trước bind/click. Reviewer tái hiện bằng complete DISCOVER→CLICK scripts: eligibility đã xong, lần đọc target trong preflight làm monotonic clock chạm1.000ms; facts INCOMPLETE nhưng actual click vẫn1.

Lead chạy lại frozen repro độc lập, exit1, expected0/actual1. Baseline `.test-build-adapter-candidate/search-preflight-budget-failed/`, test pattern `review preflight hard budget:`. Đây là blocker activation; không phải lỗi Facebook hay kết quả LIVE.

Đã giao owner guard budget cuối cả DISCOVER/CLICK, kể cả sau aggregation: giữ history/facts đã quan sát nhưng không bind hoặc phát click mới nếu đã hết cap/deadline. Reviewer thêm counterpart node cap và giữ failed baseline. Chỉ nghiệm thu sau freeze mới + regression chứng minh0click. Không thay target/popup policy hoặc giới hạn.

## Kiểm bản sửa R-PF1

Owner [freeze mới](p02-search-target-preflight-budget-files-2026-10-28.json) lúc23:44:45Z. Lead đọc `openBudgetExhausted`, guard sau aggregation, trước/sau observer setup và ngay trước native click. Khi hết ngân sách, flags được đặt và SCAN_INCOMPLETE chặn bind/click; eligibility history vẫn được báo riêng.

- Compile riêng +17 owner tests PASS.
- Hai full-script reviewer repros trên output lead đều chuyển PASS: hết1s và dùng đủ2.500steps đều0click.
- Ba native độc lập PASS: deadline khi DISCOVER, deadline khi CLICK và isolation giữa blocked BLANK geometry unknown với timestamp hợp lệ; network0.
- Build PASS,26 owned hashes/135 frozen artifact hashes khớp. Controller SHA-256 `c11f5f9193a4598fee036931ab6a141fb76a5f4266dcbf3cd1331719a773f594`; default search/current-post script hashes không đổi.

Reviewer đang kiểm final từ freeze mới. Chưa chạy nguồn thật bằng bản này ở thời điểm ghi mục này.

## Nghiệm thu cuối và LIVE

[Reviewer final](adapter-p02-search-target-preflight-review-2026-10-28.md):38checks và4native PASS,26owned/68isolated build hashes khớp. Lead chấp nhận fix, build chung26owned/135frozen hashes khớp, nạp v22 bảo toàn profile. Các kết quả offline chỉ nghiệm thu implementation.

[Ba summary LIVE đã làm sạch](p02-live-search-preflight-v22-2026-10-28.json):

- 23:52:02Z:59ms,2010steps, một placeholder BLANK/media FAIL/viewport FAIL;0click/read.
- Sau hai scroll UI650px,00:05:23Z:21ms,18steps, UNSUPPORTED_OVERLAY. UI cho thấy toast “Đã khôi phục kết nối Internet”; lead đóng toast, xác nhận đã mất trước phép thử tiếp. Không phải auth/challenge/deny.
- 00:06:15Z:49ms,1931steps/7examined, ba qualified headers. Một OBSERVED_POST target ABSENT, header COLOCATED, rendered/visibility/viewport PASS; temporal không được nhận dạng, media predicate FAIL. Hai placeholder BLANK khác còn ngoài viewport.0click/read.

Viewport đã được giải quyết cho một link bài thật; không cần mở popup ở bước tiếp. Media predicate gộp nhiều loại nên chưa có bằng chứng loại tag thực. Giao [unique observed header link + bounded media classification](../handoffs/lead-p02-observed-header-link-dispatch-2026-10-28.md), không tuyên bố đã tự mở bài thành công. Giữ permission UNKNOWN/benchmark OFF/valid0/gates.
