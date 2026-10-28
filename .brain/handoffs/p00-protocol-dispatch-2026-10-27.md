# Giao P00.04 — chuẩn bị protocol và source probe sớm

Ngày 27/10/2026. Agent được giao: **CSD adapter agent**, canonical name `/root/csd_adapter`, sau khi P02.01 đã được lead nghiệm thu. Trạng thái chỉ nằm trong [master plan](../master_plan.md).

## Mục tiêu và đầu ra

Hoàn thiện phần chuẩn bị P00.04: `.brain/specs/benchmark_protocol.md`, manifest template có version, bộ kiểm tra manifest/preflight offline và evidence kết luận đề xuất cho G00. Không xây parser/browser/DB hoặc chạy nguồn thật trong task này. Source probe P02.02 phải độc lập với việc hoàn thành toàn framework.

Đọc contract 1.0.0, campaign.coffee.json, source matrix, ADR-002/008, mục 3 và P00.04 trong master plan. Giữ nguyên mục tiêu Facebook 1.000 bài/24h, presence cả ba nguồn, bài cũ được lấy, policy coffee-intent-v1 và định nghĩa identity/capture mode.

## Nội dung bắt buộc

1. Tách probe nhỏ P02.02, benchmark G02 cold run và warm/replay/import; không dùng mẫu giả hoặc kết quả TikTok để mở gate Facebook.
2. Freeze manifest: campaign/config/adapter/parser/rule/code version hoặc hash; source/seed lineage; run ID và start/deadline bất biến; capture provenance; ngân sách và data handling. Template có trạng thái DRAFT rõ, không tự tạo hash/approval/permission đã có.
3. Start/restart/cutoff: pause/sleep/retry/re-login tính vào wall clock; thời gian chỉ được giữ hoặc ngắn lại, không reset. Nêu cách phát hiện clock anomaly và phạm vi bảo đảm trên máy local.
4. Snapshot khóa membership cùng record/evidence version/hash đã persist đúng cutoff. Audit sau run chỉ đánh giá bằng chứng đã freeze, không hydrate/thêm bài để bù.
5. Điều kiện dừng và report: deadline, ngân sách, no-progress, source exhaustion có bằng chứng, auth/challenge/schema failure; raw/unique/verified/novelty/source breakdown/cost/operator time; không suy cạn một query thành tìm hết Facebook.
6. Đề xuất một cấu hình probe nhỏ cụ thể (số query/batch, wall time, storage và giới hạn can thiệp) để lead duyệt kỹ thuật. Mặc định không mua dịch vụ; không biến số đề xuất thành yêu cầu người dùng hoặc ngân sách đã được giao. O04/O06 chưa chốt vẫn hiện rõ.
7. G00: đánh giá dựa trên bằng chứng hiện có; source session/capability/quyền/product fit là bốn trục khác nhau. Không hỏi lại hiện trạng Meta API, không mặc định Meta app là route bắt buộc. Không giả permission/source AVAILABLE. Ghi chính xác việc còn thiếu để làm bước thử tiếp, tránh điều kiện vòng “phải có kết quả probe trước khi được probe”. Chỉ lead chốt gate trong master plan.
8. Kiểm offline các trường hợp reset deadline, import/cache giả LIVE, thiếu hash/version, đổi scope, snapshot thiếu version/evidence, template DRAFT bị chạy như manifest thật. Kiểm tra meaningful invariants; không xây scheduler/evaluator sản phẩm trong task tài liệu này.

## Phạm vi file và phối hợp

Được ghi `.brain/specs/benchmark_protocol.md`, `.brain/specs/benchmark_manifest*.json`, `scripts/check-benchmark-protocol.mjs` nếu cần, fixture tổng hợp tại `tests/fixtures/protocol/` và evidence/handoff P00.04. Không sửa `src/`, package/lock/tsconfig, CampaignSpec/schema/coffee workload, master plan hoặc README. Dùng Node hiện có, không thêm dependency.

Nhánh session P01.02 vẫn do CSD agent thực hiện và giữ output build chung. P00.04 không cần build Electron hoặc ghi dist/.test-build. Khi bàn giao, nêu đầu ra đã kiểm, quyết định còn mở và đề xuất G00; không tự nhận DONE hay mở live probe. Nếu có thiếu đầu vào, hoàn thiện toàn bộ phần độc lập trước rồi báo lead đúng phần thiếu, không gửi lại câu hỏi cũ cho người dùng.
