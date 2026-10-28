# Phân công sau khi login Facebook đã đạt

Lead `/root`, 2026-10-27. User đã xác nhận vào Facebook sau sửa Instagram/fbsbx/reCAPTCHA. Hai worker đã trả bản sửa/review; lượt này giao việc mới, không giả họ vẫn đang chạy. Giữ runtime PID10344/profile CSD Facebook; không restart, đóng phiên, attach observer hoặc tự thu bài trong lượt chuẩn bị này.

## Chat CSD agent — tiếp tục P02.02, chốt khoảng thiếu trước phép thử thật

Đọc master plan, ADR-008/009, review login và source controller/driver hiện hành. Timebox khoảng10phút cho một đầu ra ngắn, cụ thể; không xây thêm framework. `electron-probe-driver.ts` mới có fixture, `ProbeStatus.captureMode` chỉ FIXTURE/null, sanitizer không giữ dữ liệu bài: login thành công không làm các phần này thành driver Facebook.

1. Đối chiếu runbook với code đã được nghiệm thu và sửa các câu đã lỗi thời: observer/controller còn chưa có, session chưa login, bắt tạo profile khác. Phải phân biệt kết quả historical với tình trạng hiện tại; không biến task fixture thành live.
2. Tạo `.brain/evidence/p02-post-login-readiness-2026-10-27.md`, tối đa khoảng2trang: phần đã sẵn sàng, phần thực sự chặn live, file/function cần thay, dữ liệu quan sát còn thiếu, lát cắt triển khai nhỏ nhất tiếp theo và tiêu chí kiểm. Phân biệt điều kiện nguồn chưa giải quyết với thiếu code và thiếu bằng chứng kỹ thuật.
3. Đề xuất bước tiếp có thể thực hiện ngay theo gate hiện hành. Không trả câu hỏi Meta API/đã login, không thay route sang paid provider, không gọi việc tự động điều khiển browser là thao tác thủ công của human. Nếu phải có thao tác người dùng, mô tả đúng một thao tác cần thiết với đầu ra cụ thể; chuẩn bị mọi phần độc lập trước.

Ownership chỉ `.brain/specs/facebook_source_probe_runbook.md`, evidence/handoff mới cho lượt này. Không sửa source/build/package/assessment/source matrix đang được pin trong build, master/README/task/gate. Không web research/legal analysis lặp lại khi không có câu hỏi mới. Đây là chuẩn bị P02.02, không acceptance live. Bàn giao sớm để lead quyết định phần triển khai nhỏ nhất; không tự nối task khác.

## Subagent /root/csd_adapter — P03.02 query expansion nhỏ và xác định

Dependency P03.01 đã DONE; scope là module ứng dụng thuần, không cần nguồn mạng. Đọc intent/campaign hiện hành và P03.02. Tạo bộ mở rộng có giới hạn số query/độ sâu, bật/tắt strategy, provenance query cha/lý do/strategy version và loại trùng. Luôn giữ query gốc khi tắt expansion; không đổi contract campaign hoặc tự tăng nguồn ngoài cafe/địa phương đã chọn. Không LLM/service/dependency mới, không đổi planner P03.03, không UI/SQLite/adapter nguồn.

Ownership `src/application/query-expansion.ts` mới và helper mới nếu thật cần; `tests/query-expansion.test.ts`; evidence/handoff riêng. Đọc nhưng không sửa `campaign-intent.ts` hoặc file shared; báo lead nếu interface chưa đủ. Test phải kiểm scope drift, giới hạn thực, provenance, determinism và Unicode/alias, không chỉ mirror implementation. Compile riêng vào `.test-build-expansion`, không đụng dist/.test-build chính; không sửa package/tsconfig/master/README. Chỉ kiểm phù hợp, không lặp full suite chưa có lý do. Bàn giao hashes và lệnh tái hiện.

Lead giữ source trạng thái/gate và runtime. G00 không PASS từ login; P06.01 vẫn chờ mẫu thật. Không mua dịch vụ, commit/push/publish. Không yêu cầu hai worker cùng sửa file hoặc build output.
