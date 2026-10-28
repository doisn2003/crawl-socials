# P02.02 — Đo target và các điều kiện còn lại trên timestamp

28/10/2026, Asia/Bangkok. Tiếp nối ADR-016; không mở thêm action hoặc collector.

[LIVE v21](../evidence/p02-live-search-fragment-v21-2026-10-28.json) đã nhận hai timestamp placeholder sau sửa fragment, nhưng cả hai bị target guard NEW_WINDOW loại. Chưa biết giá trị target category hoặc các điều kiện sau guard. Không suy mặc định là `_blank`, không gọi đây là popup/deny thật.

## CSD agent

Trong fixed scan hiện có, thêm target category enum ABSENT/EMPTY/SELF/BLANK/TOP/PARENT/NAMED/INVALID và preflight chỉ đọc cho các record đã qua href classifier. Preflight cho biết các điều kiện còn lại: popup/author/control/media/action label, header co-location, rendered/visibility và viewport. Chỉ enum/count/boolean, không raw target, text, href, ID, tọa độ hay DOM dump. Tối đa5 shapes; vẫn giới hạn2.500steps/1s/script,4s/main,32KiB. Khi không đánh giá được trong budget thì ghi NOT_CHECKED/INCOMPLETE.

Giữ nguyên first decisive rejection và quyết định eligibility; preflight không được làm thay đổi `c.visibilityUnknown`, binding, selection hoặc dispatch. Không tự chấp nhận BLANK, sửa target attribute, thêm click/scroll/retry hay mở cửa sổ. Native popup deny của BrowserHost không đổi. Không làm framework telemetry chung; chỉ thêm facts cần cho hai timestamp đang bị loại để tránh phải sửa rồi restart từng guard.

Fixture kiểm target categories, redaction/bounds và equivalence của action trước/sau instrumentation, gồm target đổi/stale, geometry không rõ, menu/author và các ca được/không được click hiện có. Freeze `p02-search-target-preflight-*`; không shared dist/runtime/profile/.env/master/README/reviewer tests.

## csd_adapter

Kiểm chỗ tích hợp và mọi state mutation dùng bởi preflight; budget không được reset hoặc bỏ qua. Chuẩn bị reviewer equivalence/boundary tests, chạy focused checks sau freeze và báo core-ready. Reviewer chỉ sửa tests/evidence/build riêng, không production hoặc UI/account.

## Lead

Runtime22252/main4723190/source4917500, search công khai cafe Hà Nội,1/3starts. Sau review nạp build mới và một lượt diagnostic. Dùng target category cùng preflight thực để quyết định patch cụ thể, không nới guard theo giả thuyết. V18 REOPEN_MATCH còn giá trị; v21 chưa tự mở bài. Permission UNKNOWN, benchmark OFF, valid0/gates giữ nguyên.

## Review trước activation

Freeze đầu23:31Z bị chặn bởi [R-PF1](../evidence/lead-p02-search-target-preflight-review-2026-10-28.md): deadline hết trong preflight nhưng FINISH vẫn click. Reviewer và lead cùng tái hiện complete-script expected0/actual1. Owner đã nhận yêu cầu guard budget cuối DISCOVER/CLICK, không bind/click sau cap/deadline; equivalence chỉ áp dụng khi còn budget. Không nạp freeze này; runtime vẫn v21 cho đến khi sửa và nghiệm thu.
