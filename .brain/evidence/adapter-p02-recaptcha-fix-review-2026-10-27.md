# P02.02 — Review read-only bản sửa reCAPTCHA

Ngày 2026-10-27; reviewer `/root/csd_adapter`, gửi lead `/root`. Phạm vi: policy, BrowserHost callbacks, tests và smoke mới; không sửa source/build/master/README, không UI/network/session. Chỉ tạo note này.

**Không thấy blocker cụ thể trong snapshot đã review.** Không kết luận login thật đã thành công hoặc màn trắng đã hết; lead cần thử phiên thật. Bản sửa chỉ cấp tài nguyên hiển thị provider, không tự làm challenge/2FA.

## Ranh giới đã kiểm

- `navigation-policy.ts:4–6, 25–38`: chỉ HTTPS exact hosts `www.google.com`, `www.gstatic.com`, `recaptcha.google.com`, path bắt đầu `/recaptcha/`, không credentials/port lạ. URL được parse trước nên các dot-segment thông thường/percent-encoded dot-segment trong tests không thoát prefix. Không mở toàn Google hoặc thêm provider khác bằng suy đoán.
- Grant vẫn cần manual login bật, không fixtureOrigin và top-level URL Facebook lấy từ owned native WebContents. Top context là trang Facebook đang chứa nested iframe, **không phải** origin iframe Google/fbsbx; vì vậy iframe provider có thể tải con của nó mà không phải mở Google thành top-level.
- `browser-host.ts:82–88, 175–187` giữ ownership/current-view checks của bản trước. Request và cả frame/redirect đều đi qua policy; missing/foreign/destroyed context không được grant mới. Callback request không có await ở nhánh resolve/policy/cancel. BrowserHost SHA-256 không đổi so với review trước.
- Google/recaptcha.google có frame + script/XHR/assets; gstatic chỉ script/style/image/font, không frame. Main navigation tới provider và popup vẫn deny. Trường hợp không còn top Facebook vẫn bị deny.

## Verification và giới hạn bằng chứng

- Reviewer chạy trực tiếp source TS bằng Node, không build: **6 assertions PASS** cho enterprise.js, Google subframe, gstatic script, Google XHR, mainFrame deny và Google path ngoài recaptcha deny.
- Reviewer chạy output unit đã có:

```powershell
node --test .test-build/tests/manual-auth-policy.test.js .test-build/tests/diagnostic-domain.test.js
```

**10/10 tests PASS**. Negative cases có context thiếu/sai, manual disabled, lookalike, protocol/credentials/port, path ngoài prefix, traversal và top navigation; diagnostics không giữ query marker.

- Đã đọc `auth-dependency-smoke.ts`, runner và [report fixture của owner](p02-recaptcha-dependency-fixture-2026-10-27.json): **4 checks PASS**, windows/webContents sau đóng đều 0. Smoke intercept HTTPS trong session synthetic, trả local Response và không fetch Internet. Chuỗi được kiểm là Facebook → fbsbx frame/redirect → Google script/frame → gstatic script → Google XHR; completion cần message quay qua fbsbx, không chỉ kiểm script request xuất hiện.
- Reviewer **không tự chạy Electron smoke** trong lượt này; kết quả smoke trên là bằng chứng owner đã ghi, không là live reCAPTCHA. Nó không xác minh mọi biến thể provider/redirect ngoài chuỗi synthetic, không giải challenge và không chứng minh nguyên nhân màn trắng đã được loại hết. Không cần mở rộng allowlist trước khi có metadata blocked thực mới.

## Hash snapshot

Các hashes dưới đây giới hạn kết luận vào bytes đã review; thay đổi tiếp theo của owner cần đối chiếu lại.

| File | SHA-256 |
| --- | --- |
| src/infrastructure/browser/navigation-policy.ts | c095e65af2dacb43307835e4f834c6e18e1a8da4c2ac663dca9352cb24cd1c25 |
| src/infrastructure/browser/browser-host.ts | 5b0d1083727ac5139c8db6a6067310abd513eceb19747c1b472d8fa3a8e62823 |
| tests/manual-auth-policy.test.ts | cc9ba6a390840c96cd7723ded1bf48d9eccad17b38c25112205925828361e35e |
| src/main/auth-dependency-smoke.ts | f1e55dc779a1c3b83251bf72634d184a86385db56572c041c847615daf18975b |
| scripts/auth-dependency-smoke.mjs | 43e3d2fc4ff154c6b8f225955906a57f10521fd89cf9db4379af6948d766936b |
| .brain/evidence/p02-recaptcha-dependency-fixture-2026-10-27.json | d83614d1ea5e0c24426beb5b43142c4ec08d6018315e69889f055f985d139d2e |

Lead giữ quyền nghiệm thu và lượt thử thật. Reviewer dừng, không mở task khác.

