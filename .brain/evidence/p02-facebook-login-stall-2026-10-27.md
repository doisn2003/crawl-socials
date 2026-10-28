# Facebook sau login chỉ hiện logo Meta — 2026-10-27

Asia/Bangkok. Theo lead dispatch, ưu tiên chẩn đoán phiên thủ công, không source probe. **Đã quan sát nhánh xác minh và hiện tượng render kẹt; chưa xác định nguyên nhân policy, network hay Facebook. Diagnostics mới đã kiểm offline, chờ lead review và restart có kiểm soát để lấy metadata thật. Không claim đã sửa login.**

## Hiện trạng thật được giữ nguyên

Root PID1552 được xác minh là Electron trong workspace CSD. Source window native9441042, title `CSD — Phiên CSD Facebook`. Lead phân loại URL **trong memory**: origin `https://www.facebook.com`, nhóm pathname `two_step_verification`; không chuyển full URL/query/token sang agent/evidence. Agent chỉ activate đúng window và chụp frame được lead xác nhận không có credential UI: [Meta-only native frame](p02-facebook-login-stall-native-2026-10-27.png). Thấy logo Meta, vùng trắng và scrollbar; không thấy form, nút login hoặc thông báo giải thích lỗi trong frame này. Không suy từ ảnh rằng account blocked, xác minh đã fail hoặc checkpoint bị từ chối.

Không click/F5/điều hướng/đóng/restart source window; không thao tác login, two-step verification hoặc CAPTCHA. Không đọc/export/log cookie/token/password, không mở DevTools/CDP, không thu response body hoặc bài. Root1552/source9441042 vẫn tồn tại ở lần kiểm process cuối. User có thể đang ở phiên xác minh thật; thay đổi code/build trên disk chưa cài instrumentation vào process đang chạy.

## Đọc code và giới hạn suy luận

`navigation-policy.ts` hiện cho main/subframe navigation HTTPS tới `facebook.com` hoặc subdomain; resource thêm `fbcdn.net` hoặc subdomain. Predicate không phụ thuộc pathname nên `two_step_verification` được allow; `https://static.xx.fbcdn.net/rsrc.php/...` cũng được allow cho resource. Không có bằng chứng chính nhánh pathname bị policy chặn. [Review độc lập của subagent](adapter-p02-login-policy-review-2026-10-27.md) cùng nêu các giả thuyết cần metadata.

Các điểm có thể gây thiếu dependency nhưng **chưa được quan sát trên phiên thật**: `facebook.net`/`fbsbx.com`/origin khác ngoài allowlist; subframe resource được allow nhưng navigation policy hẹp hơn; popup luôn deny; data/blob/about:srcdoc/wss bị resource predicate từ chối. Không mở origin/scheme/wildcard từ các khả năng này. Không đổi UA/fingerprint/GPU/permission policy hoặc bypass xác minh.

`BrowserHost.navigate()` cho initial `openLogin`/`openFixture` 15 giây rồi `wc.stop()` nếu load chưa hoàn tất. Đó là timeout của helper, không là timer cho mọi F5 hoặc điều hướng sau này. Có thể góp phần nếu xuất hiện đúng thời điểm, nhưng chưa có trace thật; F5 vẫn kẹt không tự chứng minh timeout hoặc loại hết các giả thuyết khác. Chưa có bằng chứng DNS/TLS, server status, resource deny hoặc JS/schema failure của phiên thật.

Process hiện tại chỉ giữ tổng `blockedRequests/blockedNavigations/deniedPopups` trong closure, không có read-only export đang mở. Diagnostics R06 trước đó chỉ kiểm UI CSD và không thu network nguồn. Không bật remote debugger hoặc đọc heap để lấy dữ liệu cũ. Vì vậy không thể dựng lại origin/status của request đã qua; cần một process mới có instrumentation trước thao tác thủ công tiếp theo.

## Diagnostics đã xây, chưa bật trên phiên thật

Opt-in CLI `--csd-browser-policy-diagnostics`. Dùng hook `webRequest`/navigation của host hiện có, **không** CDP Network/body observer, crawler, parser hoặc host thứ hai. Không đổi allow/deny predicate. Navigation listeners đọc `event.url` hiện hành thay deprecated positional URL argument; fixture kiểm runtime path allow/deny giữ đúng.

Sanitizer nhận URL native trong memory rồi lập tức chuyển thành nhóm scheme, domain family và path category. Chỉ các origin literal công khai trong danh sách code mới được giữ nguyên, ví dụ `https://www.facebook.com`, `https://connect.facebook.net`, `https://static.xx.fbcdn.net`; các host động/không thuộc danh sách, mọi port khác, credentials-in-URL, blob/data payload đều redacted. Danh sách này chỉ để **nhãn diagnostics**, không là allowlist truy cập hoặc bằng chứng dependency thật. Path giữ enum TWO_STEP_VERIFICATION/LOGIN/CHECKPOINT/RECOVERY/ROOT/OTHER_REDACTED, không path thật, account ID, query/fragment hoặc URL hash. Resource type/status/lỗi chỉ giữ enum/range kiểm trước lưu. Không lưu console text, DOM, screenshot auth, body, headers, postdata, cookies, tokens hoặc profile labels/IDs. `view` là sequence view nội bộ của host, không account identity.

Journal: 128 event mới nhất +32 event deny/error ưu tiên để success không che hết lỗi; tổng counts và số event bị loại được báo riêng. Counts là **event counters**, không unique HTTP requests/actions và có thể có hai navigation hooks cho cùng attempt. Snapshot detached, errors từ file sink không thoát ra request callback. File một bản tối đa 128 KiB, atomic temp/rename trong logs CSD; từ chối link/hardlink output. Expiry Start diagnostics +7 ngày, cleanup MANUAL_REQUIRED_NO_SCHEDULER. Ring buffer không là trace đầy đủ; có drop cần ghi UNKNOWN cho phần lịch sử thiếu.

## Đọc semantics đúng

| Kind | Bằng chứng cung cấp | Không được suy ra |
| --- | --- | --- |
| REQUEST_BLOCKED | CSD trả cancel=true tại onBeforeRequest, trước request đó | Không tự chứng minh resource cần cho render |
| REQUEST_ALLOWED | Predicate CSD cho request đi qua | Không chứng minh request thành công hoặc UI dùng được |
| RESOURCE_COMPLETED +statusCode | Native completed với HTTP status cụ thể, kể cả 4xx/5xx | Không là login success/account-block verdict hoặc body evidence |
| RESOURCE_FAILED +networkError | Native network/browser failure; chỉ mã lỗi literal đã chọn | ERR_BLOCKED_BY_CLIENT một mình không đủ gán CSD policy nếu thiếu REQUEST_BLOCKED tương ứng |
| NAVIGATION_BLOCKED | CSD preventDefault tại will-navigate/redirect/frame-navigate | Không chứng minh server đã nhận request hay nguyên nhân account |
| NAVIGATION_STARTED/COMMITTED | Nhóm route đã bắt đầu/commit; mainFrame/subFrame tách riêng | TWO_STEP_VERIFICATION không là outcome của xác minh |
| POPUP_DENIED | Window.open bị handler CSD deny | Không tự cho phép popup hoặc giả popup cần cho auth |
| HOST_NAVIGATION_TIMEOUT | Helper initial load chạm 15s và gọi stop | Không áp cho mọi F5/manual navigation |
| LOAD_FINISHED/LOAD_FAILED | Vòng đời document và mã lỗi numeric | LOAD_FINISHED không chứng minh form đã render |
| PERMISSION_DENIED | Request handler CSD đã deny một permission request | Không liệt kê đủ check/device denies; không tự đổi security permissions |
| Không có event/count hoặc có dropped | Chưa thấy trong coverage/ring của process đó | Không đồng nghĩa không có lỗi hoặc policy vô can |

## Kiểm đủ cho bàn giao

- `npm run check`: PASS main/preload/renderer/tests +44 contract.
- Whole unit suite đã chạy: 94/94 PASS (89 baseline +5 diagnostics). Sau bổ sung hardlink assertion cho Windows, compile tests và targeted diagnostics 5/5 PASS.
- `npm run test:policy-diagnostics -- --output .brain/evidence/p02-facebook-login-policy-fixture-2026-10-27.json`: PASS [fixture report](p02-facebook-login-policy-fixture-2026-10-27.json), 4 nhóm/26 event, không drop; 0 posts, debugger/observer không attach, đóng sạch 0 window/webContents. Bao gồm blocked external script, completed503, network failure, navigation deny, popup deny và **timeout 15 giây thật**. Query/private marker fixture không xuất ra report. Fixture origin policy chặn mọi external origin; không lấy deny fixture làm bằng chứng Facebook cần origin đó.
- Unit kiểm taxonomy/redaction, unknown/private fields/error text không leak, ring+priority, immutable snapshot, publish failure, file cap/Windows hardlink protection và không mở rộng navigation/resource policy.

Không lặp session/observer/probe suites lớn của baseline vì yêu cầu chỉ diagnostics nhỏ; không tự chạy source thật. [Source/build/evidence hashes](p02-facebook-login-stall-files-2026-10-27.json). Không sửa master/.brain README, source metadata/gate/intent hoặc profile/userData thật.

## Bước tiếp cho lead sau review

1. Giữ nguyên cửa sổ hiện tại cho tới khi review xong. Lead đã nhận việc graceful restart; agent không restart. Khi sẵn sàng, dùng Exit/đóng CSD main bình thường để shutdown lưu phiên xong; không force-kill, xóa marker/profile/data hoặc đổi account.
2. Từ `C:\OwnProject\crawl-socials`, chạy **build đã bàn giao**, không cần một build song song:

```powershell
.\node_modules\.bin\electron.cmd . --allow-manual-facebook-login --csd-browser-policy-diagnostics
```

3. Giữ profile **CSD Facebook** hiện có. Người dùng/lead điều khiển setup thủ công phù hợp; agent không đăng nhập/thực hiện xác minh. File mới bắt đầu từ restart, không có lịch sử PID1552 cũ. No auto source navigation/reload/auth action được thêm.
4. Report ở **`%APPDATA%\csd-desktop\logs\browser-policy-diagnostics-v1.json`**, ngoài repo. Cập nhật mỗi giây khi flag bật. Lead đọc đúng file này; không đọc thư mục cookies/secrets/browser hoặc xuất netlog/HAR. Có thể copy **chỉ JSON metadata này** sang evidence sau kiểm nội dung. `startedAt`/file LastWriteTime giúp phân biệt mới/cũ; không có event của auth branch thì trạng thái UNOBSERVED, không gọi policy PASS.
5. Dùng deny/status/error/route category thực để xác định dependency hay network; chỉ sửa policy nếu có căn cứ cụ thể và phạm vi hẹp. Nếu trang xác minh hoạt động lại, phần xác minh vẫn do người dùng thực hiện. Observer/crawler giữ OFF, không posts/gate promotion.

[Handoff](../handoffs/csd-facebook-login-stall-2026-10-27.md). Bản build chính trả cho lead; agent dừng ở đây để review trước restart.
