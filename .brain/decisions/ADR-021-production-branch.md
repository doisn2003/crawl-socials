# ADR-021 — Chọn nhánh sản phẩm và chuyển CSD sang dùng thật

- Ngày: **2026-10-29 (Asia/Bangkok)**.
- Trạng thái: **ACCEPTED — quyết định trực tiếp của người dùng**.
- Nhánh được chọn: **`codex/csd-production`**.
- Nền: trạng thái `main` đang có bộ thu Facebook và Threads, gồm cả thay đổi chưa commit của lượt trước. Không reset hoặc bỏ các thay đổi đó khi tạo nhánh.

## Quyết định của người dùng

Người dùng xác nhận bộ thu hiện đã lấy được bài thô theo từ khóa từ Facebook và Thread; yêu cầu tiếp tục bằng kết quả nhánh mới, bỏ các chế độ/data nháp, mẫu, kiểm tra, khởi động thử và phép thử khỏi sản phẩm. Giao diện dark/hacker với icon công nghệ và font code; cấu hình từ khóa và mục tiêu tự lưu khi blur; đăng nhập trước khi chọn mạng; giữ phiên lâu dài; xuất Excel theo ảnh gồm hai sheet. Các mạng tương lai chỉ hiển thị badge mờ.

Người dùng đã trả lời rõ: **mỗi mạng đạt riêng mục tiêu đã nhập**. Không chia tổng mục tiêu cho hai mạng, không coi 1.000 bài gộp là hoàn thành khi mỗi mạng yêu cầu 1.000.

## Hiệu lực đối với AI Agents

1. Tất cả phát triển CSD từ đây tiếp tục trên `codex/csd-production` hoặc nhánh con có chủ đích xuất phát từ nó. Không quay về nhánh thử nghiệm, main cũ hoặc dựng lại PoC chỉ vì tài liệu lịch sử còn mô tả gate cũ.
2. ADR này thay các chỉ dẫn mâu thuẫn về UI chỉ offline, driver chưa có, chưa mở giao diện sản phẩm, fixed workload cà phê, phép thử ít thao tác và dispatch cũ trong master plan/handoff. Yêu cầu mới không tự biến benchmark lịch sử thành PASS; kết quả thô và chất lượng nội dung vẫn là hai việc khác nhau.
3. Nguồn trạng thái hiện hành là phần **Hiện hành 2.0** của `.brain/master_plan.md`. Nội dung 1.x được giữ làm bằng chứng lịch sử.
4. Không tự khởi động lại các worker/automation/dispatch cũ. Không ghi dataset, tài khoản, mật khẩu, cookie hoặc profile vào repository hay `.brain`.
5. Không có thử nghiệm trong luồng người dùng hoặc gói phát hành. Kiểm tra tự động và fixture riêng cho developer vẫn được giữ để tránh làm hỏng bộ thu và phiên; chúng không được nạp vào production.

## Hành vi được triển khai

- Cấu hình thật ghi nguyên tử dưới appData, keywords ban đầu trống; validation 1–100 từ khóa khi chạy, 200 ký tự/từ khóa, target 1–3.000 do giới hạn hiện tại của bộ thu Facebook.
- Hai mạng dùng profile, cookie, cửa sổ riêng; tự khôi phục session hiện có, không cần cờ cho phép login. Chỉ account có cookie phiên hợp lệ theo thời hạn cục bộ và không có barrier đã biết mới được chọn; bộ thu kiểm lại barrier từ nguồn.
- Phiên được giữ lâu dài qua Chromium + backup session cookie mã hóa sẵn có. Không hứa gia hạn server-side hoặc đăng nhập vĩnh viễn nếu nền tảng thu hồi.
- Một lượt UI có thư mục riêng, snapshot cấu hình và mục tiêu riêng từng mạng. **Từ 0.2.2, theo yêu cầu sửa của người dùng, Facebook/Threads mở hai cửa sổ và chạy song song**, thay cách chạy lần lượt ban đầu. Nguồn xong/lỗi không chặn nguồn kia; Stop báo dừng cả hai và đợi cả hai dọn xong trước khi kết thúc lượt. Không tự resume khi khởi động; lượt bị gián đoạn vẫn xuất được dữ liệu bền vững.
- JSON kết hợp hai mạng; Excel có `Facebook Posts` và `Thread Posts`, đúng trật tự cột đầu của ảnh tham chiếu Facebook, style xanh, filter, freeze A2, ID text, null trống. Threads giữ likes/replies/reposts/quotes/shares đúng nghĩa, không giả thành love_count.
- Source/budget kết thúc trước target được báo chưa đạt. Không sinh số liệu, không tự coi nội dung là đã đánh giá liên quan.

## Runtime và dependency

Bản sản phẩm dùng Electron 44.10.0 (bản vá cùng major cho advisory chứng thư TLS), ExcelJS 4.4.0 và scoped override uuid 11.1.1. Không giữ bản runtime dễ tổn thương chỉ vì lịch sử từng pin 44.7.0. Đã chạy lại kiểm tra native UI/phiên/export sau cập nhật; npm audit sạch.

## Xác minh và giới hạn

Xem [báo cáo triển khai](../evidence/production-upgrade-2026-10-29.md) cho kết quả build/tests/UI. Việc chọn nhánh đã được người dùng quyết định; không hỏi lại AI Agent sau về lựa chọn này. Không tuyên bố đã chạy crawl mới nếu chỉ kiểm tra tích hợp cục bộ.

Cập nhật 0.2.2: [báo cáo crawl song song](../evidence/parallel-collection-2026-10-29.md), gồm hồi quy điều phối hai nguồn, dừng/đóng ứng dụng và sửa lỗi dọn webContents sau khi đóng cửa sổ.
