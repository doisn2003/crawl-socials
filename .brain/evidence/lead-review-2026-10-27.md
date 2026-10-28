# Nghiệm thu độc lập — CSD agent — 2026-10-27

Reviewer: Agent điều phối trong chat “Đánh giá khả thi thu thập bài viết”. Tác giả được review: chat **CSD agent**, ID `01a17be1-8b41-7f91-86aa-e5e27904a34f`. Phạm vi đã bàn giao: P00.01–P00.03 và P01.01.

## Kết luận

**Chấp nhận bộ khung P01.01 và đầu ra thiết kế P00 trong phạm vi offline.** Không phát hiện lỗi chặn việc tiếp tục P01.02/P02.01 qua lượt đọc code và kiểm thử này. Có một lỗi validation cần sửa trong đợt tiếp theo, nêu bên dưới. Chưa nghiệm thu crawler Facebook, packaged executable hoặc benchmark.

## Kiểm chứng độc lập

| Kiểm tra | Kết quả |
| --- | --- |
| Đọc code | Main/preload/renderer, bootstrap service, runtime paths, validator, schema, unit tests và smoke harness |
| `npm run check` | PASS; type checks + 44 contract checks |
| `npm test` | PASS; 8 unit tests + 44 contract checks |
| `npm run test:smoke -- --output .brain/evidence/lead-bootstrap-smoke-2026-10-27.json --screenshot .brain/evidence/lead-bootstrap-smoke-2026-10-27.png` | PASS; build + 2 lượt Electron cùng temp root, bridge/fixture/network block/close/relaunch/isolation |
| Contract/source matrix/ADR đối chiếu bàn giao | Có đầu ra; phân biệt route UNKNOWN và task DONE, giữ ba loại nguồn và chỉ tiêu 1.000/24h |

[Smoke JSON](lead-bootstrap-smoke-2026-10-27.json) và [manifest SHA-256 trước khi giao việc mới](lead-review-baseline-2026-10-27.json) là bằng chứng của lượt nghiệm thu này. Không cập nhật manifest lịch sử của tác giả để làm khớp thay đổi mới. Build Windows/ASAR của tác giả đã có evidence nhưng reviewer không chạy lại packaged executable; phần đó chưa được nâng thành release acceptance.

## Phát hiện cần sửa

**R01 — P2: validator nhận khoảng thời gian đảo chiều.** Trong `src/infrastructure/config/campaign-validator.ts`, `parse` chỉ kiểm schema rồi clone. Schema kiểm từng UTC timestamp nhưng chưa kiểm `from_utc <= to_utc`. Probe độc lập trên validator đã compile nhận `RANGE` từ `2026-10-27T00:00:00Z` đến `2020-01-01T00:00:00Z` mà không báo lỗi.

Ảnh hưởng: cấu hình không thể thỏa mãn khoảng thời gian vẫn được chấp nhận, có thể tạo run rỗng và chẩn đoán sai khi thêm nguồn thật. Campaign coffee hiện dùng UNBOUNDED và bootstrap chưa chạy collection, nên lỗi không chặn nghiệm thu bootstrap. Giao **CSD agent** sửa semantic validation và regression tests trước phần session P01.02; giữ thông báo lỗi cố định, không đưa dữ liệu input nhạy cảm vào lỗi. Nếu quyết định nhận khoảng bằng nhau, ghi rõ và kiểm cả trường hợp đó.

Không báo các tính năng chưa triển khai của P02/P05/P07 thành lỗi P01.01. Không tuyên bố test offline chứng minh quyền hoặc năng lực nguồn Facebook.

## Phân công tiếp theo

Đọc [handoff đợt 2](../handoffs/lead-dispatch-2026-10-27.md). Trạng thái/owner hiện hành chỉ ở [master plan](../master_plan.md).

Người dùng đã xác nhận lần thử Apify Facebook tìm **posts**. Reviewer đã sửa nghiên cứu để rút giả thuyết chọn nhầm pages-google; các Agent không hỏi lại hoặc sử dụng giả thuyết đó làm kết luận.
