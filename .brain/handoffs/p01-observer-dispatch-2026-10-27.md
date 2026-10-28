# Giao P01.03 — Observer lifecycle và harness tối thiểu

Ngày 2026-10-27, Asia/Bangkok. Owner: **CSD agent**, chat `01a17be1-8b41-7f91-86aa-e5e27904a34f`, host local. Lead đã [nghiệm thu P01.02 và R01](../evidence/lead-p01-session-review-2026-10-27.md); bắt đầu P01.03 theo master plan. Không tự nhận task/gate phía sau.

## Mục tiêu và giới hạn

Xây observer transport gắn đúng webContents/profile, nhận response có giới hạn và báo lỗi rõ, giúp bước thử nguồn sau có công cụ quan sát. Có fixture/replay và lệnh debug tối thiểu chạy một query fixture; không đợi database, scheduler hoặc UI hoàn chỉnh. P02.02 probe thật vẫn không phải chờ observer đầy đủ.

Giữ implementation nhỏ. Không viết parser Facebook, không hard-code response/GraphQL schema tưởng tượng, không chạy Facebook live, không biến fixture thành LIVE. Không mở rộng account pool, Crawlee/Apify, UI lớn hoặc thu thập hàng loạt. G00 chưa đạt và agent P00.04 đang chuẩn bị protocol riêng.

## Ownership

- Được thêm observer port/types cần thiết, implementation tại `src/infrastructure/browser/`, test/unit/fixture và script smoke riêng. Được sửa tích hợp tối thiểu `src/main/index.ts`, browser host nếu lifecycle cần, package script/README thường.
- Main-only observer/debug orchestration; không đưa arbitrary URL/script/cookie/response body API vào renderer/website bridge. Ưu tiên CLI/harness riêng hơn UI mới.
- Không sửa các file adapter P02.01, campaign/schema P00, `.brain/specs/benchmark_*`, `scripts/check-benchmark-protocol.mjs`, `tests/fixtures/protocol/` hay evidence của adapter agent.
- **Chỉ lead sửa** `.brain/master_plan.md`, `.brain/README.md`, owner/status/gate. Handoff/evidence của task ghi vào file mới P01 observer, không ghi đè bằng chứng session/lead cũ.
- CSD agent được dùng `dist/`, `.test-build/` và build chính trong đợt này. Adapter agent đang làm protocol offline, không dùng build output này. Không thêm dependency nếu runtime hiện có đủ; nếu thực sự cần, ghi lý do trước.

## Các phần cần thực hiện

1. **Lifecycle và ownership:** attach/detach idempotent, gắn profile + webContents + generation; không attach nhầm website/UI; không chiếm debugger đang do owner khác giữ. Xử lý reload, navigation, destroyed/closed, debugger detach/DevTools, suspend/resume. Không để response/promise của thế hệ cũ lọt sang owner mới; cleanup listeners/timers/pending operations. Nếu runtime không có event đáng tin cho một tình huống, ghi giới hạn và dùng cơ chế timeout/cancellation phù hợp.
2. **Capture transport riêng:** nhận đúng response/request correlation, chờ thời điểm có body, decode base64 nếu có. Phân biệt empty body hợp lệ, bị lọc, network failure, body unreadable, timeout, detach và limit stop. Không đổi lỗi thành mảng rỗng thành công. Không capture request headers/cookie/token mặc định; URL/query/body bên ngoài là dữ liệu không tin cậy.
3. **Giới hạn:** thời gian, số request đang chờ, kích thước body và tổng buffer; stop/cancel hữu hạn, bounded result queue. Làm rõ giới hạn CDP trước khi nhận body và giới hạn sau decode; không tuyên bố chặn allocation tuyệt đối nếu API chưa hỗ trợ. Bỏ qua resource không thuộc filter của harness. Dùng error codes cố định, báo counts/drop reasons; không dump response thật hoặc raw exception ra log.
4. **Harness:** loopback server và replay không cần Facebook. Một query fixture có trạng thái/capture mode rõ, output được làm sạch. Lệnh phải có timeout, temp root được kiểm trước cleanup, child process ẩn, không đụng profile thật. Cần các tình huống thành công và lỗi lifecycle có thể tái hiện.
5. **Kiểm chứng:** response text/base64 phù hợp API; reload/close/detach trong lúc pending; body failure/timeout; vượt giới hạn; reattach không nhân đôi listeners; profile isolation. Dùng Electron thực cho những tính chất mock không thể chứng minh, mock/injection cho lỗi khó tái tạo. Không viết test chỉ lặp implementation.

## Bàn giao

Gửi paths/source manifest SHA-256, lệnh kiểm, kết quả và giới hạn thực tế; gọi rõ những gì chỉ mock/fixture. Chạy checks và unit phù hợp, smoke observer; session smoke nếu sửa host/lifecycle, bootstrap smoke nếu sửa bootstrap/IPC. Lead sẽ đọc code và chạy kiểm độc lập trước DONE.

Người dùng đã cho phép lead giao việc tiếp. Không hỏi lại hiện trạng tài khoản/grant hoặc xin họ trả lời câu hỏi về nguồn mà P00.04 đang xử lý. Nếu gặp trở ngại thiết kế, báo lead với phương án cụ thể và tiếp tục phần độc lập.
