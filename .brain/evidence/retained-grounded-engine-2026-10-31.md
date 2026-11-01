# Tái lọc nguồn đã lưu và planner có căn cứ — 31/10/2026

**Bản ghi lịch sử của mốc 833 tests.** Source-root picker, ranking theo kế hoạch và storage admission cho thu trực tiếp đã được triển khai sau mốc này; xem [bằng chứng tiếp nối](external-source-storage-ranking-2026-10-31.md). Các giới hạn dưới đây phản ánh thời điểm kiểm thử của bản ghi này.

Phạm vi là cải tiến bộ máy đa chủ đề. Không crawl thêm hoặc đổi nhãn bộ café để đủ số; mục tiêu vận hành vẫn 1.000 tổng, ưu tiên Threads 8:2/7:3. Hai dataset đã giao giữ nguyên SHA-256.

## Hành vi đã tích hợp

- Renderer/main/preload/service có danh sách nguồn tải theo yêu cầu và nút tái lọc bằng bản nháp đã chuẩn bị. Không đòi tài khoản hoặc mở browser. Campaign, context và model ledger đích độc lập; không nhập nhãn/chi phí cũ.
- Nguồn journal và legacy Facebook/Threads được mở chỉ đọc. Đóng băng prefix đủ dòng, hash, watermark; append sau mốc không thay input. Kiểm tra cả hai file legacy trước/sau đọc; nhập đủ phần đã chọn mới chạy inference. Không sửa torn tail của nguồn.
- Import có checkpoint/lock và deterministic event ID: crash sau append trước checkpoint không nhân đôi raw. Import hoàn tất hoạt động tiếp khi nguồn không còn; import dở kiểm tra nguồn trước Resume. Comment sửa bài gốc làm mất hiệu lực nhãn ở cả root cũ và mới.
- Cap root dùng chung; nguồn mới pin phân bổ theo campaign weights, không đếm reply chưa rõ gốc vào quota. Thiếu nguồn ở một mạng thì dùng phần dư theo thứ tự nguồn; đó là ưu tiên mềm, không bảo đảm tỷ lệ bài Phù hợp cuối cùng. Manifest cũ giữ semantics cũ.
- Legacy map giữ thời gian, root/parent, nội dung, media/provenance native; kiểm tra URL/ID Facebook và cờ reply mâu thuẫn. Không suy diễn body bình luận từ advertised count. Target observation không sao chép mọi metadata engagement của row legacy; file nguồn vẫn là bản raw đầy đủ.
- Tái lọc đánh giá tại `captured_at` cố định qua Resume. View hiện tại vẫn loại nhãn quá `valid_until` khỏi Phù hợp; bản quá hạn thành pending, không tự gọi model làm mới ở chế độ này. UI/export ghi rõ hai mốc nghĩa này.
- Planner mới dùng `grounded-constraints-v1`, recipe `campaign-planner-v1.2.1-grounded-constraints`, validator v1.1. Trích dẫn ngắn được mở rộng thành clause nguyên văn có offset; kiểm tra phủ định/ví dụ, bắt buộc/ưu tiên, ngôn ngữ bài và tuổi bài theo ngày/tuần Việt/Anh. Giá trị nguồn mặc định không mang bằng chứng giả.
- New draft và direct new pipeline pin planner policy/hash trước API. Paid attempt cũ thiếu pin dùng legacy; hash/policy không khớp chặn request mới. Draft hoàn tất và preset dùng plan đã lưu, không compile lại. **Direct Start thất bại ở planner rồi bấm Start mới vẫn tạo lượt mới; bảo đảm retry cùng ledger áp dụng luồng draft hoặc pipeline tiếp tục cùng directory.**
- Collector nhận đúng `campaign.budget.max_run_minutes` (regression 37 phút), thay mặc định 240 cho mọi plan.

## Bằng chứng

- `npm run check`: PASS. `npm test`: **833/833 PASS**, không skip, khoảng 30,4 giây phần test. Có 21 retained reader/import tests; 11 production retained tests; catalog, planner UI, duration, immutable planner pin và compiled constraint tests.
- Native Electron 1100px với renderer/preload/service thật và model transport giả: chuẩn bị kế hoạch → tải/chọn source → tái lọc khi hai tài khoản chưa đăng nhập. Kết quả 2 roots/1 comment, đúng bằng chứng comment, `STOPPED / RETAINED_INPUT_COMPLETE`, 0 pending; không có lời gọi browser/auth. Đây là kiểm tra tích hợp, không là chứng nhận nhãn ngữ nghĩa. Giao diện không bị tràn trong vùng đã kiểm tra.
- Probe đọc thật không API/không ghi nguồn: legacy piano có 600 FB + 1.021 TH; legacy HUST 23 FB + 24 TH. Cap 20 theo weights chọn 4 FB + 16 TH ở cả hai. Journal chiến dịch chính có 880 FB + 2.121 TH; cap 20 chọn 4+16, giữ các revision/capture/comment của phần đã chọn. CANDIDATE vẫn raw, không tăng root count.
- Smoke API planner ban đầu 6 yêu cầu: 4 đạt, 2 phát hiện validator loại nhầm quote ngắn/tiếng Anh. Sau sửa, replay cùng 6 phản hồi không gọi API: 6/6 đạt. Ba yêu cầu mới xe đạp/balô/sách qua API: 3/3 đạt. **9 billable calls, $0.0161083 theo token và bảng giá lưu cùng ledger**, unknown usage 0. Đây là integration smoke, không phải benchmark accuracy đa ngành.
- Log đầy đủ ở `%APPDATA%/csd-desktop/data/campaigns/engine-retained-20261031/`; planner API ở các thư mục `grounded-planner-smoke-20261031-v1` và `v2`. Harness native ngoài repo tại `%TEMP%/csd-retained-native-20261031/`.
- Dataset Excel SHA-256 `f3042e964d0161a9beb23e7be28845a8b9c1fc6dcd2cdc77c1ec74d92c91a6d6`; JSON `158eaca4c0bd79be3baf68570e6604c34b224ca4b6d71e7234aa6d74a889ac5e`, không thay đổi.

## Giới hạn và việc tiếp

1. Native path của một số run do Codex tạo nằm trong Windows Package `LocalCache/Roaming`, dù thư mục cha logical vẫn là Roaming thường; logical catalog có 12 collection, physical root có 4. Strict canonical containment từ logical root từ chối các run đó. Đọc riêng bằng trusted physical root thành công. **Chưa có picker/token nguồn riêng trong sản phẩm**; không tự thay runtime root, không allowlist package Codex hoặc bỏ kiểm tra đường dẫn. Cần thêm import với source root do main xác nhận, tách destination. [Cơ chế MSIX](https://learn.microsoft.com/en-us/windows/msix/desktop/flexible-virtualization).
2. Classifier mặc định vẫn 2.0.3. Trường languages/audience/research_intents chưa được áp dụng riêng, UI giải thích cách đặt điều kiện giữ/loại. Source priority của plan chưa điều khiển ranking cấu hình được; temporal 2.1 chưa bật mặc định. Compiler không tự chứng minh bộ lọc áp dụng đầy đủ các trường.
3. Vẫn thiếu source registry/feed discovery, byte/disk reserve và retention theo campaign, expiry từ max_age_days, kiểm chứng watch 72h/live continuation và semantic gate trên ít nhất ba ngành khác. Reference café cũ không thay holdout mới.
4. Chưa đóng gói portable mới. RC2 đã giao vẫn là artifact cũ; mã nguồn và `dist` mới hơn. Chưa nghiệm thu production hoặc tuyên bố đủ 1.000 bài được tham chiếu xác nhận.
