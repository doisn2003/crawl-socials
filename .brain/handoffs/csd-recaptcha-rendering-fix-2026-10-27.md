# reCAPTCHA Enterprise rendering fix — sẵn sàng thử thực

2026-10-27. Instagram/fbsbx fix1 đã có completed200 theo lead. Sau đó seq107 script `https://www.google.com` bị app cancel; user xác nhận UI dùng **Google reCAPTCHA Enterprise**. [FAQ Enterprise chính thức](https://docs.cloud.google.com/recaptcha/docs/faq) nêu `enterprise.js`, script hosts www.google.com/www.gstatic.com, frame hosts www.google.com/recaptcha.google.com và connect www.google.com, trong namespace `/recaptcha/`. Provider đã xác nhận; path của request bị chặn cũ vẫn OTHER_REDACTED, không giả đã quan sát chính `enterprise.js`.

Đã sửa **rendering only**: exact HTTPS hosts trên +prefix `/recaptcha/`, manual mode và native owned Facebook top-level context như fix1 (kể cả tài nguyên child fbsbx). Google/recaptcha.google cho subFrame/script/xhr/style/image/font/media; gstatic chỉ script/style/image/font. Main navigation/popup, Google paths khác, lookalikes/HTTP/port/credentials, ngoài owned Facebook/manual=false vẫn deny. Không sửa sandbox/UA/CSP, gọi token API, giải/bypass/nhấn challenge. Shared predicate thêm diagnostic category RECAPTCHA, không ghi path/query/token. Không restart hoặc thao tác user window/auth.

Kiểm đã chốt: check+44 contract PASS; targeted **15/15 PASS**, có Enterprise entry script, prefix/traversal/context denies và redaction; [native fixture](../evidence/p02-recaptcha-dependency-fixture-2026-10-27.json) **4 nhóm PASS**, nested Facebook→fbsbx→Google Enterprise script/frame→gstatic script→XHR render thành công. HTTPS được protocol fixture nội bộ trả, 0 Internet/real challenge/secret, không body observer/crawler. Build109 inputs PASS. [Hashes](../evidence/p02-recaptcha-rendering-fix-files-2026-10-27.json). Không chạy suites/vòng telemetry khác.

**Lead review rồi thử thực ngay** bằng graceful restart giữ profile khi user sẵn sàng, cùng command đã có:

```powershell
.\node_modules\.bin\electron.cmd . --allow-manual-facebook-login --csd-browser-policy-diagnostics
```

Đọc report v2 ngoài repo; request provider có `/recaptcha/` sẽ mang category RECAPTCHA. Kiểm allowed/completed và UI render bằng human; nếu vẫn deny OTHER_REDACTED thì không mở Google toàn bộ, vì đó là path khác. Human tự thực hiện verification; agent không tác động challenge. Source/build đã chốt và trả lead, không đổi gate/session status hoặc thêm feature.
