# Bộ nhớ làm việc của CSD

> **Collector tiếp nối đã dùng được, 28/10/2026.** Đã lưu 1.156 link mới/1.155 PUBLIC, có continuation cùng query, Stop/resume/dedup/export và audit PAGE/GROUP/PROFILE. Tích hợp main, giữ nhánh; mọi run đã dừng. Chưa PASS 1.000 bài hợp lệ/24h vì chất lượng toàn tập chưa được nghiệm thu. Xem [báo cáo mới](evidence/collector-continuation-result.md), [master plan](master_plan.md) và ADR-019. Worker/automation và dispatch cũ vẫn dừng.

`.brain` lưu kế hoạch, quyết định, bằng chứng kiểm chứng và thông tin bàn giao nội bộ của CSD — Crawl Socials Data.

Agent bắt đầu bằng [master_plan.md](C:/OwnProject/crawl-socials/.brain/master_plan.md). Đọc hiện trạng, yêu cầu, bảng điều phối, task định nhận và gate liên quan trước khi sửa source.

Trước khi làm việc về nguồn dữ liệu, đọc [ADR-008 — Hướng triển khai và kiểm chứng nguồn](C:/OwnProject/crawl-socials/.brain/decisions/ADR-008-direction-and-source-validation.md): giữ hướng Electron hiện tại, dịch vụ ngoài chưa được chọn, P00.02 phải tách khả năng kỹ thuật khỏi quyền nguồn và kết quả benchmark.

Nghiên cứu mới: [Facebook + TikTok, Apify và Crawlee — 27/10/2026](C:/OwnProject/crawl-socials/.brain/research/csd-facebook-tiktok-crawlee-2026-10-27.md). Người dùng đã thử Apify bên ngoài CSD, báo TikTok gần 500 kết quả và Facebook 8; **đã xác nhận tìm posts**, không suy dùng nhầm pages-google. Chưa audit run để biết nguyên nhân yield. Nghiên cứu là đề xuất kỹ thuật, chưa thay ADR/dependency hoặc trạng thái gate.

Đợt điều phối hiện tại: [nghiệm thu độc lập](C:/OwnProject/crawl-socials/.brain/evidence/lead-review-2026-10-27.md) và [phạm vi giao việc P01.02/P02.01](C:/OwnProject/crawl-socials/.brain/handoffs/lead-dispatch-2026-10-27.md). Chỉ Agent điều phối sửa bảng trạng thái; hai Agent triển khai sửa phạm vi file riêng.

Mốc lịch sử sửa login: **Người dùng đã xác nhận đăng nhập Facebook thành công** sau bản sửa Instagram/fbsbx và reCAPTCHA Enterprise. [Nghiệm thu và bằng chứng](C:/OwnProject/crawl-socials/.brain/evidence/lead-p02-session-diagnostics-review-2026-10-27.md): lead kiểm15tests +4nhóm fixture,109build/12fix hashes. Root10344 là runtime cũ, xem mục Hiện hành bên dưới để lấy runtime/task hiện hành. Không cần hỏi lại đã login hoặc Meta API. **1 chat triển khai +1subagent**, không phải hai chat riêng. P02.02 còn source probe/continuation/yield, gate chưa PASS; P06.01 chờ mẫu thật, SQLite chưa dispatch. Không tự đóng phiên đang dùng để lặp đăng nhập.

Lượt sau login: [user xác nhận search có bài, ảnh có menu Bài viết công khai](C:/OwnProject/crawl-socials/.brain/evidence/facebook-search-ui-observation-2026-10-27.md). Không hỏi lại kết quả/login/API. [P03.03 đã nghiệm thu](C:/OwnProject/crawl-socials/.brain/evidence/lead-p03-planner-review-2026-10-27.md):57tests/4hashes. **Mốc v1.21:** người dùng yêu cầu khắc phục đình trệ; [ADR-010](C:/OwnProject/crawl-socials/.brain/decisions/ADR-010-bounded-source-diagnostic.md) cho thử nghiệm DOM nhỏ trước G00 sau code review, giữ Meta permission UNKNOWN và benchmark chưa mở. [CSD agent triển khai, subagent review](C:/OwnProject/crawl-socials/.brain/handoffs/lead-p02-dom-diagnostic-dispatch-2026-10-27.md). Nguyên nhân kỹ thuật: production driver=null; chưa có parser/driver Facebook, không phải Facebook đã được chứng minh không thu được. Lead review rồi nạp build/quan sát schema thật; không mở thêm framework/SQLite/UI. Heartbeat không có evidence/task mới thì im lặng.

- `master_plan.md` là nguồn trạng thái task/owner/gate duy nhất. Không tạo backlog hay bảng status cạnh tranh.
- Người dùng đã cho phép dùng tài khoản trong `.env` và tiếp tục điều phối qua đêm: [ADR-011](C:/OwnProject/crawl-socials/.brain/decisions/ADR-011-account-authorization-and-overnight-work.md). Lead giữ tài khoản/runtime, worker code/tests/review; không đưa credentials vào tài liệu hoặc output.
- **Hiện hành v1.55:** [V25 review/LIVE](evidence/lead-p02-passive-aria-wrapper-review-2026-10-28.md): ARIA fix đã nghiệm thu, lead4focused/2native, reviewer5focused/1native PASS;27owned/69isolated/135frozen khớp. LIVE qua ARIA rồi bị STYLE/D2,0action. [ADR-017](decisions/ADR-017-bound-observed-post-url.md) và [dispatch](handoffs/lead-p02-observed-url-open-dispatch-2026-10-28.md) chọn mở exact observed GROUP_QUERY URL sau fixed binding/revalidation, không gắn identity vào trang trí timestamp hoặc thêm từng CSS attribute. Main triển khai; reviewer kiểm binding/validator/lifecycle. Lead giữ runtime19440/main591142/source2098306, search công khai cafe Hà Nội, **1/3starts đã dùng**. Không auto-hover/scroll. V18 REOPEN_MATCH còn giá trị, chưa throughput. Permission UNKNOWN/benchmark OFF/valid0/gates giữ nguyên;11/40MVP DONE chỉ là đếm việc.
- Chỉ một Agent điều phối cập nhật bảng điều phối trong một đợt làm việc nhiều Agent.
- `decisions/`, `specs/`, `evidence/` và `handoffs/` được tạo khi có nội dung cần lưu; chưa cần dựng các thư mục rỗng.
- Tài liệu hỗ trợ giữ quyết định, contract, bằng chứng hoặc bàn giao; không tự thay trạng thái hiện hành của task.
- Không lưu cookie, token, mật khẩu, profile trình duyệt hoặc dataset bài viết thô trong `.brain`. Chỉ lưu báo cáo đã làm sạch và tham chiếu tới dữ liệu được bảo vệ.
- Task DONE cần đầu ra và kiểm chứng; benchmark task DONE không đồng nghĩa gate PASS.

Quy tắc ID, trạng thái, nhận/trả việc, evidence và mẫu bàn giao nằm trong master plan. Khi yêu cầu hoặc kiến trúc thay đổi, cập nhật bản đồ và giữ lại lịch sử quyết định để Agent sau hiểu vì sao đường đi thay đổi.



