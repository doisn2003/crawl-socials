# Lead review readiness sau login

2026-10-27, reviewer `/root`. [Bàn giao](../handoffs/csd-post-login-readiness-2026-10-27.md), [readiness](p02-post-login-readiness-2026-10-27.md).

Đã đọc runbook/readiness và đối chiếu source: main chỉ cấp driver trong probeSmoke; driver loopback; controller action/status/capture check/manifest/summary và writer đều có FIXTURE cố định; sanitizer chỉ giữ metadata, không post fields. Báo cáo phản ánh đúng code. Lead kiểm **3/3 hashes khớp**. Đây là thay tài liệu, không có lý do chạy lại Electron/build/test hoặc ảnh hưởng phiên người dùng.

**Nhận gói chuẩn bị, chưa nghiệm thu toàn P02.02.** Không còn dùng các câu historical chưa có observer/controller/chưa login làm trạng thái hiện tại. Không coi docs/readiness là driver nguồn hoặc grant. CSD agent đã kết thúc lượt và đang idle, không mô tả là vẫn triển khai.

Lead chọn bước khảo sát Posts do người dùng thực hiện trên phiên đang mở, observer/crawler OFF, và đã gửi một câu hỏi: tìm cafe Hà Nội → Bài viết/Posts, báo có mục Posts và bài viết hay gặp lỗi. Chưa có câu trả lời ở thời điểm ghi. Không yêu cầu cookie/token/ảnh/tên tài khoản/nội dung bài hoặc đăng nhập lại. Không hỏi lại Meta API và không gán thao tác CUA thành human-only. Các heartbeat sau không lặp câu hỏi khi chưa có tình tiết mới.

Phạm vi triển khai thử nguồn nhỏ nhất tiếp theo được lead chọn: **1query/1batch, tối đa5candidates/5phút/3controlled actions, không retry/continuation**, nằm dưới ADR-009. Đây là lựa chọn phạm vi kỹ thuật cho bước sau, không tự PASS G00 hoặc cấp quyền chạy. Code live/response filter/parser phải theo evidence nguồn, không đoán endpoint/selectors. Điều kiện automated route theo assessment vẫn chưa được giải quyết; kết quả khảo sát human sẽ không tự giải quyết điều kiện đó.

P02.02 tạm BLOCKED ở bước tiếp cận nguồn thật: chuẩn bị và login đã xong; chờ evidence Posts và disposition route trước triển khai/chạy capture. Không mở thêm vòng framework/telemetry/readiness. P03.02 độc lập tiếp tục; P05.01/UI/scale chưa giao. Giữ profile/runtime hiện tại.
