# P02.02 — Hỗ trợ wrapper ARIA thụ động đã thấy trên nguồn thật

28/10/2026, Asia/Bangkok. Tiếp nối ADR-016 và [LIVE v24](../evidence/p02-live-subtree-rejection-v24-2026-10-28.json). Metadata v24 đã nghiệm thu: lead 26 owner tests/2 native, reviewer 13 focused/2 native; 26 owned/69 isolated/135 shared frozen hashes khớp. Không finding còn mở.

## Evidence thực

Hai lượt 01:08:25Z và 01:09:10Z, 55/57 ms, 2162/2165 work steps, một header qualified, 0 click/read. Trước tương tác con trỏ: SEARCH_PLACEHOLDER/BLANK, preflight báo UNSUPPORTED, ATTR_NOT_ALLOWED, SPAN, ARIA_LABELLEDBY, D1. Sau một right-click timestamp rồi Escape: OBSERVED_POST/ABSENT; actual và preflight cùng báo đúng failpoint này. Header COLOCATED, rendered YES, visibility và viewport PASS; các control/role/download/disabled/popup/author/action-label predicates PASS. Không auth/challenge/deny. UI AX đếm link bài từ 0 lên 1, placeholder từ 5 xuống 4; chưa cô lập sự kiện con trỏ nào làm đổi href.

Runtime lead 20884, main 460040, source 4001400, search công khai cafe Hà Nội, 2/3 starts đã dùng. Không scroll hoặc click điều hướng thủ công. Profile đăng nhập còn nguyên; không đọc .env.

## CSD agent — triển khai

Sửa hẹp để classifier chấp nhận `aria-labelledby` trên HTML SPAN thụ động trong subtree đã giới hạn, như metadata accessibility không quyết định eligibility. Giữ giới hạn chuỗi/attribute/traversal hiện có. Không dereference IDREF, không truy tìm element ngoài target, không dùng label này làm bằng chứng text/thời gian/public/visibility; không đưa giá trị/ID vào summary. Vẫn kiểm children, namespaces, control/heading/media, CSS/glyph/ink, clip/viewport và unique observed-header proof như trước. Thuộc tính không được làm subtree vốn hỏng trở thành pass hoặc bỏ qua descendants. Nếu cần thay đổi thêm ngoài điều đã quan sát, báo lý do cụ thể trước, không tự mở toàn bộ ARIA/style/media.

Focused checks cần có: wrapper aria-labelledby với inline text/SVG hợp lệ có thể đạt cùng proof; giá trị bị bỏ qua không ảnh hưởng proof; hidden/transparent/media/control/unknown descendant vẫn bị loại; BLANK vẫn NEW_WINDOW; giới hạn chuỗi/budget và stale binding giữ nguyên. Native positive và negative đủ cho thay đổi, không chạy rộng phần không đổi. Có thể chuẩn bị thiết kế bounded pointer activation dựa vào link đã quan sát trong handoff, nhưng chưa thêm action vào runtime ở task này.

Giữ ownership production/owner tests/isolated build cũ. Handoff/evidence prefix p02-passive-aria-wrapper-. Không shared dist/runtime/profile/.env/master/README hoặc reviewer files. Freeze rồi báo lead; không chạy nguồn.

## csd_adapter — review

Review focused sau freeze: ARIA chỉ là metadata thụ động, không dùng dữ liệu ngoài target hoặc bỏ qua subtree/visibility proof, kiểm negative/bounds và stale binding phù hợp. Giữ tests/evidence/build riêng. Không tạo thêm worker.

## Lead sau freeze

Review code/hash/tests rồi nạp bản mới bảo toàn profile. Chạy diagnostic nhỏ trên nguồn thật, dùng facts để quyết định bước tiếp theo. Không đánh đồng pointer khảo sát thủ công với tự động tìm → mở → đọc. Chưa thêm auto-scroll/continuation; permission UNKNOWN, benchmark OFF, valid 0, gates giữ nguyên.
