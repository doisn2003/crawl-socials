# P02.02 offline preparation — validation 2026-10-27

Owner: subagent `/root/csd_adapter`, trong chat lead. Phạm vi [dispatch](../handoffs/p02-source-probe-preparation-2026-10-27.md). Chưa thực hiện phần live, không cập nhật gate/task master.

## Đầu ra và kiểm tra

- [Runbook](../specs/facebook_source_probe_runbook.md): lệnh build/fixture/login đối chiếu với package/main/UI source hiện có; tách phần chưa có Start/Stop/writer và không invent command crawl.
- [Assessment](facebook-browser-route-assessment-2026-10-27.md): nguồn chính thức đọc được và không đọc được, disposition cùng lựa chọn thực thi. Không gửi account/credential cho web tool, không login hoặc probe Facebook.
- [Preparation script](../../scripts/prepare-facebook-probe.mjs) tạo [preflight JSON](facebook_source_probe_preflight-2026-10-27.json), chỉ đọc input tài liệu cố định và ghi summary DRAFT. Không import Electron, dùng network, đọc profile/secret hoặc tạo thư mục dữ liệu vận hành.

| Kiểm | Kết quả |
| --- | --- |
| `node --check scripts/prepare-facebook-probe.mjs` | PASS |
| `node scripts/prepare-facebook-probe.mjs --output .brain/evidence/facebook_source_probe_preflight-2026-10-27.json` | PASS; DRAFT_PREPARATION, 0 LIVE observations |
| Lặp đúng lệnh output lần hai | PASS; nội dung giống thì giữ file, không tạo run mới hoặc thay evidence khác |
| Đọc JSON và đối chiếu invariant trực tiếp bằng Node assert | PASS: run_id/Start/deadline/freeze hash null; execution_authorized=false; LEAD_DECIDED chưa bind runtime; cost=0; chưa có retention scheduler; chưa tạo data directory |
| SHA-256 của input trong preflight | 7/7 file tài liệu khớp; đây là exact-byte hashes của input chuẩn bị, không là code hash hoặc frozen campaign/run |

Không chạy build/fixture app trong lượt này vì ownership P01.03 và build chung thuộc CSD agent. Không thêm framework test/validator/evaluator/scheduler hoặc dependency. Các lệnh trong runbook được kiểm bằng source và các lệnh chuẩn bị trên; không tuyên bố login/Start thật đã chạy.

## Phần lead cần xử lý sau bàn giao

1. Khi P01.03 được trả ownership, giao controller mỏng nối vào host hiện có. Cần global budget/deadline, sanitizer trước persist, writer/snapshot và Stop. Observer event chưa đồng nghĩa record hợp lệ; maxRunMs hiện có giới hạn 60s, nên phải giữ run-level counters giữa capture windows.
2. Disposition automated route vẫn chưa có căn cứ permission CSD theo assessment. Notice robots đọc được không là approval; Terms toàn văn hiện redirect. Không yêu cầu Meta app mặc định và không hỏi lại việc người dùng chưa có grant.
3. Setup session CSD do người vận hành thực hiện; lưu metadata/evidence cần thiết, không xuất cookie/token. Có thể tách khảo sát UI thủ công khi lead chọn, với observer tắt; không đổi tên bước đó thành automatic capture.
4. Pin artifact/config/version của host đã nghiệm thu khi chuẩn bị Start; hiện không hash/freeze source P01.03 đang thay đổi.

ADR-009 đã chốt limits/data handling cho probe, không liệt kê chúng thành câu hỏi người dùng cần trả lời lại. O04/O06 của sản phẩm/benchmark 24h không bị đóng bởi gói này. Không có G00/G01/G02 PASS từ preparation.

[Handoff](../handoffs/facebook_source_probe_preparation-2026-10-27.md) · [File hashes](facebook_source_probe_files-2026-10-27.json).
