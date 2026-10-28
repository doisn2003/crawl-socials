# P02.02 — Đo điều kiện loại timestamp trên nguồn thật

28/10/2026, Asia/Bangkok. Tiếp nối ADR-016; không thêm quyền action hay mở rộng phạm vi nguồn.

## Evidence

[LIVE v19](../evidence/p02-live-search-post-open-v19-2026-10-28.json): run52ms, SAMPLES_READY,1.832steps/7examined, hai qualified group-public headers, hai no_timestamp_headers, không ambiguity. Không có target, click attempt hoặc post read. Summary chỉ lưu scan hash/counters tổng, không cho biết filter cụ thể đã loại link. Không coi đây là Facebook chặn hoặc không có bài; source UI đã có public-group headers.

## CSD agent

Thêm instrumentation nhỏ vào fixed search-open eligibility scan: counter từng rejection stage và tối đa5 shape enums nếu cần để phân biệt record không có, heading/body/quote, rendered/visibility, href classification, popup/author/control/media, viewport, header co-location. Chỉ enum/count/boolean; không raw href/text/ID/attribute value/DOM dump. Mỗi record ghi first decisive rejection, không spam trace; output vẫn32KiB, node/time/budget giữ nguyên. Summary/proof phải chứa đủ số liệu sạch để lead biết phải sửa điều kiện nào ở lần thật.

Giữ cả negative menu/author, stale/boundary/barrier. Không nới visibility/temporal/header gate chỉ để tăng yield; không thêm click/retry/scroll. Nếu phát hiện lỗi logic với repro cụ thể có thể sửa và chứng minh trong cùng lượt, nhưng fixture không tự xác định nguyên nhân LIVE. Tái dùng module hiện có, không tạo framework hoặc telemetry tổng quát. Owner tests/native phù hợp rồi freeze nhanh để lead lấy một lần metadata thật.

Ownership như đợt ADR-016: source/owner tests/native fixture/build riêng. Không reviewer files, shared dist, profile/.env, runtime, master/README/gates. Main được giao trước khi ghi handoff này.

## csd_adapter

Review độc lập chuỗi temporalRecords → eligible target → visibleSignal → headerFrames; báo lỗi cụ thể nếu tái hiện được. Sau freeze kiểm bound/redaction và guard/action behavior không đổi, giữ reviewer snapshots trước. Không suy root cause từ phỏng đoán CSS hoặc fixtures. Không source/UI/account access. Reviewer đã được gọi tiếp tục lượt này.

## Lead

Runtime13252/main1900748/source3539992, search công khai cafe Hà Nội,1/3starts đã dùng. Không lặp run cũ vì cùng dữ liệu sẽ không phân biệt được giả thuyết. Sau review build mới, lead chạy đúng một discovery/open diagnostic; nếu đủ target thì thực hiện tối đa một click/read đã được ADR-016 cho phép. Kết quả phải quyết định patch cụ thể hoặc bước pilot nhiều bài tiếp theo. Permission UNKNOWN, benchmark OFF, valid0/gates giữ nguyên.

## Finding R-SO3 và phân công bổ sung

Reviewer tái hiện trên compiled v19: một group-only link không đủ href eligibility có geometry không rõ làm `c.visibilityUnknown` lan sang timestamp hợp lệ trong cùng header. Lead chạy độc lập frozen repro: 1 ca FAIL đúng finding, 1 ca PASS bảo đảm timestamp thật có geometry không rõ vẫn bị từ chối. [Bằng chứng và baseline](../evidence/adapter-p02-search-target-diagnostics-review-2026-10-28.md).

Đã giao CSD agent sửa hẹp thứ tự lọc hoặc phạm vi ảnh hưởng của record không thể là action target, giữ geometry guard của timestamp thật. Instrumentation cần phân biệt nguồn invalidation theo enum; không suy đây là nguyên nhân LIVE khi chưa có số liệu. Reviewer đã trả baseline và đang chờ owner freeze; không mô tả cả hai worker đang chạy. Lead sẽ gọi reviewer kiểm bản mới sau freeze.
