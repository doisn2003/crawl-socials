# Lead review diagnostics và quan sát session thật — 2026-10-27

Reviewer `/root`. Theo [handoff](../handoffs/csd-facebook-login-stall-2026-10-27.md). Đây là troubleshooting phiên do người dùng thao tác, không phải source probe/benchmark.

## Nghiệm thu instrumentation offline

Đã đọc `policy-diagnostics.ts`, `policy-diagnostics-file.ts`, hooks trong BrowserHost/main, 5 unit và fixture main/script. Opt-in metadata; không thay allowlist. Sanitizer giữ taxonomy/literal origins đã chọn, không body/header/query/path thật/credential. Sink giới hạn 128 KiB, journal 128 events + 32 priority events; drop counters có nghĩa, không coi là trace đầy đủ. Navigation listeners dùng event.url hiện hành, fixture kiểm allow/deny.

- Lead chạy `node --test .test-build/tests/policy-diagnostics.test.js`: **5/5 PASS**.
- Lead chạy `node scripts/policy-diagnostics-smoke.mjs --output .brain/evidence/lead-p02-login-policy-fixture-2026-10-27.json`: **4 nhóm PASS**, có real helper timeout 15 giây; không posts/body observer. Output kiểm đóng sạch windows/webContents.
- Manifest agent được tạo sau lần lead đọc sớm chưa có file; lần đối chiếu cuối **20/20 hashes khớp**. Không coi lần thiếu manifest là 0/0 PASS.
- Agent đã chạy 94 unit và 44 contract; lead không chạy lại toàn suite không có thay đổi mới ngoài phạm vi đã kiểm.

**Nhận instrumentation để chẩn đoán, không nhận là fix login.** Source/build đã được agent bàn giao trước khi restart.

## Graceful restart và dữ liệu thật

Lead chọn đúng CSD main window, đóng bình thường bằng Alt+F4; chờ root PID1552 và các process Electron thuộc workspace hết. Không kill hoặc xóa userdata. Khởi động lại bằng build bàn giao với `--allow-manual-facebook-login --csd-browser-policy-diagnostics`, root mới **27956**, report startedAt **2026-10-27T11:24:58.762Z**. Không dùng visible-diagnostics temp flag cũ.

Profile **CSD Facebook** vẫn có. Trong lúc lead quan sát, công cụ báo người dùng đang thao tác và từ chối các input cạnh tranh; lead đọc lại state, không retry bằng tọa độ cũ. User mở/đóng view và điều hướng Facebook; metadata ghi view3 tới `TWO_STEP_VERIFICATION`. Lead không thao tác form đăng nhập/xác minh/CAPTCHA, không đọc cookie/token/password. Crawler/body observer vẫn tắt.

Snapshot metadata sạch được copy từ file diagnostics đã kiểm sang [lead-p02-login-live-metadata-2026-10-27.json](lead-p02-login-live-metadata-2026-10-27.json). Không copy thư mục session/secrets, HAR hoặc raw request data.

| Quan sát | Kết luận giới hạn |
| --- | --- |
| 3 REQUEST_BLOCKED HTTPS xhr, seq53/63/68, view3, OTHER origin redacted | CSD thực sự cancel trước request; chưa biết public destination cụ thể |
| RESOURCE_FAILED kế tiếp, `net::ERR_BLOCKED_BY_CLIENT` | Phù hợp với deny phía client; chưa chứng minh resource bắt buộc cho form |
| seq117 lúc 11:25:59.185Z: NAVIGATION_BLOCKED, HTTPS subFrame, FACEBOOK_SANDBOX family | Có frame thuộc family fbsbx.com bị CSD chặn. Chưa có exact host/path hoặc bằng chứng cần để render |
| Facebook/fbcdn resource allow/completed200; route two-step commit | Document đã vào nhánh xác minh, không là verification success |
| Snapshot153events, 25 old drops, 0 priority drops, 0 publish failures | Trace vòng bị thiếu phần cũ; không dùng sự vắng mặt event để chứng minh không có vấn đề khác |

Ở snapshot75events trước đó chưa có NAVIGATION_BLOCKED; snapshot153 sau đó đã có. Lead đã gửi cập nhật chính xác cho CSD agent, không giữ kết luận cũ. Không quan sát timeout/crash trong priority evidence hiện có; đây không phải bảo đảm toàn lịch sử.

Kiểm accessibility read-only source window mới8654452: marker two-step vẫn có; bốn button tìm được là menu native File/Edit/View/Window, không phải form xác minh. Không kết luận form đã xuất hiện chỉ từ tổng button count.

## Bước tiếp đã giao

Chat **CSD agent** phân tích metadata và khoanh đích unknown XHR + sandbox frame. Bản diagnostics đầu redaction quá rộng để xác định public host; cần nhãn public destination hữu ích, ví dụ registrable domain hoặc exact public hostname được lọc, vẫn không fullURL/query/path/credentials. Không suy trước domain X hoặc tự allow-all. Mọi thay policy phải có bằng chứng và phạm vi hẹp; cần restart nữa thì bàn giao lead trước, không tự đóng cửa sổ người dùng đang thao tác.

Subagent `/root/csd_adapter` đã xong review policy, đang chờ; không có task triển khai mới. P02.02 vẫn IN_PROGRESS, session chưa được xác minh hoàn tất, G00 và mọi gate giữ nguyên. P05.01 chưa giao.

## V2 — xác định domain thật, ưu tiên fix login

Người dùng trực tiếp nhắc ưu tiên sửa dứt điểm màn hình trắng để đăng nhập Facebook. Lead giữ đây là ưu tiên duy nhất, không giao tính năng tiếp. Đã đọc helper `diagnostic-domain.ts` dùng `tldts@7.4.19`, sanitizer/sink v2, tests và handoff; chạy targeted **10/10 tests PASS**, đối chiếu **16/16 hashes khớp**. Helper giữ public ICANN base domain, bỏ tenant/subdomain/IP/special-use; không cấp quyền truy cập. Không lặp native fixture vì host/wiring không đổi trong v2.

Lead đóng CSD bình thường sau khi làm mới state theo user-input guard, chờ root27956 hết; restart giữ profile bằng build v2, root **20496**, report startedAt **2026-10-27T11:40:33.064Z**. Mở nút Đăng nhập Facebook đúng profile `CSD Facebook`, không tự điền thông tin hoặc xác minh. Người dùng đã tạo thêm profile khác trong app; lead không sửa/xóa hoặc dùng profile đó.

[Snapshot v2 thật](lead-p02-login-domain-v2-2026-10-27.json), 72 events ở thời điểm lưu: cả **3 XHR bị chặn có registrableDomain=instagram.com**, ngay sau là ERR_BLOCKED_BY_CLIENT. Nguồn page Facebook, HTTPS, view1. V1 trước đó đã có subframe fbsbx.com-family bị navigation deny. Không còn gọi domain XHR là chưa biết; cũng chưa claim đã sửa hoặc chứng minh render thành công.

Đã giao CSD agent sửa policy hẹp cho Instagram XHR và fbsbx frame/resources trong **manual-login owned Facebook top-level context**, giữ main navigation Facebook và deny ngoài context/lookalike/http/popup. Không wildcard Internet, không bypass xác minh, không thay UA/GPU. Phải xử lý cả resource gate và frame/redirect gate; context lấy từ BrowserHost, không từ targetURL hoặc renderer claim. Subagent nhận review read-only phạm vi context/callback/test có ý nghĩa; CSD agent giữ source/build. Lead sẽ nghiệm thu rồi kiểm lại trang thật ngay, không làm thêm vòng framework/telemetry trước fix.

## Fix Instagram/fbsbx đã được kiểm trên trang thật; còn reCAPTCHA

Lead đọc policy/host/fixture, chạy lại 3 manual-auth tests và native fixture 3 nhóm PASS; 109/109 build entries và 15/15 handoff hashes khớp ở thời điểm nghiệm thu. Subagent review không phát hiện blocker. [Fixture lead](lead-p02-auth-dependency-fixture-2026-10-27.json) chỉ chứng minh wiring offline.

Đóng app bình thường, giữ profile, nạp build sửa; root PID8380, diagnostics startedAt `2026-10-27T11:49:38.499Z`. Lần tải đầu Instagram XHR completed200, không deny trong snapshot58events, UI có nút Log in. Đây là form đã render, chưa là đăng nhập thành công.

Sau người dùng tự đăng nhập, [snapshot151events](lead-p02-login-after-fix-2026-10-27.json) ghi:

- `11:51:05.835Z`: Facebook main commit vào TWO_STEP_VERIFICATION.
- Instagram XHR completed200; fbsbx subFrame navigation/resource allowed và completed200.
- `11:51:06.737Z`, seq107: CSD chặn HTTPS script từ exact origin `https://www.google.com`, sau đó ERR_BLOCKED_BY_CLIENT. Path trước fix chỉ OTHER_REDACTED; không suy ra full path từ log này.
- 23 old drops, 0 priority drops, 0 publish failures; observer tắt, posts=0.

Người dùng sau đó trực tiếp báo trang hiện disclosure dùng **Google reCAPTCHA Enterprise** cho security check. Đây là bằng chứng provider đang dùng; không phải bằng chứng đã hoàn tất challenge. [FAQ Enterprise chính thức](https://docs.cloud.google.com/recaptcha/docs/faq) xác nhận entry script `/recaptcha/enterprise.js`, script hosts www.google.com/www.gstatic.com, frame hosts www.google.com/recaptcha.google.com và connect www.google.com, đều trong `/recaptcha/`.

Đã giao CSD agent sửa dependency reCAPTCHA theo exact host/prefix trong owned manual Facebook context, thêm nhãn RECAPTCHA không giữ query/token. Subagent review read-only; lead nghiệm thu và nạp build, không tự thao tác challenge/OTP. Ưu tiên duy nhất vẫn là login render; P02.02 chưa DONE, gate không đổi, chưa giao SQLite.

## Kết quả chốt: người dùng đã đăng nhập Facebook thành công

Lead đã đọc bản sửa reCAPTCHA và test/fixture; chạy lại **15/15 targeted tests**, **4 nhóm native fixture PASS** ([kết quả lead](lead-p02-recaptcha-fixture-2026-10-27.json)); đối chiếu **109/109 build entries, 12/12 fix hashes khớp**. [Review độc lập của subagent](adapter-p02-recaptcha-fix-review-2026-10-27.md) không thấy blocker. Chấp nhận bản sửa rendering.

Lead đóng app bình thường, nạp build vào root **10344**, diagnostics startedAt `2026-10-27T11:58:52.003Z`; giữ profile và mở lại đúng CSD Facebook. Snapshot đầu57events ghi trang LOGIN completed200, không priority error. Người dùng tự đăng nhập/xác minh rồi trực tiếp xác nhận: **“Đã đăng nhập vào Facebook”**. Đây là bằng chứng nghiệm thu kết quả đăng nhập và hết lỗi trắng ở luồng đã thử. Lead không điền mật khẩu/OTP, không giải challenge, không đọc hoặc xuất session secrets.

[Snapshot metadata sau đăng nhập](lead-p02-recaptcha-live-2026-10-27.json) có1854events, 1726 old drops, 112 priority drops. Chuỗi reCAPTCHA/navigation trước đó đã ra khỏi ring: **không tuyên bố đã quan sát Google completed200 từ snapshot này**. Snapshot còn các WSS Facebook bị deny và2 permission denies trong counters; chưa xác định tác động chức năng sau login, không tự mở rộng policy khi không có lỗi cần xử lý. Không tuyên bố toàn bộ mạng không còn deny.

Kết luận: **login render đã nghiệm thu theo xác nhận trực tiếp của người dùng sau hai bản sửa dependency**. Chưa kiểm persistence qua lần restart tiếp theo, source search/continuation/yield hoặc mục tiêu1000bài/24h. Observer/crawler vẫn OFF, posts=0, P02.02 vẫn IN_PROGRESS và mọi gate giữ nguyên. Chat CSD agent và subagent đã trả bản sửa/review; không mô tả là hai worker còn đang chạy triển khai. Không đóng phiên đang dùng hoặc bắt người dùng đăng nhập lại chỉ để lặp kiểm tra.
