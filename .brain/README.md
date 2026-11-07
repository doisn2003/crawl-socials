# Bộ nhớ làm việc của CSD

**Nền phát triển chính thức từ 07/11/2026.** Người dùng đã chốt `production-v2` tại `7527f17` và chọn `main` làm gốc cho các nâng cấp tiếp theo. Xem [kế hoạch v2](master-plans_restructor_version2.0.0.md), [báo cáo triển khai](reports/csd-production-v2-20261106.md) và [hướng dẫn phát triển](../AGENTS.md).

## Các mốc lịch sử

**Checkpoint baseline, 01/11/2026:** người dùng đã yêu cầu commit/push để chuyển chat. Runtime/tests/benchmark RC4 được giữ tại cee0e8b, tiện ích Excel tại 0689653; tài liệu hiện hành được checkpoint riêng. Check kiểu và 889/889 tests PASS. Remote origin: https://github.com/doisn2003/crawl-socials.git. Các ghi nhận chưa commit trong tài liệu nghiên cứu là trạng thái lịch sử trước checkpoint. Chưa merge main hoặc triển khai kiến trúc mới; tiếp tục đọc tài liệu bàn giao để thảo luận.

**Bổ sung yêu cầu, 01/11/2026:** [tài liệu bàn giao](../some-problems-in-this-branch.md) đã bổ sung vòng LLM hỏi–đáp làm rõ nhu cầu (4.4), thư viện cấu hình/version và vòng đời dữ liệu, gộp chống trùng/tái lọc (10), cùng điều khiển/quyền API theo gói, backup/download từ xa và phương án SQLite + Supabase/PostgreSQL + object storage (11). Đây là yêu cầu và đề xuất để bàn ở chat mới; chưa chọn cloud, triển khai hoặc tải dữ liệu lên mạng. Nội dung bàn giao cập nhật ở mục 13.

**Nghiên cứu và bàn giao thảo luận, 01/11/2026:** đọc [some-problems-in-this-branch.md](../some-problems-in-this-branch.md) để biết trạng thái Git/source thực tế, cơ chế planner/classifier và vấn đề discovery/comments. Người dùng muốn bàn ở chat mới về pool nhiều cửa sổ, kho chung chống trùng, raw cap chung, **hai nhóm Phù hợp / Không phù hợp** và kho/worker comments riêng. Code hiện còn ba nhóm; chưa merge, đổi kiến trúc hay chạy thu mới. Chưa chọn phương án Git A/B/C/D. Các mô tả ba nhóm bên dưới là kiến trúc đang có, không phủ định hướng mới này.

**Tạm dừng theo yêu cầu người dùng 31/10/2026.** Đã hoàn tất kiểm tra offline và [báo cáo tiến độ sau lượt tai nghe](reports/csd-progress-review-2026-10-31.md); chờ quyết định tiếp tục/chuyển hướng. Lượt thu đã dừng, không còn process/watch. Không tự mở chiến dịch mới, khởi động jobs cũ hoặc phát triển thêm tính năng.

**Mốc 29/10/2026.** Người dùng đã chọn `codex/csd-production` để phát triển luồng sử dụng thật cho Facebook và Threads.

Đọc theo thứ tự:

1. [ADR-021 — quyết định nhánh sản phẩm](decisions/ADR-021-production-branch.md).
2. [Master plan — phần Hiện hành 3.0](master_plan.md).
3. [ADR-022 — kiến trúc cơ hội thảo luận](decisions/ADR-022-conversation-opportunity-architecture.md) và [đặc tả/kế hoạch triển khai](specs/conversation-opportunity-v1.md).
4. [README vận hành](../README.md), [báo cáo triển khai](evidence/production-upgrade-2026-10-29.md).

Nâng cấp được chốt ngày 30/10/2026: vừa thu thập vừa lưu raw và lọc tăng dần; ba nhóm Phù hợp / Chưa phù hợp / Không phù hợp; ưu tiên cuộc thảo luận để thương hiệu tham gia, vẫn giữ dữ liệu nghiên cứu. Code đã có thu/phân tích bình luận cả Facebook và Threads, có pilot thật và kiểm thử; coverage còn giới hạn, chất lượng chưa được chứng nhận production. Xem trạng thái cụ thể tại master plan.

**Chỉ đạo mới nhất: cải tiến bộ máy dùng cho nhiều chủ đề, không nắn kết quả café để đủ số.** Café chỉ là chiến dịch kiểm thử. Không đưa ngoại lệ từng bài vào runtime, không tiếp tục tinh chỉnh/thu bổ sung chỉ để đạt 1.000 bản ghi. Ưu tiên tích hợp và kiểm chứng các cơ chế chung; không yêu cầu người dùng gán thêm nhãn.

Chế độ thu thô legacy giữ mục tiêu riêng mỗi mạng. **Mục tiêu nâng cấp được người dùng sửa ngày 30/10/2026: 1.000 bài tinh TỔNG Facebook + Threads, ưu tiên Threads:Facebook 8:2 hoặc 7:3; thử nghiệm tìm quán cafe.** Không tiếp tục yêu cầu 1.000 mỗi mạng. Cấu hình tự lưu khi blur. Chỉ tài khoản đăng nhập mới được chọn. Phiên giữ trên máy qua restart nhưng vẫn phụ thuộc thời hạn/thu hồi của nền tảng. Không hỏi lại các lựa chọn này.

Các tài liệu 1.x, `branch_plan.md`, `agent_handoff_prompt.md`, `collector-continuation-prompt.md`, handoff/dispatch và các gate thử nghiệm cũ là tài liệu lịch sử. Chỉ dẫn hiện hành về nhánh và chạy thử nằm trong [AGENTS.md](../AGENTS.md).

Bộ thu hiện tại kế thừa [Facebook collector ADR-019](decisions/ADR-019-automatic-facebook-collector.md) và [Threads ADR-020](decisions/ADR-020-threads-collector.md). Kết quả lịch sử: Facebook 1.156 link mới; Threads 1.004 post. Đây là bằng chứng thu thô, không tự chứng minh mọi bài đạt tiêu chí nội dung.

`master_plan.md` ghi các mốc triển khai trước v2. Thư mục `decisions/` lưu quyết định và `evidence/` lưu bằng chứng kiểm chứng. Dữ liệu bài thô, cookie, token, mật khẩu và profile nằm ngoài `.brain`. Kiểm thử dành cho lập trình viên nằm ngoài gói sản phẩm.

Tính năng 0.2.1: [Make it cooler](evidence/make-it-cooler-2026-10-29.md) — toggle terminal trang trí, hai tiến độ thật Facebook + Threads theo xác nhận của người dùng.

Hiện hành 0.2.2: [Crawl song song](evidence/parallel-collection-2026-10-29.md) — người dùng yêu cầu Facebook và Threads mở hai cửa sổ và thu đồng thời; cách chạy lần lượt trong báo cáo triển khai ban đầu đã được thay thế. Mỗi mạng vẫn có mục tiêu riêng; Stop dừng cả hai và chờ lưu xong.
