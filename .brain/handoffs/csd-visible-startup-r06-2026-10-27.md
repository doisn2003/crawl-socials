# Bàn giao R06 visible startup

Ngày 2026-10-27, Asia/Bangkok. Hoàn tất điều tra trong phạm vi giao: **BLANK_NOT_REPRODUCED; VISIBLE_UI_VERIFIED; original root cause UNKNOWN**. Không ghi là đã fix lỗi code trắng. [Evidence](../evidence/p02-visible-startup-r06-2026-10-27.md), [runtime](../evidence/p02-visible-r06-runtime-2026-10-27.json), [native witness](../evidence/p02-visible-r06-native-witness-2026-10-27.json), [hash manifest](../evidence/p02-visible-r06-files-2026-10-27.json).

Original PID23964/window528090 hiện UI đầy đủ ngay ở lần agent kiểm đầu, trước sửa source/build. Đã xác minh identity CSD và đóng bằng Alt+F4 theo quyền giao. Direct normal relaunch PID19672/window2428576 cũng hiển thị và nút offline chạy được trước sửa code; sau đó đóng riêng CSD đó để chạy diagnostics. Không tạo profile/login/đọc cookie/xóa userData.

Thêm `src/main/visible-startup-diagnostics.ts`, `scripts/visible-startup-check.mjs`; wiring opt-in trong main index; `check:visible` package command và README thường. Không sửa GPU/show/backgroundThrottling, renderer/preload/IPC/profile/source/controller logic. Main flag diagnostics không là smoke, không đổi userData hoặc mở live. Report root chỉ ở OS temp prefix riêng; whitelist status/config/DOM/counts/paint, không secrets. Script giữ window mở và PID-bind report mới; chỉ dọn temp diagnostics sau copy.

```powershell
# Đóng instance CSD cũ rồi dùng command này để có report và visible window.
npm run check:visible -- --output .brain/evidence/p02-visible-r06-runtime-2026-10-27.json --screenshot .brain/evidence/p02-visible-r06-electron-paint-2026-10-27.png
```

Runtime cuối: main/renderer manualLoginEnabled=true, DOM complete/form present, visible=true, rendererErrors=[], profileCount=0, browserOpenViews=0, uiDebuggerAttached=false, probe IDLE/live unavailable/actions0/captures0. Native screenshots phần trên/form khớp DOM. Root **1552**, native window **2559652**, title **CSD — Crawl Socials Data** đang để mở ở vùng form/probe cho lead/human. Không tự mở Facebook hoặc thực hiện login.

Có một capture trả pixel không khớp app trong khi accessibility/handle vẫn là CSD, sau hidden regression khi CSD không foreground. Reselect+activate cùng CSD window khôi phục ảnh đúng. Không lưu frame sai/ứng dụng khác. Capture anomaly được quan sát, nhưng quan hệ nhân quả với lần trắng gốc chưa chứng minh; không dùng một screenshot trắng làm bằng chứng renderer lỗi nếu thiếu đối chiếu DOM/native identity.

Kiểm đủ: check PASS +44 contract, npm test 89 unit +44 contract PASS; normal visible diagnostics PASS và native UI được xem; bootstrap regression 2 launches PASS. Không mở rộng test/product framework hoặc đổi gate/source/intent/status. dist/.test-build/build chính trả cho lead tại bàn giao; không bắt đầu task khác, không gửi tin ngược sang chat khác. Lead ghi review/visible-readiness theo bằng chứng.
