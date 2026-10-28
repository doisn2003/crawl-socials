# Manual Facebook login — dependency fix sẵn sàng

2026-10-27. Đã sửa policy chặn các dependency quan sát thật: [v2](../evidence/lead-p02-login-domain-v2-2026-10-27.json) có ba Instagram HTTPS xhr bị cancel; [v1](../evidence/lead-p02-login-live-metadata-2026-10-27.json) có fbsbx subFrame NAVIGATION_BLOCKED. **Lead đã xác nhận form login tải lại sau fix; full 2FA/session chưa được xác minh.** Agent không restart/move/thao tác phiên thật, đọc secret hoặc thực hiện xác minh; crawler/body observer OFF.

Kết quả live do lead cung cấp: graceful restart giữ profile vào root8380 lúc11:49:38Z, mở Login đúng profile. Lần lead đọc58 events có Instagram XHR REQUEST_ALLOWED → RESOURCE_COMPLETED200, chưa có deny/error; lead thấy nút **Log in** qua accessibility, không còn marker two_step tại lúc đó. [File evidence sau fix](../evidence/lead-p02-login-after-fix-2026-10-27.json) khi agent chốt đã cập nhật **151 events**, có thêm seq107 REQUEST_BLOCKED script từ `https://www.google.com` và seq108 ERR_BLOCKED_BY_CLIENT. Không coi nhận xét no-deny của snapshot58 là đúng cho snapshot151; chưa xác định script Google đó cần cho bước nào. Điều này xác nhận hết kẹt ở bước tải form, **không** chứng minh mọi dependency đã thông hoặc human hoàn tất login/2FA/session persistence. Lead giữ runtime/build và theo dõi human; agent dừng, không thêm policy, build/test hoặc thao tác auth.

`navigation-policy.ts` cho thêm khi manualLogin=true, không fixtureOrigin, request thuộc WebContents hiện tại của BrowserHost và top-level URL là HTTPS Facebook: Instagram family **chỉ xhr**; fbsbx family **subFrame/script/stylesheet/image/font/xhr/media**. Fbsbx subframe navigation/redirect được xét ở cả onBeforeRequest, will-frame-navigate và will-redirect. `ownedRequestContext` kiểm native id/isDestroyed/current URL; host bỏ context khi closing/stopping/stale. Không renderer approval/context API. Main navigation vẫn Facebook; Instagram/fbsbx mainFrame, popup, HTTP, credentials/port, lookalikes, ngoài Facebook, wrong/closed owner và manual=false vẫn deny. Không mở Internet wildcard, đổi sandbox/UA/permission hoặc bypass 2FA.

Kiểm: targeted13 PASS; check+44 contract PASS; whole unit102 PASS. [Native integration fixture](../evidence/p02-manual-auth-dependency-fixture-2026-10-27.json) PASS3 nhóm: owned Facebook → Instagram xhr và fbsbx iframe **qua302 redirect +script+xhr** complete; fbsbx main navigation vẫn deny; Instagram xhr từ about:blank bị chặn trước handler. Tất cả HTTPS được protocol handler nội bộ trả fixture, **0 external network**, không session thật; debugger unattached/0posts/đóng sạch0 windows+webContents. Build PASS, manifest109 inputs. Không lặp suites hoặc thêm diagnostics framework.

Source: policy/host/native context wiring; main isolated smoke branch, `auth-dependency-smoke.ts`, script và package command; 3 unit mới, README. Không đổi metadata/gate/intent/SQLite. [Source/build hashes](../evidence/p02-manual-auth-dependency-fix-files-2026-10-27.json).

**Lead đã review và restart giữ profile**; runtime/build hiện thuộc lead, không tự restart tiếp khi human đang dùng. Lệnh khởi động đã dùng từ workspace:

```powershell
.\node_modules\.bin\electron.cmd . --allow-manual-facebook-login --csd-browser-policy-diagnostics
```

Profile **CSD Facebook** đã mở; human tiếp tục login/verification. Report v2 ngoài repo: `%APPDATA%\csd-desktop\logs\browser-policy-diagnostics-v2.json`. HTTP/network/source errors còn lại phải phân biệt với cancel của app; chưa claim hoàn tất login. dist/.test-build/build chính thuộc lead; agent dừng tại handoff.
