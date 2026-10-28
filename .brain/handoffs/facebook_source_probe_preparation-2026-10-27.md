# Bàn giao P02.02 — phần chuẩn bị offline

Ngày 2026-10-27. Từ subagent `/root/csd_adapter` trong chat lead tới `/root`. Gói chuẩn bị đã đủ để lead quyết định phần tích hợp/session/điều kiện route tiếp theo; chưa chạy live hoặc tự đóng P02.02.

## File bàn giao

- [Runbook](../specs/facebook_source_probe_runbook.md): lệnh có thật từ repo, setup session, Start/Stop dự kiến, query Posts, evidence/output/cutoff, file/interface nối P01.03.
- [Route assessment](../evidence/facebook-browser-route-assessment-2026-10-27.md): nguồn chính thức, hạn chế và disposition cụ thể. Robots notice đọc được; toàn văn terms hiện không đọc được. Không biến lead decision hoặc user session authorization thành Meta permission.
- [Script chuẩn bị](../../scripts/prepare-facebook-probe.mjs), [preflight cụ thể](../evidence/facebook_source_probe_preflight-2026-10-27.json), [validation](../evidence/facebook_source_probe_validation-2026-10-27.md), [file hashes](../evidence/facebook_source_probe_files-2026-10-27.json).

## Review tái hiện

```powershell
node --check scripts/prepare-facebook-probe.mjs
node scripts/prepare-facebook-probe.mjs --output .brain/evidence/facebook_source_probe_preflight-2026-10-27.json
```

Script giữ DRAFT, run_id/Start/deadline/freeze hash null, 0 LIVE observation. Hash 7 input tài liệu ổn định. Output tồn tại và giống thì không đổi; khác thì yêu cầu tên evidence mới. Không đọc credential/profile, không mở Electron/nguồn, không pin source đang thay đổi.

## Giao tiếp công việc tiếp theo

ADR-009 đã được áp dụng thành `LEAD_DECIDED`, không hỏi lại caps/data. Run binding đợi host thực thi đúng limits như ADR yêu cầu. Còn 4 đầu việc thật: (1) controller vào host sau P01.03, (2) disposition automated route trên căn cứ thực, (3) session setup evidence của người vận hành, (4) pin artifact/config/version và freeze run thật ở Start.

Chi tiết tích hợp đáng chú ý: observer hiện `maxRunMs <= 60000`; không truyền 30 phút trực tiếp, không reset budget giữa capture windows. BODY bytes chưa được sanitize nội dung; writer không dump nguyên response mặc định. Chưa có live Start/Stop command; không dùng `observer-debug.mjs` fixture/replay làm crawler thứ hai.

Không sửa `src/`, package/lock/tsconfig, browser/observer/build, master plan/README hoặc evidence cũ. Không thêm dependency, không mua dịch vụ, không mở task khác. Đề nghị lead review gói và giao bước tiếp cụ thể; không tiếp tục dựng framework offline chỉ để chờ nguồn.
