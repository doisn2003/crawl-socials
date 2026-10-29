# Make it cooler — 29/10/2026

Người dùng yêu cầu toggle ở góc dưới bên phải, mở terminal khi bắt đầu thu thập, hai thanh đếm ở trên và nhị phân xanh hacker trong vùng còn lại. Người dùng đã xác nhận **Facebook + Threads**, thay cho chữ TikTok trong yêu cầu đầu.

Đã triển khai trên `codex/csd-production`, phiên bản 0.2.1:

- Toggle mặc định tắt, lưu qua restart tại `data/cooler-preference.json`, không thay schema cấu hình thu thập.
- Khi bật, Start mở một BrowserWindow kiểu terminal. Bật giữa lượt đang chạy cũng mở được; tắt thì đóng. Đóng riêng terminal giữ toggle bật và không dừng collector.
- Hai thanh cố định Facebook/Threads lấy số đếm thật từ production service mỗi giây. Nguồn không chọn ghi rõ không chọn; nguồn chờ có trạng thái chờ. Số đếm không bị cắt khi vượt target.
- Terminal chỉ có bridge đọc tiến độ, xác thực đúng sender/main frame/file URL. Không nhận account ID, keyword, đường dẫn dataset, nội dung bài hoặc cookie.
- Canvas nhị phân 0/1 là hiệu ứng trang trí. Tối đa 8 lần vẽ/giây, giới hạn 180 cột × 100 dòng, font tự co giãn phủ vùng còn lại, DPR tối đa 1.5, không tạo DOM theo từng số. Dừng hiệu ứng khi run kết thúc, cửa sổ ẩn hoặc người dùng chọn giảm chuyển động. Không ghi file hoặc gọi mạng cho hiệu ứng.
- Khi thoát CSD, terminal được hủy cùng handler IPC trước khi flush phiên tài khoản.

Kiểm chứng: typecheck PASS; 447 unit/regression tests PASS (thêm kiểm tra snapshot tiến độ không lộ dữ liệu và không thể sửa trạng thái collector); kiểm tra native Electron xác nhận số đếm/trạng thái, thanh cố định, animation thay đổi khi chạy và đóng băng khi hoàn tất, đóng/mở lại, tắt hủy cửa sổ, validation input, toggle trong màn hình chính lưu disk và khôi phục qua restart. Ảnh QA cục bộ: `artifacts/production-qa/cooler-terminal.png`. Kiểm tra UI dùng trạng thái điều khiển trong thư mục temp riêng, không chạy thêm crawl LIVE trên tài khoản thật.
