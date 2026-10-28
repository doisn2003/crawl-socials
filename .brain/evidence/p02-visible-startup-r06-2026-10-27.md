# R06 — Kiểm tra visible startup CSD

Ngày 2026-10-27, Asia/Bangkok. Theo lead dispatch: cửa sổ CSD root PID23964/native528090 được báo trắng sau normal launch `electron.exe . --allow-manual-facebook-login`. Lead cho phép đóng/relaunch đúng process này và children; không login, đọc cookies hoặc xóa userData. **Kết quả: không tái hiện được lỗi renderer trắng; visible UI được xác minh, nguyên nhân của lần báo trắng gốc vẫn UNKNOWN. Không claim đã sửa root cause.**

## Bằng chứng trước khi sửa source

1. CIM xác minh PID23964 là `C:\OwnProject\crawl-socials\node_modules\electron\dist\electron.exe`, command line đúng `.` và manual-login switch. `sky.list_windows()` trả đúng một CSD window528090. Sau activate, lần snapshot đầu đã có form, campaign, probe IDLE/unavailable và toàn accessibility document. [Ảnh cửa sổ gốc](p02-visible-r06-original-window-2026-10-27.png). Không có profile/source view. Không sửa code hoặc chạy build trước quan sát này.
2. Đóng cửa sổ đó qua Alt+F4; CIM không còn root23964. Launch lại đúng lệnh bằng Start-Process với working directory workspace, visible window. Root19672/window2428576 hiển thị campaign/form ngay khi chọn và activate. [Ảnh direct normal launch](p02-visible-r06-fresh-normal-2026-10-27.png). Nút Kiểm tra offline được click qua UI và trả thành công: [ảnh](p02-visible-r06-offline-click-2026-10-27.png). Không tạo profile hoặc mở login.

Đây là actual native-window screenshots và accessibility, không dùng hidden smoke hoặc `capturePage` để thay bằng chứng visible UI. Hai quan sát này đủ bác bỏ việc coi trạng thái trắng là lỗi code tái hiện ổn định; chưa xác định nguyên nhân lần lead đã thấy.

## Diagnostics bổ sung và kiểm runtime

Thêm một nhánh CLI diagnostics opt-in trong main, module `visible-startup-diagnostics.ts`, script `visible-startup-check.mjs`, package command `check:visible` và hướng dẫn README. Không thay default visibility/GPU/backgroundThrottling, renderer/preload, source route, IPC hoặc network policy. Không dùng `--csd-smoke`, fixture origin hoặc temp userData. Đây là bổ sung khả năng chẩn đoán, không là behavioral fix cho một root cause chưa có bằng chứng.

```powershell
# Đóng CSD cũ trước; command giữ cửa sổ mới mở cho native inspection.
npm run check:visible -- --output .brain/evidence/p02-visible-r06-runtime-2026-10-27.json --screenshot .brain/evidence/p02-visible-r06-electron-paint-2026-10-27.png
```

Script dùng Electron workspace, normal userData và manual-login switch. Module chỉ nhận report directory là direct real child của OS temp có prefix `csd-visible-`; ghi JSON và PNG cố định, không arbitrary URL/JS/IPC API từ UI. Poll DOM-ready có timeout, lấy enum/count/boolean trạng thái cho phép; không profile IDs/labels/cookies/credentials. Script xác minh report PID là child mới để tránh nhận kết quả từ instance cũ, copy report/paint ra evidence rồi chỉ dọn directory diagnostics temp. CSD window vẫn mở.

[Runtime report](p02-visible-r06-runtime-2026-10-27.json) từ root1552/window2559652: visible=true, minimized=false, loading=false, DOM readyState=complete, heading/form present, main và renderer đều manualLoginEnabled=true. Profile count=0; browserOpenViews=0, UI debugger unattached, probe IDLE, available=false/liveAvailable=false, actions=0, captures=0; rendererErrors=[] và Node không exposed. Electron44.7.0, embedded Node24.21.0. [Electron paint](p02-visible-r06-electron-paint-2026-10-27.png) có 392391/862224 pixel khác background theo threshold; đây là diagnostic `capturePage`, không tự là native witness.

Đã đối chiếu native cửa sổ mới độc lập: [phần trên](p02-visible-r06-native-top-2026-10-27.png), [form và probe](p02-visible-r06-native-form-2026-10-27.png), [witness JSON](p02-visible-r06-native-witness-2026-10-27.json). MainWindowHandle từ process metadata khớp native2559652; app path là Electron CSD. Không có login, profile creation hoặc source capture. Root1552/window2559652 được để mở, ở vùng form/probe, cho lead/human tiếp tục setup khi được giao.

## Capture mismatch quan sát được

Sau khi hidden bootstrap regression chạy và CSD không ở foreground, một `get_window_state` với đúng CSD handle trả accessibility CSD nhưng pixel frame không phải nội dung CSD. Không lưu ảnh không khớp đó vào evidence. Làm mới `list_windows`, xác minh cùng root1552/handle2559652, chọn lại và activate CSD thì native screenshot khớp DOM/form/probe. Không có thao tác nào lên ứng dụng khác.

Đây là bằng chứng thực về bất nhất capture/occlusion/windowing trong phiên làm việc. Nó **không chứng minh** cùng cơ chế đã gây ảnh trắng gốc. Root cause cho lần trắng gốc giữ UNKNOWN; cũng chưa tái hiện được renderer white. Khi tái phát, cần giữ process/window identity, lấy DOM/ready/load errors và paint nội bộ rồi reselect/foreground native snapshot; không tự kết luận trắng từ một screenshot. Không thêm disable-GPU hay đổi paint policy khi chưa có bằng chứng.

## Kiểm và phạm vi

- `npm run check`: PASS main/preload/renderer/tests, 44 contract.
- `npm test`: PASS toàn suite hiện tại 89 unit +44 contract; không thêm unit cho nhánh diagnostics có thể đảo ngược này.
- `npm run check:visible ...`: PASS normal userData/visible/manual-login=true; root1552, actual native UI đã xem.
- [Bootstrap regression](p02-visible-r06-bootstrap-regression-2026-10-27.json): PASS 2 hidden launches, sandbox/bridge/network/shutdown giữ đúng.

Không chạy lại session/probe/observer toàn bộ vì R06 không sửa logic của chúng; lead vừa nghiệm thu các kiểm đó ở baseline. Không sửa metadata nguồn, gate, intent, master/.brain README hoặc userData. Build source/main/launch tooling đã ổn định; [hashes](p02-visible-r06-files-2026-10-27.json) và [handoff](../handoffs/csd-visible-startup-r06-2026-10-27.md). Lead quyết định nghiệm thu visible-readiness; agent không tự đổi status/gate.
