# Giao CSD agent — P02.02 controller thử nguồn tối thiểu

Ngày 2026-10-27. Owner chat CSD agent `01a17be1-8b41-7f91-86aa-e5e27904a34f`, local. Lead đã [nghiệm thu P01.03](../evidence/lead-p01-observer-review-2026-10-27.md). Đọc [runbook](../specs/facebook_source_probe_runbook.md), [preflight](../evidence/facebook_source_probe_lead_preflight-2026-10-27.json), [ADR-009](../decisions/ADR-009-source-probe-operational-limits.md) và [review chuẩn bị](../evidence/lead-p02-preparation-review-2026-10-27.md).

## Phạm vi

Tạo lớp điều phối mỏng trong app hiện có để một phép thử có Start/Stop/status, counter/deadline tổng, chọn dữ liệu trước lưu và báo cáo có phiên bản. Giao diện chỉ đủ vận hành phép thử; không dựng dashboard/scheduler/SQLite hoặc host thứ hai. **Đợt này hoàn tất tích hợp và kiểm fixture; không tự chạy Facebook live hoặc đổi G00.**

Mục đích là làm công cụ thử cụ thể trước khi lead yêu cầu thao tác/session hay quyết định route còn thiếu. Không tạo thêm questionnaire hoặc bắt người dùng trả lời lại về Meta API/caps đã chốt. Không coi LOCAL fixture flags hoặc boolean 'approved' từ renderer là quyền chạy live.

## Yêu cầu thực hiện

1. Tái dùng BrowserHost và owned observer/resolver. Tách controller run khỏi transport segment ≤60s; Start tạo run ID/immutable Start/deadline trước collection action. 30 phút gồm pause/retry/suspend/restart; tối thiểu không cho resume run cũ bằng reset thời gian. Có thể từ chối resume và yêu cầu run mới trong PoC, ghi rõ giới hạn thay vì viết durable scheduler.
2. Áp ADR-009: 3 query cố định, 20 controlled actions, 5 batch/query, 100 candidates nếu extractor tạo candidate, 50 MB persisted records/evidence, 600 giây operator, 0 external cost. Kiểm trước action/write và dừng rõ khi hết cap. Không gọi BODY count là candidate count hoặc CDP command là action. Nếu chưa có extractor thật, candidate/source/relevance phải UNKNOWN/UNVERIFIED, valid count=0; báo diagnostic capture riêng.
3. Hành động trong controller phải có accounting. Chọn cơ chế hạn chế điều hướng/thao tác ngoài controller trong lúc chạy, hoặc phát hiện và dừng khi mất coverage; không quảng cáo hard action cap cho lượt người dùng tự click vô hạn. Không hard-code GraphQL/selectors Facebook từ suy đoán. Giao diện/driver nguồn chưa quan sát phải ghi NOT_IMPLEMENTED; một controller fixture-ready không tự là crawler Facebook chạy được.
4. Stop/error/auth/challenge/close/DevTools ngăn action mới và dọn observer. Phân biệt timeout/read error với source end. Outer run giữ budgets giữa các segment, không dùng nhiều segment để tăng tổng số lượt/cap.
5. Data writer vào CSD userData ngoài repo, xác minh root/path; không lưu credentials/request headers/URL chứa secret hoặc dump nguyên body mặc định. Chọn allowlisted diagnostic metadata/schema shape (có giới hạn) hoặc extractor output đã kiểm; đừng gọi việc hash body là sanitization. Payload text/unknown keys có thể mang secret; khi không chắc chỉ giữ metadata an toàn và reason. Thiết kế chỗ nhận parser sau khi có mẫu nguồn, không giả bài Facebook.
6. Manifest/evidence map/hash/record versions/cutoff/snapshot/summary tối thiểu theo protocol; phân biệt FIXTURE và LIVE ở trusted main. Freeze source/build/config sau build ổn định ở Start, không dùng hash fixture như code live. Summary có expiry 7 ngày và nêu retention cleanup còn thủ công; không thêm scheduler xóa dữ liệu.
7. IPC chỉ cho exact Start/Stop/status/config hợp lệ; không arbitrary URL/JS/cookie API. Giữ live capture mặc định unavailable khi thiếu disposition/session thực. Một flag CLI chỉ là cấu hình, không bằng chứng grant. Session setup/login hiện có vẫn tách khỏi capture.

## Ownership và kiểm thử

Bạn sở hữu `src/main/` controller mới, wiring index/browser host nếu cần, `src/shared/desktop-api.d.ts`, preload và renderer tối thiểu, scripts smoke riêng, package scripts/README thường; giữ dist/.test-build/build chính. Không sửa `.brain/master_plan.md`, `.brain/README.md`, adapter P02.01, protocol/checker, campaign/schema hoặc nhánh intent của subagent. Không dependencies mới nếu hiện có đủ.

Subagent làm P03.01 tại `src/domain/campaign-intent.ts`, `src/application/campaign-intent.ts`, test/spec riêng và output riêng; không đụng source của bạn. Controller dùng campaign đã freeze hiện có, không chờ nhánh intent mới.

Kiểm có ý nghĩa: Start trùng/Stop race; deadline qua nhiều segment/pause; action/candidate/storage caps; malformed/secret-bearing payload không persist; path/cutoff/late writes; process interruption không biến run cũ thành run mới cùng ID; UI/IPC nếu sửa; fixture flags không mở Facebook. Đủ kiểm cần thiết rồi bàn giao ngay, không mở rộng product framework. Bàn giao lệnh chạy được, manifest hashes, evidence, phần nguồn thật còn chưa có; lead review trước bước live.
