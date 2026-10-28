# Login stall — domain diagnostics v2

2026-10-27, Asia/Bangkok. Source/build sẵn sàng để lead review; **chưa sửa allowlist hoặc xác định domain của ba XHR cũ**. Không thao tác/move/đóng/restart root27956 hoặc cửa sổ người dùng đang dùng; không đọc cookie/token/body/headers/DOM, không observer/crawler.

[Snapshot thật v1](../evidence/lead-p02-login-live-metadata-2026-10-27.json) có153 events, 25 old drops, 0 priority drops. View3: REQUEST_BLOCKED seq53/63/68 là HTTPS xhr REDACTED_OTHER; các error liền kề54/64/69 là ERR_BLOCKED_BY_CLIENT. Seq117 là NAVIGATION_BLOCKED subFrame HTTPS FACEBOOK_SANDBOX. Facebook/fbcdn có completed200. Trong counts không có host timeout/renderer crash. **Có navdeny thật**; nhận xét no-navdeny của snapshot75 cũ không áp dụng file153. Chưa biết ba XHR là cùng domain hay các domain khác, và chưa chứng minh deny nào bắt buộc cho render.

Thay đổi hẹp: thêm `location.registrableDomain`, snapshot version2/domainPolicy `TLDTS_7.4.19_ICANN_BASE_ONLY_V1`; sink chuyển sang **`%APPDATA%\csd-desktop\logs\browser-policy-diagnostics-v2.json`** để tránh nhầm v1. WHATWG URL parse trước; helper chỉ nhận hostname. Pin runtime utility `tldts@7.4.19` (+tldts-core trong lockfile), không parser tự đoán last-two-label. ICANN suffixes bật/private suffixes tắt, bỏ tenant/subdomain như bucket/S3/GitHub Pages; IP, special-use/unknown suffix, IDN, obvious numeric/hex/ID-like labels và credential-in-URL giữ null. [Tài liệu upstream](https://github.com/remusao/tldts/blob/master/packages/tldts/README.md) mô tả ICANN/private options. Public base không chứng minh DNS registration, ownership hoặc quyền; không dùng parser làm access decision. Không in full hostname động/path/query/fragment hoặc hash chúng.

Không thêm domain giả định vào taxonomy/allowlist. `navigation-policy.ts`, host/network predicates và request behavior giữ nguyên. Giữ ring128+priority32, file128KiB, metadata-only/expiry policy; phiên cũ vẫn ghi v1 bằng code đã load, không thể unredact lịch sử từ snapshot.

Kiểm: `npm run check` +44 contract PASS; compile tests và targeted `diagnostic-domain.test` +`policy-diagnostics.test`: **10/10 PASS** (PSL multi-label/wildcard/exception; private tenants; IP/IDN/local/IDs; unknown origin chỉ giữ base; no access grant; file cap/link protection). `npm run build` PASS, manifest build107 inputs. Không lặp native fixture15s hoặc suites lớn vì host/wiring không đổi. [Owned hashes](../evidence/p02-login-domain-diagnostics-v2-files-2026-10-27.json).

Sau review, **lead** phối hợp graceful restart lúc người dùng sẵn sàng, giữ profile/userData, rồi chạy build hiện có từ workspace:

```powershell
.\node_modules\.bin\electron.cmd . --allow-manual-facebook-login --csd-browser-policy-diagnostics
```

Chỉ theo dõi thao tác thủ công của human. Đọc file **v2**, kiểm `version=2`/domainPolicy, rồi lấy `priorityEvents` có REQUEST_BLOCKED/NAVIGATION_BLOCKED của view mới: xem `location.registrableDomain`, resourceType, scheme, origin taxonomy và error/status liền kề. Null vẫn là withheld/unknown, không đoán domain. Domain v1 không phục hồi được; vì vậy cần data mới trước fix. Khi domain thật rõ, kiểm chủ thể/mục đích chính thức và chỉ mở dependency/host/resource/frame context tối thiểu có bằng chứng; không allow-all, không tự nhận diện/vượt qua xác minh. Observer/crawler vẫn OFF. Agent trả build chính và dừng chờ lead review.
