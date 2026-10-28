# CSD — Crawl Socials Data

Bộ khung desktop Windows x64 cho campaign Facebook theo chủ đề. Phiên bản `0.1.0` mặc định chạy offline: xem cấu hình, kiểm tra fixture và tạo/mở/đóng các phiên riêng. Chưa thử đăng nhập hoặc thu thập bài Facebook thật.

Campaign đã chốt: tối thiểu 1.000 bài đúng chủ đề, không trùng trong tối đa 24 giờ; được lấy bài cũ; ưu tiên Hà Nội nhưng nhận địa phương khác; có kết quả từ Page, nhóm công khai và trang cá nhân công khai, báo số lượng riêng. Cho phép mở rộng từ khóa liên quan. Mục tiêu này chưa được benchmark chứng minh.

## Chạy ứng dụng

Yêu cầu Node `24.19.0` (engine `>=24.19.0 <25`), npm `11.17.0`, Windows x64. Phiên bản Electron/TypeScript/builder được pin trong package-lock. Cài lần đầu có thể cần mạng để tải dependency và binary Electron.

```powershell
npm ci
npm start
```

`npm start` biên dịch TypeScript, copy assets cục bộ rồi mở CSD. Trong ứng dụng, chọn **Kiểm tra offline** để kiểm cấu hình giả. Kết quả fixture không được cộng vào bài hợp lệ. Đóng cửa sổ để thoát; mở lại bằng cùng lệnh. Chưa có tính năng Start live campaign.

Trong **Phiên truy cập**, tạo tên phiên rồi chọn **Mở phiên** để tạo browser view trống riêng; **Đóng phiên** giải phóng view nhưng giữ dữ liệu phiên. Mỗi profile có ID ổn định và partition `persist:csd-v1-<id>`, không phải bằng chứng về danh tính Facebook đã đăng nhập. Danh tính vẫn `UNVERIFIED`; không được dùng profile label để cấp quyền cho job.

Nút **Đăng nhập Facebook** mặc định bị tắt. Người vận hành chạy `npm start -- --allow-manual-facebook-login`, rồi tự bấm nút cho đúng profile. Affordance này chỉ mở URL login cố định để human thao tác, không tự đăng nhập hoặc thu bài. Main navigation giữ HTTPS Facebook; trong owned Facebook top-level context, manual mode cho thêm HTTPS Instagram XHR và fbsbx subframe/script/stylesheet/image/font/xhr/media để sửa các dependency auth đã quan sát bị chặn. Không nhận context/approval từ renderer; main navigation/popup Instagram/fbsbx vẫn deny. [Handoff fix](.brain/handoffs/csd-manual-auth-dependency-fix-2026-10-27.md), fixture `npm run test:auth-dependencies`.

Rendering reCAPTCHA Enterprise cho phép HTTPS **đúng** `www.google.com`, `www.gstatic.com`, `recaptcha.google.com` và prefix `/recaptcha/` trong cùng owned Facebook context (bao gồm child fbsbx). Gstatic chỉ static resources, Google frame/XHR/rendering resources; main navigation/popup/general Google vẫn deny. Diagnostics dùng category RECAPTCHA, không query/token. [Handoff rendering fix](.brain/handoffs/csd-recaptcha-rendering-fix-2026-10-27.md); challenge vẫn do human thực hiện.

## Kiểm tra

```powershell
npm run check
npm test
npm run test:smoke
npm run test:session
```

- `check`: kiểm type main/preload/renderer/tests và 44 ca contract P00.
- `test`: unit tests cho cấu hình, fixture, namespace và IPC, rồi kiểm contract. Không cần tài khoản Facebook.
- `test:smoke`: build, chạy Electron của CSD hai lần với cùng temp root riêng, gọi bridge và nút kiểm tra offline, chặn một request ngoài có chủ đích, chụp UI ẩn, kiểm đóng sạch và giữ sentinel dữ liệu giả của ứng dụng khác. Temp được xóa sau kiểm. Không mở profile HotMatch hoặc truy cập Facebook.
- `test:session`: ba process Electron dùng cùng temp root và HTTP fixture loopback. Kiểm hai profile/cookie/localStorage cách ly, restart giữ session, logout rồi abrupt exit trong lúc chưa lưu xong không phục hồi cookie cũ, và khôi phục lỗi một phần bị chặn. Không dùng tài khoản thật.

Lưu báo cáo/ảnh smoke khi cần bằng chứng:

```powershell
npm run test:smoke -- --output .brain/evidence/p01-bootstrap-smoke-2026-10-27.json --screenshot .brain/evidence/p01-bootstrap-offline.png
```

Harness chỉ ghi keyword/config giả hoặc đã xác nhận, phiên bản runtime và kết quả kiểm tra vào evidence; cookie fixture chỉ tồn tại trong temp ngoài repo và được dọn sau kiểm. UI là PoC tối thiểu; observer transport có harness riêng bên dưới, chưa có parser/live Facebook. Ghi report session bằng `npm run test:session -- --output .brain/evidence/p01-session-smoke-2026-10-27.json`.

## Observer và debug offline

```powershell
npm run debug:observer -- --mode fixture --scenario query
npm run debug:observer -- --mode replay --fixture tests/fixtures/observer/replay.json
npm run test:observer -- --output .brain/evidence/p01-observer-smoke-2026-10-27.json
```

Lệnh đầu chạy một query HTTP loopback trong Electron với profile temp riêng. Replay chỉ dùng Node và fixture JSON (file tối đa 2 MiB, tối đa 256 body/512 frame), không mở website. `test:observer` chạy các ca JSON/empty/binary/POST/HTTP error, profile isolation, reload, suspend/resume, detach/DevTools, limit/network failure và đóng/reopen view. Không có URL/response/cookie/script API mới trong bridge UI.

Transport nhận target từ browser host, kiểm profile/webContents/view generation, không attach UI hoặc chiếm debugger đang có owner khác. Capture có generation riêng cho document/lifecycle; reload, suspend, owner change hoặc stop hủy pending và bỏ queue cũ, báo drop reasons. Đóng view là terminal; reopen cần owner mới. Suspend chỉ ngừng observer, không đóng browser view. Same-document navigation không tự đổi query context; application phải tách capture khi đổi query/access context ở bước tích hợp sau.

Observer đọc body sau `responseReceived` và `loadingFinished`, hỗ trợ base64/UTF-8/empty body, giữ HTTP status và cache/service-worker origin. BODY chỉ là bytes transport, không phải bài hợp lệ; HTTP 403 vẫn có status 403, không được tính là thành công thu bài. Body không đọc được, network failure, timeout, detach và giới hạn có mã lỗi riêng; read timeout khác END. Body thô chỉ ở main memory, có thể chứa dữ liệu nhạy cảm; CLI/evidence chỉ xuất sizes/hash/mã lỗi/counts, không in URL/query, headers/cookie hoặc body. Replay payload gắn chữ LIVE cũng không đổi mode REPLAY do host gán; valid-post count luôn 0 trong các harness này.

Mặc định mỗi observer: 32 pending requests, 2 body reads, 128 KiB/body, 512 KiB queue bytes, 32 queue results (có chỗ báo terminal), 100 captures và 2 MiB tổng decoded bytes/run; command timeout 2s, request timeout 10s, run 30s. Manager tối đa 4 observer, tối đa 12 native command promises chưa settle. Deadline monotonic không reset khi resume. Khi cancel/reload/stop, unread bodies bị bỏ và thống kê; consumer phải drain queue kịp thời. CDP nhận buffer hints trước khi đọc; encoded length/string và decoded bytes được kiểm thêm. Đây không phải trần allocation tuyệt đối của Chromium/V8: native API có thể đã tạo string lớn trước khi JS kiểm.

Native CDP promise không có API abort; cancellation chỉ ngừng await/delivery của CSD. Capacity vẫn giữ cho tới khi native promise settle; command timeout detach và poison target, muốn thử lại cần đóng/reopen view. Không tự attach lại sau DevTools. Khi DevTools mở, observer chủ động dừng bằng DEVTOOLS_OPENED nếu runtime chưa tự detach; attach bị từ chối khi DevTools còn mở. Tình huống body-command fault khó tái tạo được inject trong unit tests, không gọi là lỗi Facebook đã quan sát được.

## Controller thử nguồn bằng fixture

```powershell
npm run test:probe -- --output .brain/evidence/p02-controller-smoke-2026-10-27.json --screenshot .brain/evidence/p02-controller-ui-2026-10-27.png
```

Lệnh chạy cùng main/browser host trong hai process Electron với HTTP loopback và temp userData ngoài repo. UI Start/Stop/status được kiểm thật; process đầu bị harness terminate sau khi ghi manifest, process sau không resume run cũ. Một lượt đầy đủ chạy 3 query fixture × 5 batch, 16 controlled actions (gồm navigation), giữ 15 diagnostic responses và 0 bài hợp lệ. Temp data được dọn sau test, chỉ report/ảnh đã làm sạch được copy vào evidence. Đây là công cụ kiểm offline tự động; chưa có lệnh thu Facebook.

Controller giữ Start/deadline/counters chung qua mọi observer segment; giới hạn ADR-009 là 30 phút, 20 actions gồm retry, 5 batch/query, 100 candidates nếu có extractor, 50 MiB records/evidence, 600s can thiệp, 0 VND. Một retry transient/batch; read timeout và lỗi khác source end. Driver fixture chặn keyboard/mouse và dừng khi điều hướng ngoài controller, DevTools/đóng view hoặc suspend; không quảng cáo hard cap toàn bộ HTTP. Không cho can thiệp vào trang trong run. Operator ledger có port kiểm bằng injection, chưa đo thời gian người dùng nhìn màn hình. Raw BODY không là candidate; khi chưa có parser thì candidate/source counts UNKNOWN, relevance UNVERIFIED, valid=0.

Build tạo `dist/resources/probe-build.json` chứa exact source/build/input hashes; fixture host kiểm lại tại Start. Writer lưu manifest, metadata JSONL, action ledger, evidence map, snapshot/summary và freeze digests dưới `<CSD userData>/source-probes/<run_id>`; không persist body, body hash, URL, headers, credentials, text hay unknown schema keys. Versioned snapshot giữ record hash và thời điểm hoàn tất write; write qua cutoff bị loại membership. Budget dành 1 MiB cho finalization trong trần 50 MiB. Các policy refs pin path/hash trong repo, không sao chép nội dung policy vào run. Đây là diagnostic bundle v1, chưa là bundle benchmark đủ điều kiện cho checker.

Bridge probe chỉ có config/Start(profileId)/Stop/status, không nhận URL, JS, mode, grant boolean, budgets hoặc resume ID. App thường luôn báo live unavailable; manual login không mở capture. CLI fixture chỉ dùng origin `http://127.0.0.1:<port>` với temp root đã kiểm; không bật route Facebook. Run cũ sau process interruption không được resume; lượt mới có ID/thư mục mới. Summary ghi hết hạn sau 7 ngày và cleanup thủ công; chưa có retention scheduler. Xem [validation](.brain/evidence/p02-controller-validation-2026-10-27.md) và [handoff](.brain/handoffs/csd-probe-controller-p0202-2026-10-27.md) cho giới hạn và phần nguồn thật còn thiếu.

## Source và dữ liệu

| Vị trí | Trách nhiệm |
| --- | --- |
| `src/main/` | Electron lifecycle/composition root, IPC sender/payload validation |
| `src/preload/` | Bridge `getInfo`, `runOfflineCheck`, các thao tác profile hẹp; compile CommonJS `.cjs` cho sandbox |
| `src/renderer/` | UI HTML/CSS/TS, không Node, chỉ gọi bridge |
| `src/domain/`, `src/application/` | Campaign types và use case preview/fixture, không import Electron |
| `src/infrastructure/config/` | JSON Schema validator và đường dẫn runtime độc lập |
| `src/infrastructure/browser/` | Profile metadata, session/one-view host, URL policy, snapshot invalidation/restore journal |
| `src/infrastructure/secrets/` | SecretStore dùng async safeStorage/Windows OS protection, không có API đọc secrets từ renderer |
| `tests/fixtures/` | Cấu hình giả, không có bài hoặc tài khoản thật |
| `dist/` | Output build + resources được copy; không sửa tay |

Nguồn schema/workload chuẩn ở `.brain/specs/`; build copy bản dùng khi chạy vào `dist/resources/`, ứng dụng không đọc `.brain` lúc runtime. `package.json` dùng app ID `io.csd.desktop`. Dev và portable dự kiến dùng `%APPDATA%/csd-desktop`, sessionData ở `browser/`, logs/crashDumps riêng trong cùng namespace. Bootstrap UI dùng partition in-memory `csd-ui`; không dùng session tài khoản Facebook hoặc dữ liệu HotMatch. SQLite qua `node:sqlite` đã được chọn trong ADR-001, chưa có schema/repository sản phẩm (P05).

Bridge chỉ nhận từ đúng UI main frame. Profile commands chỉ nhận object có đúng `label` hoặc `profileId`; không có URL/script/fetch/cookie tùy ý. UI sandbox/context isolation bật, Node integration/webview tắt, quyền/download/new-window/navigation ngoài bị chặn. CSP và session UI vẫn chặn network. Website view không có preload bridge; session site có policy riêng, permission/device/download mặc định deny, popup deny, navigation/redirect được kiểm.

Persistent cookies/localStorage dùng Chromium partition riêng. Fixture chứng minh session cookie và HttpOnly session cookie không còn trong Chromium ở lần mở process mới, trong khi persistent cookie vẫn còn; vì vậy CSD có backup **chỉ session cookies** tại `<userData>/secrets/*.bin`, mã hóa bằng async safeStorage trên Windows. Không mã hóa toàn bộ browser profile bằng CSD; OS protection không ngăn mọi ứng dụng chạy cùng tài khoản Windows. Không có plaintext fallback khi crypto không sẵn sàng.

Mỗi cookie-change event được host nhận sẽ ghi flag vô hiệu hóa snapshot cũ trước debounce 150ms. Nếu crash khi còn flag, restart không dùng backup cũ, có thể phải đăng nhập lại; ưu tiên không khôi phục cookie đã logout. Restore được validate toàn bộ trước khi set, có marker trước lần set đầu; nếu lỗi/crash giữa chừng thì `SESSION_RECOVERY_REQUIRED` chặn profile qua restart. Chưa có UI tự sửa marker; không tự xóa marker rồi dùng trạng thái đăng nhập một phần. Cần thao tác phục hồi/xóa dữ liệu phiên có kiểm soát ở task phù hợp. Không hứa durability trước khi native event tới host, khi OS mất điện hoặc storage lỗi. Backup không gia hạn hiệu lực server-side của cookie.

## Build Windows dự kiến

Khi cần kiểm cửa sổ thường (khác hidden smoke), đóng CSD cũ rồi chạy:

```powershell
npm run check:visible -- --output .brain/evidence/visible-startup.json --screenshot .brain/evidence/visible-startup.png
```

Lệnh này mở CSD **hiển thị thật**, dùng userData thường và bật manual login, nhưng không tạo profile, mở Facebook hay bắt đầu capture. Chỉ ghi các trạng thái DOM/config/paint cho phép; không đọc cookies. Giữ cửa sổ mở để người vận hành đối chiếu native window với ảnh Electron. Nếu instance cũ còn chạy, command sẽ timeout thay vì gắn report vào process sai. Ảnh Electron không tự chứng minh native-window paint; xem [R06](.brain/evidence/p02-visible-startup-r06-2026-10-27.md) về một ca capture không khớp khi cửa sổ bị che.

```powershell
npm run pack:dir
npm run dist:portable
```

Builder `26.15.3`, portable Windows x64, ASAR, output `release/`. Allowlist sản phẩm gồm `dist/**/*`, package metadata và production dependencies; không đóng gói `.brain`, tests, profile/secrets hoặc source HotMatch. `pack:dir` tạo thư mục ứng dụng để kiểm dev; `dist:portable` chưa là phát hành được xác nhận. Kiểm Windows sạch, signing/update/migration và gate release thuộc P10.

## Kế hoạch và quyền nguồn

Chẩn đoán policy cho phiên đăng nhập thủ công (chỉ bật sau khi đã đóng CSD cũ một cách bình thường):

```powershell
.\node_modules\.bin\electron.cmd . --allow-manual-facebook-login --csd-browser-policy-diagnostics
```

Flag ghi metadata đã lọc vào `%APPDATA%/csd-desktop/logs/browser-policy-diagnostics-v2.json`, cập nhật tối đa mỗi giây: origin thuộc danh sách literal công khai hoặc taxonomy đã redacted, ICANN registrable domain, loại request, HTTP status, mã lỗi cố định và nhóm pathname. `tldts@7.4.19` chạy offline với private suffixes tắt để bỏ tenant/subdomain; IP, special-use/unknown suffix, IDN và nhãn giống ID rõ ràng bị giữ null. Domain logger không cấp quyền; policy manual auth được xét riêng theo native ownership/top-level context. Không body/headers/query/postdata/account IDs, không CDP body observer hay crawler; không thao tác xác minh. Journal giữ 128 event cuối và 32 event lỗi/deny ưu tiên, có tổng counts/drop counters; file tối đa 128 KiB, expiry 7 ngày và cleanup thủ công. Không phải full network trace, không phục hồi domain đã bị redacted trong file v1 cũ. [Handoff v2](.brain/handoffs/csd-login-domain-diagnostics-v2-2026-10-27.md) ghi cách lấy domain request thật sau review/restart. Fixture native hiện có: `npm run test:policy-diagnostics -- --output .brain/evidence/p02-facebook-login-policy-fixture-2026-10-27.json`.

Đọc [master plan](.brain/master_plan.md), [product contract](.brain/specs/product_contract.md), [ADR-001](.brain/decisions/ADR-001-runtime-and-reuse.md) và [ma trận nguồn](.brain/specs/source_access_matrix.md). Bảng điều phối trong master plan là nguồn trạng thái duy nhất.

Browser Electron là route nghiên cứu người dùng chọn; hiện chỉ có tài khoản cá nhân thường, chưa có API grant/chấp thuận riêng cho automation hoặc bằng chứng route vận hành. Route giữ UNKNOWN; G00 chưa PASS. Offline bootstrap không xác nhận quyền hoặc khả năng thu 1.000 bài. Không lưu credentials hoặc dataset bài trong repository/`.brain`; xử lý quyền nguồn, protocol/ngân sách và lưu/xuất trước live probe.
