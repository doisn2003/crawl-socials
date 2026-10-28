# Lead review R06 và chuẩn bị P06.01 — 2026-10-27

Reviewer `/root`. Báo cáo ghi các phần đã kiểm riêng, không thay bảng task/gate trong master plan.

## R06: nhận khả năng hiển thị hiện tại, không claim sửa nguyên nhân trắng

Đã đọc `visible-startup-diagnostics.ts`, `visible-startup-check.mjs`, main wiring, README và [handoff](../handoffs/csd-visible-startup-r06-2026-10-27.md). Diagnostics opt-in dùng normal host/userData, không bật crawler; report chỉ whitelist trạng thái, DOM, count và ảnh app. Agent xác minh direct normal launch trước thay code; phần code thêm chỉ để chẩn đoán. Không có bằng chứng xác định root cause của lần UI CSD trắng ban đầu.

Lead đối chiếu **19/19 SHA-256** của [manifest R06](p02-visible-r06-files-2026-10-27.json), chạy `npm run check`: type checks + **44 contract checks PASS**. Đọc runtime report PID 1552: manual login bật, probe/live unavailable, browser views 0 tại thời điểm agent ghi, DOM complete, rendererErrors=[] và UI debugger không attach. Agent đã chạy 89 unit + 44 contract và bootstrap 2 lượt; lead không chạy lại toàn bộ logic không đổi.

Lead tự chọn lại đúng native window CSD, activate và quan sát: campaign/form/profile/probe hiện đầy đủ, đồng nhất với accessibility. Sau đó lead tạo local profile tên `CSD Facebook` qua UI và mở nút Đăng nhập Facebook. Không đọc credentials hoặc bật observer. Chỉ có một phiên này được tạo bởi lead. Normal UI readiness được nhận; **R06 kết luận BLANK_NOT_REPRODUCED / VISIBLE_UI_VERIFIED / ORIGINAL_CAUSE_UNKNOWN**.

Computer-use đã từng trả frame của app đang che CSD khi dùng đúng handle nhưng không foreground; không dùng frame sai làm bằng chứng, không lưu vào `.brain`. Luôn đối chiếu đúng title/native identity và activate trước khi nhận xét screenshot.

## P06.01: nhận phần chuẩn bị offline

Đã đọc toàn rubric, schema và 24 ví dụ synthetic cùng rationale. Relevance tách khỏi overall validity; không tự loại địa phương ngoài Hà Nội, quảng cáo/tuyển dụng/sang nhượng rõ quan hệ với quán. Thiếu nội dung hoặc ambiguity giữ UNVERIFIED; chỉ thị trong bài không điều khiển reviewer. Ví dụ snippet không tự chứng minh identity/permalink/publicity. Không có classifier, real dataset hoặc quality score.

Lead chạy lại đoạn Node/Ajv trong [evidence](p06-rubric-preparation-2026-10-27.md), sau khi đọc code: **24 decisions, 23 negative schema cases, 29 coverage tags, 13 reason codes, 26 evidence bindings/hashes PASS**. [Manifest](p06-rubric-manifest-2026-10-27.json) **5/5 hashes khớp**. Không finding mở cho phạm vi chuẩn bị.

**Nhận phần rubric/schema/ví dụ minh họa. P06.01 chưa DONE** vì chưa có bộ mẫu thật được gán nhãn/review. Không mở P06.02 hoặc claim benchmark từ fixture.

## Sự kiện phiên thật và thay đổi ưu tiên

Lead đã hỏi người dùng tự đăng nhập trong cửa sổ phiên CSD. Người dùng trả lời đã nhập đăng nhập nhưng trang trắng có logo Meta, F5 không thay đổi; nghi bước xác minh. Đây là lời người dùng về thao tác, chưa phải bằng chứng phiên đã hoàn tất.

Lead quan sát read-only đúng source window title `CSD — Phiên CSD Facebook`: nền trắng, logo Meta, scrollbar, chưa thấy form. Accessibility cho thấy document URL có origin `https://www.facebook.com`, pathname chứa **`two_step_verification`**. Chỉ lưu marker nhánh; không lưu full URL/query/token. Điều này ủng hộ nhận định đang ở luồng xác minh, **không xác định nguyên nhân form không render**. Không thao tác xác minh/CAPTCHA, không đổi profile, không refresh hoặc xóa session.

Chat **CSD agent** nhận chẩn đoán session thật: đọc policy/runtime, xác định tài nguyên/redirect/render nào lỗi trước sửa; sở hữu source/harness/build. Subagent **`/root/csd_adapter`** review policy read-only, không chạm session/build. Không tự mở wildcard hoặc thay fingerprint/GPU khi chưa có bằng chứng. Observer/crawler vẫn tắt.

P05.01 từng được lead nêu là việc có thể làm trong lúc chờ login nhưng **chưa dispatch hoặc bắt đầu**; sau phản hồi người dùng, tiếp tục ưu tiên P02.02. P05.01 vẫn READY, không có owner. Không yêu cầu người dùng trả lời lại câu đăng nhập hoặc Meta API.

Tiến độ chẩn đoán: bản host hiện chạy chỉ giữ tổng số blocked request/navigation/popup, chưa đủ phân biệt nguyên nhân trang Meta. CSD agent đang thêm metadata diagnostics nhỏ và fixture kiểm; sẽ bàn giao cho lead trước graceful restart để cài bản mới, giữ nguyên profile/userData, không thao tác xác minh thay user. [Subagent review policy](adapter-p02-login-policy-review-2026-10-27.md) chưa xác định bug gây trắng; đường dẫn Facebook được phép, các giới hạn frame/popup/scheme/timeout chỉ là giả thuyết cần dữ liệu thực. Subagent đã dừng sau review; không gọi cả hai worker là đang chạy.
