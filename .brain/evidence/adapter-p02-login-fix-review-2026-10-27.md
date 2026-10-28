# P02.02 — Review bản sửa dependency cho manual login

Ngày 2026-10-27; reviewer `/root/csd_adapter`, gửi lead `/root`. Review read-only snapshot source lead báo đã ghi lúc 18:45:37. Không build, sửa source/test, chạy UI, network hoặc đọc session. Chỉ tạo report này.

**Kết luận: chưa thấy blocker cụ thể trong ranh giới policy/context/callback được giao.** Bản sửa đáp ứng phạm vi cho Instagram XHR và fbsbx subframe/resources trong owned Facebook top context. Cần thử thực để biết trang xác minh đã render; kết quả unit không xác nhận login thành công.

## Đã kiểm

- `navigation-policy.ts:5–10`: `ownedRequestContext` lấy URL từ native WebContents hiện tại, đòi đúng requester ID, không destroyed. Thiếu contents/ID, ID khác hoặc `getURL()` ném lỗi đều trả undefined. Context không lấy từ target URL hay IPC của renderer.
- `navigation-policy.ts:21–31`: grant mới cần manual login bật, không fixture, top URL HTTPS thuộc Facebook, không userinfo/port lạ. Instagram chỉ `xhr`; fbsbx chỉ nhóm resource đã liệt kê, navigation chỉ `subFrame`. Hostname lookalike không qua kiểm domain suffix có dấu chấm.
- `browser-host.ts:82–88`: mỗi request lấy context từ owned view hiện tại và `details.webContentsId`; closing/stopping bỏ context. Nhánh không đủ context vẫn đi tới callback với quyết định cancel cho dependency. Helper bắt lỗi native đọc URL; không có await giữa resolve context và callback trong nhánh mới.
- `browser-host.ts:175–187`: callback navigation giữ đúng instance `wc`, kiểm nó còn là view hiện tại và không closing/stopping. Cả `will-frame-navigate` **và** `will-redirect` truyền mainFrame/subFrame; resource gate cũng cho fbsbx subFrame, tránh mở request nhưng bị frame gate chặn lại.
- Main-frame Instagram/fbsbx vẫn deny qua cả navigation/resource policy. `will-navigate` luôn dùng mainFrame. Popup vẫn deny; không mở wildcard Internet, data/blob/wss hoặc flow tự vượt xác minh.

Phạm vi grant hiện là **owned Facebook top context khi manualLoginEnabled**, không riêng pathname login/two-step. Đây là điều kiện code đang thực thi; policy không dùng title/DOM để suy đã đăng nhập. Missing `webContentsId` bị deny dependency, kể cả request background thiếu attribution; nếu còn request bị chặn sau sửa, cần xem metadata thực thay vì tự fallback thành allow.

## Verification offline

1. Chạy trực tiếp `src/infrastructure/browser/navigation-policy.ts` bằng Node 24 native TypeScript, không tạo build: **10 assertions PASS** cho Instagram XHR, fbsbx resource/subframe, mainFrame deny, requester khác/thiếu, destroyed, getURL-throw và about:blank context. Toàn bộ URL là synthetic inputs, không truy cập mạng.
2. Đọc tests mới và chạy output đã có:

```powershell
node --test .test-build/tests/manual-auth-policy.test.js
```

**3/3 tests PASS**: dependency types, HTTPS/manual/fixture/lookalike boundary và native ownership helper. Không chạy compiler hoặc ghi `.test-build`. Source BrowserHost callbacks đã đọc; các unit này không thay integration test native frame/redirect/reopen.

Nguồn vấn đề trước sửa: [diagnostics v2 của lead](lead-p02-login-domain-v2-2026-10-27.json) có 3 Instagram XHR bị chặn (sequence 49/55/59) và ERR_BLOCKED_BY_CLIENT tương ứng. fbsbx frame v1 do lead xác nhận trong dispatch. Review không suy domain mới ngoài phạm vi đã giao và không khẳng định đây là toàn bộ nguyên nhân trang trắng.

## Hash snapshot đã review

SHA-256 dưới đây phân biệt bản đã đọc với sửa tiếp theo của owner; nếu file đổi thì kết luận không tự áp cho bytes mới.

| File | SHA-256 |
| --- | --- |
| src/infrastructure/browser/navigation-policy.ts | c6bf52934f960f974b14369378c6e43ac6f8e490eb90000671df1909b3c8e186 |
| src/infrastructure/browser/browser-host.ts | 5b0d1083727ac5139c8db6a6067310abd513eceb19747c1b472d8fa3a8e62823 |
| tests/manual-auth-policy.test.ts | a3504d16a59ab85affa96e08718b2a243509eaac2dcebe629c9eacad8d66b585 |
| .test-build/src/infrastructure/browser/navigation-policy.js | ecc4256b433a699c42259f9900565d59e81fc1c0e250379c60abc6c6d2bc7fcf |
| .test-build/tests/manual-auth-policy.test.js | 5d2f24d49d876b9629afa43747ea6aa781d3e05df35dc7c2706dc1b26e105b88 |

Không yêu cầu mở rộng test matrix hoặc framework để chờ thử thực. Lead giữ nghiệm thu và thao tác phiên người dùng; reviewer dừng sau report.
