# Lead review controller P02.02 — 2026-10-27

Reviewer `/root`; phạm vi bàn giao tại [controller handoff](../handoffs/csd-probe-controller-p0202-2026-10-27.md). Đây là kết quả nghiệm thu phần offline, không phải hoàn thành P02.02 hay PASS G00.

## Kết quả kiểm độc lập

Lead đã đọc contract/controller/driver, writer/freeze, IPC/main wiring, unit và harness; subagent review read-only writer/freeze tại [report](adapter-p02-controller-review-2026-10-27.md). Không có finding mở trong controller fixture trên bản manifest 31/31 SHA-256 khớp.

| Kiểm do lead chạy | Kết quả |
| --- | --- |
| `npm run check` | Type checks PASS; 44 contract checks PASS |
| `npm test` | 89/89 unit + 44 contract PASS |
| `npm run test:probe -- --output .brain/evidence/lead-p02-controller-smoke-2026-10-27.json --screenshot .brain/evidence/lead-p02-controller-ui-2026-10-27.png` | 2 process, 9 nhóm kiểm, 15 diagnostics, valid=0; build pins 97 inputs/artifacts |
| `node scripts/session-smoke.mjs --output .brain/evidence/lead-p02-session-regression-2026-10-27.json` | 3 phases, 13 checks PASS |
| `node scripts/bootstrap-smoke.mjs --output .brain/evidence/lead-p02-bootstrap-regression-2026-10-27.json` | 2 launches PASS |
| `node scripts/observer-debug.mjs --mode fixture --scenario all --output .brain/evidence/lead-p02-observer-regression-2026-10-27.json` | 9 checks, 10 captures PASS |

Outer deadline/counters không reset theo segment; Stop hủy pending Start; suspend/coverage loss kết thúc run. Writer chỉ nhận diagnostic metadata qua sanitizer, không lưu raw response text/URL/header. Late write bị loại khỏi frozen membership; rollback giữa write bị chặn trên bản cuối. Build/config/source references được hash trước action. UI smoke có form phiên và trạng thái fixture đúng như ảnh lead đã xem.

Giới hạn: không có driver tìm kiếm/phân trang Facebook, parser bài/publicity/source/relevance hay evidence nguồn thật; valid luôn 0. Policy references pin path/hash, không giữ bản text. Retention 7 ngày cần cleanup thủ công. Operator ledger không đo attention bên ngoài app. Không nghiệm thu packaged executable. Chưa login Facebook.

## R06 — normal visible launch chưa đạt

Sau các test, lead mở app thật bằng Electron của workspace với arguments `.` và `--allow-manual-facebook-login`, cwd workspace, không có smoke flag. Không có instance Electron trước đó. Root process được tạo là 23964; cửa sổ trả về đúng app executable và title `CSD — Crawl Socials Data`.

Sau activate và lấy lại state bằng computer-use, cửa sổ hiện background trống màu sáng, không thấy form/campaign; accessibility chỉ có các region. Smoke ẩn trước đó có UI đầy đủ. Quan sát này **chưa xác định root cause**: cần phân biệt lỗi app/launch/rendering với giới hạn capture. Snapshot đầu khi chưa activate trả ảnh không đúng cửa sổ; ảnh đó không dùng làm bằng chứng app. Snapshot sau activate đã có đúng title CSD và vùng trống.

Đã giao CSD agent R06: tái hiện normal/manual-login launch, kiểm DOM/paint/runtime, sửa nguyên nhân nếu thuộc code/launch, xác minh visible UI thật; giữ observer/crawler tắt. Được đóng/relaunch đúng instance CSD do lead mở, không đụng app khác hoặc xóa userdata. Build ownership đã trả CSD agent. Chưa yêu cầu người dùng đăng nhập vào một cửa sổ chưa dùng được.

Cập nhật tiến độ R06: snapshot chat cursor `32a77677-5118-4445-9c7c-12dd42f259df:19` cho biết agent kiểm cùng window/process đã thấy UI đầy đủ và đang thử fresh normal launch để phân biệt startup/paint/capture. Đây là báo cáo trong lúc chạy, chưa phải root cause hoặc bằng chứng cần sửa code. Không khẳng định app luôn trắng; chờ kết quả xác minh cuối.

**Quyết định:** nhận phần controller fixture; P02.02 tiếp tục IN_PROGRESS, visible readiness chờ R06. Không đổi gate. Sau R06 cần người dùng tự đăng nhập trong CSD để khảo sát phiên/UI thủ công; automated route disposition và driver/parser vẫn là vấn đề riêng, login thành công không tự giải quyết chúng. Không hỏi lại Meta API.

## Phân công tiếp

- Chat **CSD agent**: R06 thuộc P02.02; source/main/renderer/preload và build chung trong phạm vi sửa lỗi.
- Subagent **`/root/csd_adapter`**: chuẩn bị rubric P06.01 theo [dispatch](../handoffs/p06-rubric-preparation-dispatch-2026-10-27.md), chỉ tài liệu và ví dụ synthetic riêng. Không thêm UI/scale hoặc chạm build.
- Lead: nghiệm thu R06, chuẩn bị bước human login khi UI dùng được; giữ sự khác biệt giữa quyền dùng account, điều kiện nền tảng và tính khả thi kỹ thuật.

Đây vẫn là **1 chat triển khai + 1 subagent**. Trạng thái thực từng worker phải đọc từ tool, không suy cả hai đang chạy chỉ vì có owner.
