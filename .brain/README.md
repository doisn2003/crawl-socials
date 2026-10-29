# Bộ nhớ làm việc của CSD

**Hiện hành từ 29/10/2026: người dùng đã chọn `codex/csd-production` để phát triển CSD tiếp.** Đây là luồng dùng thật cho Facebook và Threads, không còn UI offline/bootstrap/probe hoặc dữ liệu mẫu trong gói phát hành.

Đọc theo thứ tự:

1. [ADR-021 — quyết định nhánh sản phẩm](decisions/ADR-021-production-branch.md).
2. [Master plan — phần Hiện hành 2.0](master_plan.md).
3. [README vận hành](../README.md), [báo cáo triển khai](evidence/production-upgrade-2026-10-29.md).

Mục tiêu do người dùng nhập được tính **riêng cho mỗi mạng**, đã được xác nhận trong chat. Cấu hình tự lưu khi blur. Chỉ tài khoản đăng nhập mới được chọn. Phiên giữ trên máy qua restart nhưng vẫn phụ thuộc thời hạn/thu hồi của nền tảng. Không hỏi lại các lựa chọn này.

Các tài liệu 1.x, `branch_plan.md`, `agent_handoff_prompt.md`, `collector-continuation-prompt.md`, handoff/dispatch và các gate thử nghiệm cũ là **lịch sử**, không là lệnh chạy hiện hành. Khi mâu thuẫn, ADR-021 và phần hiện hành của master plan được ưu tiên. Không khởi động lại automation/worker cũ. Không quay về main/nhánh thử để làm nền phát triển.

Bộ thu hiện tại kế thừa [Facebook collector ADR-019](decisions/ADR-019-automatic-facebook-collector.md) và [Threads ADR-020](decisions/ADR-020-threads-collector.md). Kết quả lịch sử: Facebook 1.156 link mới; Threads 1.004 post. Đây là bằng chứng thu thô, không tự chứng minh mọi bài đạt tiêu chí nội dung.

`master_plan.md` giữ trạng thái hiện hành duy nhất. `decisions/` giữ quyết định; `evidence/` giữ kiểm chứng; tài liệu cũ giữ nguồn gốc kỹ thuật. Không lưu dữ liệu bài thô, cookie, token, mật khẩu hoặc profile vào `.brain`. Kiểm thử developer vẫn được giữ ngoài gói sản phẩm, không phải chế độ người dùng.

Tính năng 0.2.1: [Make it cooler](evidence/make-it-cooler-2026-10-29.md) — toggle terminal trang trí, hai tiến độ thật Facebook + Threads theo xác nhận của người dùng.
