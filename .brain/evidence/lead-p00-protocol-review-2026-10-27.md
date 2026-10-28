# Lead review P00.04 — 2026-10-27

Owner triển khai: subagent `/root/csd_adapter`; reviewer `/root`. Đã đọc protocol, manifest DRAFT, checker, fixture cases, validation và handoff. Đây là nhánh subagent trong chat lead; chat triển khai riêng `CSD agent` đang làm P01.03.

## Kết luận vòng 1

**Chưa nghiệm thu P00.04; yêu cầu sửa R04.** Lead chạy độc lập `node scripts/check-benchmark-protocol.mjs --self-test --output .brain/evidence/lead-p00-protocol-checks-2026-10-27.json`: 40/40 PASS. Tuy nhiên kiểm bổ sung tìm được trường hợp checker nhận elapsed sai khi resume. Gate nguồn giữ nguyên, không có Facebook live.

### R04 — P2: Resume có thể bỏ phần high-water elapsed đã tích lũy

Trong `scripts/check-benchmark-protocol.mjs`, nhánh RESUME kiểm elapsed mới không nhỏ hơn elapsed cũ và elapsed tuyệt đối từ UTC Start. Chưa cộng downtime từ `previous.last_seen_at` vào high-water elapsed của checkpoint. Điều này trái phần 5 của protocol.

Repro bằng bundle tổng hợp hợp lệ, Start `00:00`, deadline `00:30`, previous.last_seen `00:05`, previous.elapsed `301` giây (monotonic hơn UTC 1 giây, dưới ngưỡng drift 2 giây). Resume lúc `00:10` khai elapsed `600`: checker trả `[]`; giá trị tối thiểu đúng phải **601**. Bundle khai 601 cũng trả `[]`. Repro không đổi hash/config, không chứa secret hay dữ liệu thật.

Yêu cầu: với UTC continuity được coi là tin cậy, kiểm tối thiểu `previous.elapsed + (now - previous.last_seen)` bên cạnh các ràng buộc hiện có; kiểm checkpoint thời gian hợp lệ với Start/elapsed/deadline. Thêm regression cho trường hợp high-water hơn UTC nhưng dưới drift threshold, resume đúng giữ phần chênh và resume vượt deadline theo elapsed tích lũy. Giữ semantics read-only/claims-only; không mở rộng thành runtime scheduler.

## Các phần đã review đúng hướng

Tách source probe/benchmark/offline, không đòi proof search trước probe. Snapshot khóa membership và record/evidence versions; query/source scope, clock, budget và data policy có dấu vết. Mẫu giữ DRAFT/PROPOSED, không tạo permission hoặc approval giả. Không coi test fixture là nguồn thật hoặc xác minh 1.000 bài.

Đề xuất budget nhỏ và data policy đã cụ thể để lead quyết định trong phạm vi được giao; chưa cần hỏi lại người dùng về Meta API. Sau sửa và nghiệm thu, ưu tiên hoàn tất chuẩn bị route/session thực và thử nguồn theo điều kiện cụ thể, không chuyển sang xây sâu UI/scale.

## Vòng 2 — nghiệm thu sau sửa R04 và route binding

Lead đã đọc phần sửa checkpoint/RESUME, selected route và các regression. Chạy độc lập `node scripts/check-benchmark-protocol.mjs --self-test --output .brain/evidence/lead-p00-protocol-checks-r2-2026-10-27.json`: **51/51 PASS**; `node --check scripts/check-benchmark-protocol.mjs` PASS; manifest của agent **7/7 hash khớp**. Giữ [evidence 40 ca vòng 1](lead-p00-protocol-checks-2026-10-27.json) để không xóa dấu vết lỗi cũ.

R04 đã sửa: giữ previous.elapsed + downtime, checkpoint phải có thời gian/elapsed hợp lệ, dừng khi elapsed tích lũy hết ngân sách dù UTC chưa tới deadline. Ca chênh 301 + 300 chỉ nhận 601, không nhận 600. Source readiness nay chỉ từ đúng một entry của adapter được chọn; route khác không giúp route đang thiếu điều kiện vượt preflight.

**Chấp nhận P00.04 DONE cho protocol, template và checker**, không phải nguồn thật. [Evidence vòng 2](lead-p00-protocol-checks-r2-2026-10-27.json). Ngân sách/data policy cho thử nhỏ được lead chốt riêng trong [quyết định probe](../decisions/ADR-009-source-probe-operational-limits.md); không biến template thành manifest frozen hoặc user/platform approval. G00 chưa PASS: session thật, điều kiện route và host thử có giới hạn vẫn cần hoàn tất.

Giao subagent phần chuẩn bị offline của P02.02; tách dependency cho chuẩn bị với dependency G00 của live probe ngay trong master plan. Đây không phải PASS một phần gate. P01.03 vẫn do chat CSD agent triển khai, không nhận task xây sâu UI/scale.
