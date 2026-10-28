# Bàn giao diagnostics login stall cho lead

2026-10-27, Asia/Bangkok. **Nhánh xác minh đã được lead quan sát; nguyên nhân Meta-only render UNKNOWN. Diagnostics offline sẵn sàng, chờ lead review rồi tự graceful restart. Không claim đã fix login.** [Phân tích/evidence](../evidence/p02-facebook-login-stall-2026-10-27.md), [fixture](../evidence/p02-facebook-login-policy-fixture-2026-10-27.json), [hash manifest](../evidence/p02-facebook-login-stall-files-2026-10-27.json).

Đã giữ nguyên root1552/source9441042 `CSD — Phiên CSD Facebook`, profile thật **CSD Facebook**. Agent chỉ xem frame Meta-only đã xác nhận không credential UI và ghi ảnh; không click/F5/đóng/restart source, không login/xác minh/CAPTCHA, không đọc/export/log cookies/tokens/passwords/headers/body/postdata. Không có debugger/body observer/crawler/posts. File code/build thay đổi trên disk không cài diagnostics vào process cũ.

Scope source: thêm `src/infrastructure/browser/policy-diagnostics.ts`, `policy-diagnostics-file.ts`; metadata hooks opt-in trong browser-host và main index; fixture main `policy-diagnostics-smoke.ts`, script `policy-diagnostics-smoke.mjs`, 5 unit trong `policy-diagnostics.test.ts`; package command và README thường. Không dependencies/lock changes, không đổi navigation/resource allowlist, timeout15s, popup/permission policy, UA/fingerprint/GPU. Không sửa master/.brain README/gate/intent. Navigation hooks chuyển sang `event.url` thay positional argument deprecated, fixture đã kiểm allow/deny runtime.

Check+44 contract PASS, whole94 unit PASS; targeted5 sau compile+Windows hardlink assertion PASS. Native loopback fixture4 nhóm/26events PASS, 0drop/0posts/0window+webContents sau close; kiểm cả timeout15s thật. Không chạy lại suites baseline lớn hoặc khởi động source thật. Build manifest hiện có 105 source/build/input hashes; owned handoff manifest pin exact bytes riêng. dist/.test-build/build chính trả cho lead tại bàn giao, không tự bắt đầu task khác hoặc gửi tin ngược chat khác.

Sau khi review, lead đóng **CSD main** bình thường để shutdown hoàn tất, không force-kill/xóa/đổi profile/userData. Từ workspace chạy:

```powershell
.\node_modules\.bin\electron.cmd . --allow-manual-facebook-login --csd-browser-policy-diagnostics
```

Giữ profile hiện có; human thao tác setup/xác minh nếu cần, agent không làm thay. Diagnostics tự ghi `%APPDATA%\csd-desktop\logs\browser-policy-diagnostics-v1.json` (ngoài repo), mỗi giây, một file ≤128KiB. Không dùng lại `--csd-visible-startup-root` cũ vì directory temp đó đã được dọn. Không cần build khác trước review trừ khi source có thay đổi mới.

Report chỉ origin literal công khai được chọn hoặc redacted family, scheme/resource type, HTTP status/range, error enums/numeric và pathname **category**; không dynamichost/fullURL/query/accountID/DOM/credentials. Journal128+priority32, counts/drop/failure counters; expiry7d và cleanup thủ công. Nên kiểm startedAt/LastWriteTime để biết file mới; process cũ chưa có lịch sử metadata.

Đọc đúng semantics: REQUEST_BLOCKED là cancel trước request; RESOURCE_FAILED là lỗi native, status completed có thể 4xx/5xx; NAVIGATION_BLOCKED là preventDefault; POPUP_DENIED là popup handler; HOST_NAVIGATION_TIMEOUT là initial helper15s; LOAD_FINISHED không chứng minh form render; TWO_STEP_VERIFICATION không chứng minh outcome xác minh. Counts là events, không unique HTTP/action. Không có trace hoặc đã drop → UNOBSERVED/UNKNOWN, không coi là policy vô can. Deny xảy ra cũng chưa chứng minh resource đó bắt buộc; chỉ thay allowlist khi có căn cứ thực.

Lead tiếp theo: review instrumentation/hash/fixture, restart có kiểm soát như đã nhận, lấy metadata phiên thật và quyết định sửa dependency/network cụ thể. G00/session/source vẫn chưa được agent đổi trạng thái.
