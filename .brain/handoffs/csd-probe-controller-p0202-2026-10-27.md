# Bàn giao P02.02 controller fixture cho lead

Ngày 2026-10-27, Asia/Bangkok. Theo [dispatch](p02-probe-controller-dispatch-2026-10-27.md). Controller offline đã có để nghiệm thu; toàn P02.02/source gate chưa hoàn tất. Không sửa master/.brain README, adapter/protocol/campaign hoặc nhánh intent. Không gửi tin ngược chat khác.

Source mới trong `src/main/`: `probe-contract.ts`, `probe-controller.ts`, `probe-writer.ts`, `probe-freeze.ts`, `probe-ipc-policy.ts`, `electron-probe-driver.ts`, `probe-smoke.ts`; scripts `freeze-probe-build.mjs`, `probe-fixture.mjs`; unit `probe-controller.test.ts`, `probe-freeze.test.ts`. Wiring sửa main index, desktop types, preload, renderer HTML/app/CSS, package build/test script, bootstrap smoke bridge assertion, observer CLI safe error codes và README thường. Không thêm dependency hoặc đổi lockfile. Không sửa BrowserHost/observer engine.

Lệnh chạy từ workspace:

```powershell
npm run check
npm test
npm run test:probe -- --output .brain/evidence/p02-controller-smoke-2026-10-27.json --screenshot .brain/evidence/p02-controller-ui-2026-10-27.png
node --test .test-build/tests/probe-controller.test.js .test-build/tests/probe-freeze.test.js
```

`test:probe` là smoke tự động dùng UI thật, HTTP loopback, hai process CSD và temp userData ngoài repo; không mở Facebook. Root temp/observations được dọn, chỉ report/ảnh làm sạch được copy. Hiện không có lệnh live. App bình thường có panel giải thích unavailable; manual-login switch vẫn chỉ mở setup session, không capture.

Kết quả: 20 unit controller/freeze; toàn suite lúc kiểm 89 unit (có 16 intent của owner khác) +44 contract. Electron 2 process/9 nhóm, một lượt đầy đủ 16 actions/15 diagnostics/3×5batch/0 valid, Start/Stop race, coverage/DevTools/close, crash/restart và cleanup đạt. Session 3 process/13 nhóm, bootstrap 2 lượt, observer 9 nhóm/10 response đạt. [Evidence đầy đủ](../evidence/p02-controller-validation-2026-10-27.md), [command record](../evidence/p02-controller-checks-2026-10-27.json), [source manifest](../evidence/p02-controller-source-manifest-2026-10-27.json).

Ngân sách outer không reset theo observer/retry; Start/deadline pin trước action. Thư mục run mới, không resume. Writer metadata-only trước persist, có byte reserve/cutoff/frozen versions/hashes và expiry 7 ngày cleanup thủ công. Source/body/candidates tách rõ; không có parser nên candidates và ba nguồn UNKNOWN, valid=0. Protocol diagnostic bundle v1 không là benchmark-ready bundle; policy refs chỉ pin repo path/hash, không có retained text copy. Native lifecycle revocation defer cleanup ngoài callback navigation để tránh reentrant debugger detach.

Interface nội bộ: controller `{driver, freeze, writer}`; driver trusted main `{acquire(profileId,lost) → beginSegment/action/release}` hiện chỉ có LOCAL_FIXTURE. Parser seam `inspect(event) → candidateCount/continuation` chỉ test bằng injection, không nhận record text hoặc claim valid. Main-only operator union ledger; fixture chặn input và không đo attention bên ngoài. Bridge exact config/Start(profileId)/Stop/status; Stop hủy pending Start, không có approval/mode/URL/JS/resume/budget API. Một manager/resolver dùng chung qua mọi segment/run, giữ native pending accounting và poison state.

Lead tiếp theo: review code/evidence và chốt phần nghiệm thu controller; tự cập nhật master nếu đạt. Live còn cần disposition/session evidence, driver search/paging thực, parser/publicity/source/relevance/challenge/progress thực và build/config freeze mới. Không cần người dùng trả lời lại Meta API/caps. Không hứa đã quan sát nguồn từ fixture; không nối host/crawler thứ hai. dist/.test-build/build chính đã trả; agent dừng tại bàn giao này.
