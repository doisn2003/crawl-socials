# Đợt giao việc sau nghiệm thu — 2026-10-27

Theo yêu cầu người dùng, Agent điều phối chịu trách nhiệm nghiệm thu, giao việc và tích hợp. [Master plan](../master_plan.md) là nguồn trạng thái duy nhất; file này lưu phạm vi giao việc, không có bảng status cạnh tranh.

## Ủy quyền điều phối liên tục

Người dùng đã yêu cầu tiếp tục theo dõi hai agent, nghiệm thu và chủ động giao task tiếp theo theo master plan, không chờ nhắc. Đã tạo heartbeat **Điều phối CSD**, automation ID `i-u-ph-i-csd`, trong chính chat lead; chu kỳ 10 phút. Đây là lịch gọi lại điều phối, không phải bằng chứng task hoàn thành.

Agent thứ hai có canonical name `/root/csd_adapter`; dùng collaboration để kiểm trạng thái/giao tiếp. Agent chính dùng chat ID bên dưới và `wait_threads` với cursor. Nếu trạng thái agent chưa rõ, xác minh trước khi giao người khác làm lại. Giữ tối đa hai agent triển khai; không tạo agent hoặc run trùng chỉ vì một lượt theo dõi chưa có kết quả.

Khi một task bàn giao: đọc code và evidence, chạy kiểm tra phù hợp, trả findings cụ thể nếu có; chỉ cập nhật DONE sau nghiệm thu. Sau đó chọn task đủ dependency trong master plan, ghi file ownership mới trước dispatch. P01.03/P03.01/P05.01 chỉ được nhận khi các phụ thuộc tương ứng thực sự đã đạt. P00.04 và đường thử nguồn sớm tiếp tục được ưu tiên; không dùng các vòng offline để giả nhận khả năng crawl thật.

Chỉ báo người dùng khi có nghiệm thu, phân công mới, lỗi ảnh hưởng tiến độ hoặc đầu vào thực sự còn thiếu. Khi chưa thay đổi, không lặp báo cáo trạng thái. Tắt lịch khi hoàn tất phạm vi hoặc theo yêu cầu dừng của người dùng.

## CSD agent — sửa R01 và triển khai P01.02

Chat: `01a17be1-8b41-7f91-86aa-e5e27904a34f`. Đọc [review](../evidence/lead-review-2026-10-27.md), ADR-001/002/008 và P01.02.

1. Sửa R01: reject historical RANGE đảo chiều; regression tests, lỗi cố định không lộ input. Không đổi campaign coffee hoặc schema version chỉ để vá logic này.
2. Browser host có profile ID ổn định, partition riêng, tạo/mở/đóng view; account binding là trạng thái chưa xác minh khi chưa có đăng nhập thật. Không xây account pool.
3. Tách app UI khỏi website, navigation/new-window/permission policy rõ, IPC hẹp có runtime validation. Không expose executeJavaScript/fetch/cookie tùy ý qua UI.
4. Secrets port và implementation theo OS/runtime thực đang pin; không xuất cookie JSON hoặc mượn profile HotMatch. Không dùng bảo vệ secrets làm tuyên bố toàn bộ browser profile đã được mã hóa bởi CSD.
5. Fixture/harness kiểm hai profile không trộn cookie/storage, restart giữ dữ liệu theo thiết kế, đóng view/quit giải phóng tài nguyên và từ chối URL/payload không hợp lệ. Dùng dữ liệu giả và fixture cục bộ; không cần tài khoản thật cho nghiệm thu này.
6. Tạo affordance mở phiên theo thiết kế để người dùng đăng nhập ở bước phù hợp; không tự đăng nhập/crawl hoặc mở gate từ fixture. Tiếp tục tôn trọng gate nguồn, nhưng thiếu Meta app không cản xây browser host offline.

**Phạm vi ghi:** `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/desktop-api.d.ts`, `src/infrastructure/browser/`, `src/infrastructure/secrets/`, các file session/profile/secrets mới trong domain/application, validator/config cho R01, tests bootstrap/boundaries/session, smoke scripts, README và evidence/handoff riêng của P01.02. Có thể đổi package/script khi cần thật và phải ghi rõ. Không sửa file adapter của Agent thứ hai.

## CSD adapter agent — triển khai P02.01

Đây là nhánh độc lập với browser host. Đọc master plan mục 7.3 và P02.01, contract 1.0.0 và nghiên cứu mới (đã đính chính xác nhận posts).

1. Định nghĩa capability/adapter contracts, access-context references, candidate/batch/continuation và error/reason codes cần cho P02.01. Bám contract, chưa xây DB/parser live/scheduler sản phẩm.
2. Tách khai báo capability, mức kiểm chứng và quyền truy cập. Unsupported filter/source/scope phải trả lỗi rõ; không ngầm bỏ filter.
3. Fake adapter không import Electron, mô phỏng nhiều trang, trùng ID, rate limit, auth required, cursor sai và schema drift. Capture mode fixture do host/adapter trusted context xác định, không lấy từ raw payload.
4. Không để cursor của profile/account/query/version khác được dùng lại âm thầm. Không dùng hết budget/lỗi/parser fail làm exhausted giả. Dừng có lifecycle/idempotency hợp lý.
5. Tests xác minh những hành vi này và consumer dùng interface mà không biết Electron.

**Phạm vi ghi:** `src/domain/adapter-contracts.ts`, `src/application/ports/social-adapter.ts`, `src/application/adapter-capabilities.ts`, `src/infrastructure/adapters/`, `tests/adapter-contracts.test.ts`, `tests/fixtures/adapters/`, `.brain/specs/adapter_contract.md`, evidence/handoff riêng P02.01. Có thể tạo file cùng phạm vi khi cần; không sửa main/preload/renderer, CampaignSpec/schema, package/lock hoặc các file CSD agent đang sở hữu. Domain/application không import Electron.

## Quy tắc phối hợp

- Chỉ Agent điều phối sửa `master_plan.md`, `.brain/README.md` và kết luận gate trong đợt này. Agent triển khai báo file thay đổi, kiểm chứng, giới hạn và bước còn lại; chưa tự nhận DONE ở bảng chung.
- Giữ nguyên phần việc của Agent khác. Nếu cần sửa contract/file chung ngoài phạm vi, báo điều phối trước thay vì tự ghi đè.
- Build/test có output dùng chung: CSD agent sở hữu `dist/` và `.test-build/` trong đợt này. Adapter agent chạy kiểm noEmit hoặc compile vào `.test-build-adapter/`, chạy test riêng từ đó; điều phối chạy kiểm tích hợp sau khi cả hai bàn giao.
- Không thêm Crawlee/Apify hoặc thay kiến trúc toàn cục trong hai task này; chúng là nghiên cứu chưa được lựa chọn triển khai.
- Không suy lại người dùng chọn sai chế độ Facebook: **posts đã được xác nhận**, nguyên nhân 8 kết quả chưa xác minh.
- Task còn lại: P00.04 vẫn là đường chuẩn bị source probe sớm. Hoàn thành hai task này không tự PASS G00/G01/G02; không xây UI/scale sâu để tránh thử nguồn.
