# P02.02 — Lead review subtree rejection metadata v24

28/10/2026, Asia/Bangkok. Scope: metadata-only first rejection, opening schema 5, giữ whitelist/eligibility/action policy v23. Owner freeze 2026-10-28T01:00:50.786Z tại p02-subtree-rejection-files-2026-10-28.json.

## Kiểm độc lập của lead

- Đọc classifier, first-failure recorder, actual/preflight reuse, closed-enum validator và final budget guards. Instrumentation chỉ dùng facts đã đọc; không thêm traversal hoặc action. Các nhánh trước gộp được tách để ghi đúng reason, thứ tự từ chối được giữ.
- 26 owner tests chạy lại bằng output riêng của lead: PASS. Complete-script projection đối chiếu baseline v23; unknown names/values không được đưa vào metadata; binding/Stop/barrier/deadline giữ nguyên.
- 2 native checks do lead chạy: observed-wrapper-attribute và observed-time PASS; evidence lead-p02-subtree-rejection-{attribute,time}-2026-10-28.json. Wrapper ATTR_NOT_ALLOWED/ARIA_HIDDEN và cạn ngân sách vẫn không dispatch click/read.
- 26 owned + 69 isolated build hashes khớp owner manifest. Shared build PASS; 135 frozen artifact/input hashes khớp. Chưa nạp LIVE trước review final của reviewer.
- UI inventory hiện tại không còn cửa sổ CSD; runtime 22288 trong tài liệu là thông tin lịch sử, cần kiểm process trước khi launch v24. Không xóa/reset profile.

Reviewer final PASS, không finding: 13 focused checks (11 reviewer + 2 owner) và 2 native, 26 owned/69 copied build hashes khớp. Report/receipt: adapter-p02-subtree-rejection-review-2026-10-28.md và adapter-p02-subtree-final-files-2026-10-28.json. **Nghiệm thu metadata v24.**

## LIVE v24

PID cũ 22288 không còn; lead launch v24 PID 20884, main 460040/source 4001400, giữ profile đăng nhập. Khôi phục query cafe Hà Nội và Bài viết công khai. Không scroll. [Hai summary đã làm sạch](p02-live-subtree-rejection-v24-2026-10-28.json) giữ hashes và facts, không raw bài/URL/ID.

- 01:08:25.805Z, 55 ms/2162 steps: placeholder BLANK, preflight first failure ATTR_NOT_ALLOWED/SPAN/ARIA_LABELLEDBY/D1, subtype UNSUPPORTED; viewport/visibility PASS.
- Lead right-click timestamp đúng một lần rồi Escape, không chọn menu hoặc click điều hướng. UI AX link bài tăng 0→1, placeholder giảm 5→4. Chưa cô lập event gây đổi.
- 01:09:10.712Z, 57 ms/2165 steps: OBSERVED_POST/ABSENT; actual guard và preflight đều báo ATTR_NOT_ALLOWED/SPAN/ARIA_LABELLEDBY/D1. Header COLOCATED, viewport/visibility PASS. Cả hai 0 click/read, không auth/challenge/deny.

Đây là một hạn chế classifier CSD đã xác định, chưa phải bằng chứng Facebook chặn lượt này. Giao [passive ARIA wrapper](../handoffs/lead-p02-passive-aria-wrapper-dispatch-2026-10-28.md), chưa thêm auto-hover/popup hoặc nới các descendant guards. Runtime còn 1/3 start. Permission UNKNOWN, benchmark OFF, valid 0, task/gate không đổi.
