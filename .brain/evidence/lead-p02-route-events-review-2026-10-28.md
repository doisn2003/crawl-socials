# P02.02 — Nghiệm thu xử lý sự kiện route (v17)

Ngày 28/10/2026, Asia/Bangkok. Lead đọc code verifier và menu resolver, đối chiếu handoff và manifest `p02-route-events-files-2026-10-28.json`. Kết quả LIVE v16 vẫn INCONCLUSIVE; fixture không xác định được sự kiện gây lỗi ở lần chạy đó.

## Kiểm tra độc lập của lead

- Compile riêng và 145 tests thuộc search candidate, current post, route verification và reviewer suites: PASS.
- Ba native scenarios `same-read`, `away-return`, `trace-overflow`: 9 outcomes PASS, không request ngoài, không cửa sổ/webContents còn lại. Evidence ở `lead-p02-route-events-*-2026-10-28.json`.
- Đọc cả reader watchLoss và verifier watchNavigation: same-document chỉ no-op khi URL sự kiện và URL hiện hành bằng chính xác, owner/view và document generation phù hợp. Full navigation, thay URL rồi quay về, redirect, Stop vẫn dừng. Search resolver giữ mặc định nghiêm ngặt.
- Trace tối đa 16 sự kiện chỉ chứa enum/count; lần hủy đầu tiên được giữ nguyên. Không thêm retry, delay hoặc tăng ngân sách đọc.
- `npm run build` PASS. 23 owned files và 131 frozen artifact/input hashes khớp. Verifier compiled SHA-256 `e52e1e3749aec1d9b6e55e554c6e61dd6cb7d6010365622c8f3f744f1052f568`; reader compiled giữ `d2309718815267a5bbd4bddb5728f172a9c07d1f0b81d71c50403f4997eb5558`.

Reviewer đã chốt [review độc lập](adapter-p02-route-events-review-2026-10-28.md): 45 tests liên quan và 7 native scenarios/21 outcomes PASS; 23 owned hashes khớp. Lead nghiệm thu bản sửa cho phép thử có giới hạn.

## Kết quả LIVE v17

Lead đóng bình thường runtime cũ, nạp build mới PID 20608 và mở lại profile đã lưu; không dùng `.env` hoặc yêu cầu đăng nhập lại. Tìm `cafe Hà Nội`, lọc bài công khai, mở timestamp của một bài có nhãn nhóm công khai.

- Anchor `candidate-d34ae878-7db7-4eb6-b98a-2d2c10e235be`: SAMPLES_READY, 1 sample/1 hint, **220 ms**, 1.883 work steps, không cap/barrier. Nội dung VISIBLE_SNIPPET, chưa chứng minh full text hoặc unique.
- Verification `candidate-720cfda2-2e70-40ff-9aea-1b3214b29189`: **INCONCLUSIVE / OWNER_CHANGED**, 387 ms; 1 navigation, **0 fresh reads**.
- Trace ghi START rồi COMMIT của MAIN với URL EXACT, owner SAME và generation +1. Tiếp theo, `DID_NAVIGATE_IN_PAGE` của **SUBFRAME** bị hủy bởi `SUBFRAME_HISTORY`, dù URL hiện hành của main vẫn EXACT và owner/generation giữ nguyên. Không overflow.
- Đã xác định nhánh code trực tiếp gây hủy ở lần v17. Đây không phải bằng chứng Facebook từ chối truy cập, cũng không xác định được sự kiện của lần v16 chưa có trace. Guard đang coi history frame con là mất owner của document chính.

Evidence đầy đủ đã làm sạch và hashes: [LIVE v17](p02-live-route-events-v17-2026-10-28.json). Raw payload ở userData, TTL 7 ngày, cleanup thủ công. Runtime 20608/main 1249128/source 5178426, dùng **2/3 starts**; không lặp lại trên build chưa đổi.

Đã giao [sửa frame con](../handoffs/lead-p02-subframe-events-dispatch-2026-10-28.md): CSD agent triển khai; csd_adapter kiểm độc lập. Chỉ no-op khi main context nguyên vẹn, giữ main navigation/owner/Stop/barrier guards và fixed script không đọc frame con. Sau review, lead chạy lại nhỏ trước bước nhiều candidates.

Permission UNKNOWN, benchmark OFF, valid unique 0; không thay task DONE hoặc gate từ fixture.
