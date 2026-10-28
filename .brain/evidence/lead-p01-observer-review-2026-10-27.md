# Lead nghiệm thu P01.03 — 2026-10-27

Reviewer `/root`, sau [handoff CSD agent](../handoffs/csd-observer-p0103-2026-10-27.md). **Chấp nhận P01.03 DONE** trong phạm vi observer/fixture/replay. Không nâng gate nguồn.

Đã đọc port/engine, Electron target/resolver, browser-host generation, main smoke branch, replay driver/loader, debug script và logic smoke. Ownership dùng profile/webContents/view generation; native promises còn pending vẫn chiếm capacity khi await đã hủy; DevTools có policy dừng rõ. Không thấy lỗi chặn nghiệm thu trong phạm vi đã bàn giao. Không biến response body/capture count thành số bài hợp lệ.

## Lead tự chạy

| Kiểm | Kết quả |
| --- | --- |
| `npm run check` | PASS main/renderer/tests types + 44 contract |
| `npm test` | 53/53 unit PASS + 44 contract |
| `npm run test:observer -- --output .brain/evidence/lead-p01-observer-smoke-2026-10-27.json` | PASS 9 nhóm, 10 response FIXTURE, 0 valid posts |
| `npm run test:session -- --output .brain/evidence/lead-p01-observer-session-regression-2026-10-27.json` | PASS 3 process/13 nhóm |
| `npm run test:smoke -- --output .brain/evidence/lead-p01-observer-bootstrap-regression-2026-10-27.json --screenshot .brain/evidence/lead-p01-observer-bootstrap-ui-2026-10-27.png` | PASS 2 lượt |
| `node scripts/observer-debug.mjs --mode replay --fixture tests/fixtures/observer/replay.json --output .brain/evidence/lead-p01-observer-replay-2026-10-27.json` | CAPTURED, 3 REPLAY responses, 0 valid posts |
| [Manifest agent](p01-observer-source-manifest-2026-10-27.json) | 23/23 SHA-256 khớp |

Evidence Electron kiểm JSON/empty/binary/POST/non-2xx, hai profile, reload pending, suspend/resume, body limit/network abort, detach, DevTools, close/reopen; cleanup còn 0 window/webContents. Các unit lỗi native timeout/capacity là injection, không gọi là lỗi Facebook đã quan sát.

## Giới hạn cần giữ khi tích hợp

- Observer segment tối đa 60 giây; source probe 30 phút cần outer deadline/counters không reset theo segment.
- Raw BODY là dữ liệu main memory, chưa sanitize nội dung. CLI chỉ xuất metadata/hash; downstream phải chọn dữ liệu trước persist.
- Timeout không abort được native CDP promise; manager giữ accounting tới settle, target timeout cần view mới. Buffer hints và postdecode checks không bảo đảm hard heap cap.
- Suspend là API explicit, không phải toàn bộ xử lý OS sleep. Deadline tổng thuộc controller; snapshot không là scheduler/benchmark.
- Chưa có Facebook parser/session live, Start/Stop probe hoặc build portable mới. Không có G00/G01/G02 PASS.

Chat CSD agent nhận tích hợp controller nhỏ P02.02 theo [dispatch tiếp](../handoffs/p02-probe-controller-dispatch-2026-10-27.md). Không xây UI/scale ngoài phép thử nguồn.
