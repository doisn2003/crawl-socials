# Lead review gói chuẩn bị P02.02 — 2026-10-27

Reviewer `/root`; owner gói là subagent `/root/csd_adapter`. Đã đọc runbook, assessment, script prepare, validation và handoff. **Chấp nhận gói chuẩn bị offline**, không đóng toàn task P02.02 hoặc PASS G00.

Lead chạy `node scripts/prepare-facebook-probe.mjs --output .brain/evidence/facebook_source_probe_lead_preflight-2026-10-27.json`: DRAFT_PREPARATION, execution_authorized=false, 0 LIVE; chưa gán run ID/Start/deadline/freeze. [File manifest](facebook_source_probe_files-2026-10-27.json) có **6/6 hash khớp**. Script chỉ đọc input và ghi artifact chuẩn bị, không mở Electron/network, không đọc profile hoặc tạo thư mục dữ liệu thật. [Preflight lead](facebook_source_probe_lead_preflight-2026-10-27.json) giữ 4 đầu việc còn thiếu; không đồng nhất hash tài liệu với code manifest.

Runbook đối chiếu đúng login switch, owned observer và giới hạn segment 60 giây. Một tên file interface được viết `desktop-api.ts`, trong repo thực là `desktop-api.d.ts`; dispatch tích hợp dùng tên thực. Các câu P01.03 đang làm trong gói là snapshot trước bàn giao; trạng thái mới xem master plan và [review P01.03](lead-p01-observer-review-2026-10-27.md).

Assessment ghi rõ nguồn robots/notice đọc được và Terms bị redirect; không suy account người dùng bị block và không giả quyền Meta. Lead không dùng việc đọc assessment như grant. Đang thiếu căn cứ cho automated browser route theo điều kiện đã ghi, session thật và controller/version để thử. Không hỏi lại người dùng Meta API; không tự đổi route sang vendor trả phí. Khi công cụ thử đã cụ thể, lead sẽ trình bày đúng lựa chọn/đầu vào còn thiếu; không dùng permission flag giả để chạy.

Hành động tiếp: chat CSD agent tích hợp controller trong host hiện có, live giữ tắt trong đợt triển khai; subagent nhận P03.01 độc lập, giới hạn ở chuẩn hóa intent/keywords. Không giao UI/scale/scheduler lớn để thay cho thử nguồn. G00 vẫn NOT_EVALUATED, có blockers được nêu cụ thể thay vì suy PASS từ test.
