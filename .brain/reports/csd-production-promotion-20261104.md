# Đưa rebuild.5.3 vào production — 04/11/2026

Người dùng chỉ định rõ nhánh production sau khi nhận các bản vá trong chat này.
Nhánh đích: `codex/csd-production`; nguồn được chọn: R14 `16f61c2`.
Nhánh cũ `5981125` là tổ tiên của nguồn nên cập nhật fast-forward, không reset
hoặc bỏ commit cũ và không có xung đột. Nhánh theo dõi remote là
`origin/codex/csd-production`.

Phạm vi: nền rebuild/R10, khôi phục planner R12, theme sáng/slider/Start một
thao tác R13, toggle bình luận/cảnh báo vàng có điều kiện/bỏ thẻ chế độ và sửa
đối chiếu xuống dòng + tái sử dụng phản hồi đã lưu R14. Phiên bản package vẫn
**0.4.0-rebuild.5.3**, không cần tạo executable khác cho thay đổi chỉ ở Git/docs.

QUALITY v2 của R11 không nằm trong lịch sử được promote. R11 đã không đạt gate
recall/cost; không tự lấy ứng viên đó chỉ vì có commit mới hơn. Các giới hạn
spending sau pilot R11 vẫn được ghi lại trong AGENTS dù không đưa code v2 vào.

Kiểm tra ở worktree production riêng:

- `npm run check`: đạt.
- `npm test`: 1.011 đạt, 0 lỗi.
- Source, package, scripts và tests trùng R14 `16f61c2`; thay đổi sau đó chỉ là
  chỉ dẫn Git/ngân sách và báo cáo promotion.
- Commit QUALITY v2 `5b44ee4` không phải tổ tiên của production mới.
- Kiểm tra branch/ref sau khi push để xác nhận bản trên remote.

Portable đã bàn giao giữ nguyên:
`C:\OwnProject\crawl-socials\release\CSD-Portable-0.4.0-rebuild.5.3.exe`
SHA-256: `f7ff0a626a6967f1b904917ab688b986642485b79b7ab701bf66b7c0a7e10fd6`.
Các kiểm tra ASAR và mock UI/planner đã có ở báo cáo R14, không phải một phép
đo chất lượng phân loại mới.

Không mở app production hoặc chạy crawl/API thật. Không thay AppData, key,
export chưa theo dõi hoặc ledger. **0 lần inference thật, 0 USD API**.
Workspace gốc vẫn ở nhánh R11 đang phát triển; worktree production tại
`C:\OwnProject\crawl-socials-production` để tránh đụng công việc đó.
