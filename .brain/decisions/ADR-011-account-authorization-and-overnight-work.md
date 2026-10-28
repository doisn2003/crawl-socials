# ADR-011 — Quyền dùng tài khoản và tiếp tục qua đêm

Ngày28/10/2026, Asia/Bangkok. Người dùng trực tiếp yêu cầu tiếp tục điều phối hai worker, chủ động xử lý bài toán khi họ đi ngủ; đã cung cấp tài khoản Facebook trong `.env` và cho phép truy cập/sử dụng tài khoản đó cho CSD.

- Quyền này áp dụng cho tài khoản người dùng giao và công việc CSD đang làm; không cần hỏi lại quyền dùng tài khoản. Chưa đọc nội dung `.env` để ghi nhận quyết định này. File đã nằm trong quy tắc ignore hiện tại.
- Lead giữ thao tác tài khoản/phiên/runtime. Ưu tiên phiên CSD đang đăng nhập, không thay hoặc chép profile vì đã có credentials. Worker tiếp tục source/tests/review với file ownership riêng; không cần đọc credentials để làm parser.
- Không đưa mật khẩu/token/cookie hoặc giá trị `.env` vào chat, log, `.brain`, fixture, manifest hoặc source. `.brain` chỉ lưu quyền sử dụng và đường dẫn tham chiếu.
- Tiếp tục vòng code → review độc lập → lead kiểm → thử nguồn nhỏ → giao sửa theo evidence. Tối đa hai worker triển khai; heartbeat hiện hành tiếp tục, không tạo automation/worker trùng.
- Quyền sử dụng tài khoản của user không thay trạng thái permission của nền tảng hay biến fixture thành benchmark. Phạm vi diagnostic ADR-010 vẫn áp dụng. Nếu gặp xác minh bắt buộc con người, dừng đúng run, giữ phiên và ghi việc cần xử lý; không dùng credentials để vượt challenge.
- Bản báo cáo khi người dùng quay lại phải phân biệt: code/fixture đã đạt, kết quả thật đã thu và được xác minh, phần còn vướng. Không hứa đạt1.000bài khi chưa có evidence.

Task/owner/gate tiếp tục lấy từ `master_plan.md`; quyết định này không là bảng trạng thái thứ hai.
