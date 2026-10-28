# Lead nghiệm thu P01.02 và R01 — 2026-10-27

Reviewer: Codex /root. Workspace `C:/OwnProject/crawl-socials`. Đây là review độc lập trên source đang có sau bàn giao của CSD agent, không chỉ chép kết quả do agent báo. Trạng thái hiện hành nằm trong master plan.

## Kết luận

Chấp nhận **P01.02 DONE**, **R01 đã sửa**. Đủ dependency giao P01.03. Không nâng G00/G01/G02: chưa có phiên Facebook thật, response Facebook, parser hoặc phép đo 1.000 bài/24 giờ.

Đã đọc browser host, profile repository, navigation policy, session snapshot journal, secret store/Windows cipher, main/IPC/preload, renderer, unit và Electron smoke harness. Không phát hiện lỗi chặn nghiệm thu trong phạm vi session/profile hiện tại. Source manifest của agent có **30/30 hash khớp**, gồm source và evidence; không đổi manifest lịch sử để khớp code mới.

## Kiểm tra do lead tự chạy

| Lệnh / bằng chứng | Kết quả |
| --- | --- |
| `npm run check` | PASS main/preload/renderer/test types; 44 kiểm tra contract P00 |
| `npm test` | PASS **35/35 unit**, gồm 21 adapter và 14 bootstrap/session; 44 kiểm tra contract |
| `npm run test:session -- --output .brain/evidence/lead-p01-session-smoke-2026-10-27.json --screenshot .brain/evidence/lead-p01-session-ui-2026-10-27.png` | PASS 3 process, 13 nhóm kiểm |
| `npm run test:smoke -- --output .brain/evidence/lead-p01-bootstrap-smoke-2026-10-27.json --screenshot .brain/evidence/lead-p01-bootstrap-ui-2026-10-27.png` | PASS 2 lượt khởi động, IPC/UI, offline isolation, shutdown/relaunch |
| SHA-256 đối chiếu [manifest P01.02](p01-session-source-manifest-2026-10-27.json) | 30 file, 0 mismatch |
| Quan sát [ảnh UI do lead chạy](lead-p01-session-ui-2026-10-27.png) | Form tạo phiên, hai phiên có trạng thái riêng; login disabled theo cấu hình; hiển thị tiếng Việt rõ |

Smoke kiểm native session cookie trước host restore, session/persistent/HttpOnly cookie và localStorage của hai profile, popup/navigation/request/permission denial, website không có Node/CSD bridge, đóng và thay webContents bị hủy, encrypted vault round-trip. Hai lượt clean shutdown còn 0 window và 0 webContents. Lượt logout-crash cố ý `app.exit` trước debounce; process sau không hồi sinh cookie đã xóa. Restore lỗi ở lần set thứ hai bị quarantine trước mở view và owner sau vẫn từ chối.

R01: khoảng RANGE đảo chiều hoặc bằng nhau bị từ chối; khoảng 1ms hợp lệ. Unit regression chạy trong 35 test trên. Không đổi contract/schema để che lỗi.

## Giới hạn đã kiểm tra và giữ rõ

- P01.02 chứng minh lifecycle và cách ly bằng loopback fixture. Chưa chứng minh login Facebook, độ đầy đủ allowlist ngoài thực tế, điều kiện nguồn hay throughput. Manual-login affordance đã có, chưa thao tác tài khoản thật.
- Session-cookie snapshot riêng được Windows safeStorage mã hóa; không tuyên bố mã hóa toàn bộ profile Chromium. DPAPI không chống ứng dụng chạy cùng OS user.
- Dirty marker được ghi khi host nhận cookie event. Crash test dùng debounce 10 giây để giữ pending write, không đo xác suất ở 150ms production và không bảo đảm power loss/crash trước event.
- Partial restore giữ marker để chặn profile; chưa có UI recovery. Hiện chỉ 1 view/profile, binding UNVERIFIED; account pool/nhóm riêng tư thuộc P11.
- Chưa thử portable executable mới/Windows sạch. Không mua dịch vụ, dùng secret thật, commit/push/publish hoặc chạy Facebook live trong đợt review này.

Bằng chứng độc lập: [session JSON](lead-p01-session-smoke-2026-10-27.json), [bootstrap JSON](lead-p01-bootstrap-smoke-2026-10-27.json), [bootstrap UI](lead-p01-bootstrap-ui-2026-10-27.png). Bàn giao gốc: [CSD agent](../handoffs/csd-session-p0102-2026-10-27.md).
