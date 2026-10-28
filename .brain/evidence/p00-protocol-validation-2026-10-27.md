# P00.04 — Kiểm chứng protocol offline, 2026-10-27

Agent thực hiện: `/root/csd_adapter`. Phạm vi theo [dispatch](../handoffs/p00-protocol-dispatch-2026-10-27.md). Đây là bằng chứng để lead nghiệm thu phần chuẩn bị, không thay trạng thái task/gate trong master plan.

## Kết quả đã kiểm

`node scripts/check-benchmark-protocol.mjs --self-test --output .brain/evidence/p00-protocol-checks-2026-10-27.json` → **51/51 PASS** sau R04/route binding, exit code 0. [Kết quả JSON](p00-protocol-checks-2026-10-27.json) liệt kê từng ca; [fixtures](../../tests/fixtures/protocol/invalid-cases.json) là dữ liệu tổng hợp, không chứa bài Facebook hoặc secret thật. `node --check scripts/check-benchmark-protocol.mjs` cũng PASS.

| Nhóm invariant | Bằng chứng kiểm |
| --- | --- |
| Chuẩn bị và freeze | Template DRAFT, budget/data PROPOSED không vượt preflight; hash/version thiếu, artifact khác manifest hoặc scope khác bị báo lỗi |
| Không có gate vòng | Probe synthetic với technical UNPROBED và fit UNPROVEN vẫn nhất quán khi session/điều kiện/budget/data được mô phỏng là sẵn sàng; không yêu cầu G01/1.000 bài trước probe |
| Clock/restart | Extension, reset elapsed, start khác checkpoint, clock lùi/uncertain, UTC deadline hoặc monotonic elapsed hết hạn đều chặn continuation |
| Provenance | IMPORT/FIXTURE/CACHE/REPLAY và observation từ run cũ không được relabel thành LIVE bằng manifest; warm output cũng không được preload post |
| Scope/nguồn | TikTok/private scope không thay benchmark Facebook công khai; enum array/object không thành string; post permalink không thành seed nguồn chỉ bằng nhãn SOURCE |
| Snapshot | Record version/hash, membership và digest riêng của host bắt buộc; observation/evidence persist muộn bị loại; claim không thêm identity ngoài snapshot |
| Audit | Audit muộn trên evidence đã freeze hợp lệ; candidate UNVERIFIED vẫn nằm trong snapshot nhưng không claim valid; sửa record rồi rehash không thay được digest freeze cũ của host |

Không chạy build Electron, `dist/`, `.test-build/`, test sản phẩm chung, Facebook, Apify hoặc mua dịch vụ. Không sửa `src/`, package/tsconfig/CampaignSpec, master plan hoặc README. Kiểm script dùng Node hiện có, không thêm dependency.

## Sửa sau review vòng 1: R04 và route binding

[Lead review](lead-p00-protocol-review-2026-10-27.md) tìm đúng lỗi: bộ 40 ca trước chưa phát hiện việc resume bỏ phần chênh elapsed đã tích lũy. Bản sửa cộng downtime vào high-water checkpoint, không chỉ so hai lower bounds độc lập.

- Repro Start 00:00/deadline 00:30, checkpoint 00:05/elapsed 301, resume 00:10/elapsed 600: nay trả `ELAPSED_TIME_RESET`; elapsed 601 trả `[]`.
- Resume 00:29:58/elapsed 1799 còn hợp lệ. 00:29:59 yêu cầu tối thiểu 1800 nên chặn `COLLECTION_DEADLINE_PASSED`, ngay cả khi khai 1799; khai thấp còn bị `ELAPSED_TIME_RESET`.
- Checkpoint trước Start/sau deadline, ngày không có thật, elapsed sai type/thấp hơn UTC duration bị từ chối. Chênh checkpoint elapsed với UTC >2 giây theo proposal bị `CLOCK_UNCERTAIN`; chênh 1 giây được giữ nguyên.
- Xác nhận lỗi route cũng tồn tại trong bản trước: chỉ cần một entry bất kỳ sẵn sàng. Bản sửa chỉ cộng nguồn từ entry có `route_id === versions.adapter_id`, yêu cầu đúng một entry như vậy. Route khác ready không cứu route đã chọn đang UNRESOLVED; thiếu/trùng entry được chọn bị `SELECTED_ROUTE_BINDING_INVALID`.
- Regression route dùng manifest đã recompute digest nhất quán nên lỗi không bị che bởi hash mismatch. Ca dương chứng minh adapter được chọn ready vẫn chấp nhận dù có một route khác chưa ready.

Thêm 11 ca có ý nghĩa, tổng 51. Không đổi các giới hạn read-only/claims-only, không xác nhận quyền hoặc mở live. Nội dung review của lead và evidence vòng trước do lead quản lý giữ nguyên; evidence/hashes của agent phản ánh bản sửa mới.

## Đề xuất đánh giá G00

**Chưa đủ bằng chứng để đề xuất PASS G00 ở thời điểm bàn giao.** Phần độc lập của protocol đã sẵn sàng để review; các ngưỡng thử nhỏ vẫn PROPOSED. Lead là người quyết định task/gate, không ghi DONE/PASS từ script.

| Trục | Bằng chứng hiện có | Phần còn thiếu trước live |
| --- | --- | --- |
| Session | Người dùng có account thường; [lead đã nghiệm thu P01.02](lead-p01-session-review-2026-10-27.md) về profile isolation, session lifecycle và fixture restore | Một phiên CSD thật do người vận hành thiết lập hoặc route anonymous được kiểm setup, có ref; chưa có login Facebook thật |
| Technical capability | P02.01 contracts/fake đã nghiệm thu; P01.02 host offline đạt; P01.03 observer đang do agent khác thực hiện | Probe host/harness nhỏ, version/hash, counter/stop/redaction cần sẵn sàng; **không cần** có kết quả search/paging trước probe, không bắt đợi framework đầy đủ |
| Điều kiện nguồn | [Source matrix](../specs/source_access_matrix.md)/ADR-002/008 ghi đúng account thường, chưa app/API grant/chấp thuận automation riêng | Đánh giá điều kiện áp dụng cụ thể cho browser route và disposition có evidence; không suy login thành quyền, không đòi Meta app mặc định hoặc hỏi lại hiện trạng cũ |
| Product fit | Campaign coffee đã chốt intent/ba nguồn/1.000 trong 24h | UNPROVEN được phép ở source probe; yield, field coverage, pagination và source mix là **đầu ra P02.02**, không là input G00 |

Source matrix/ADR cũ có mô tả vendor chưa thử; trong phiên hiện tại, người dùng đã báo Apify Facebook **posts** được 8 và TikTok gần 500, không có lỗi run. Báo cáo của người dùng chưa kèm dataset/run metadata để CSD kiểm độc lập, không dùng làm proof G00/G02 hoặc suy nguyên nhân Facebook ít kết quả. P00.04 không sửa tài liệu do owner khác quản lý.

## Quyết định/đầu vào cần lead xử lý

| Đầu vào | Giá trị đề xuất hoặc công việc đã chuẩn bị | Người/bước xử lý |
| --- | --- | --- |
| O04 — ngân sách probe | 3 query, 30 phút, 100 candidates, 20 controlled actions (không phải toàn HTTP), 5 batch/query, 50 MB, 10 phút operator, 1 retry/batch, 0 chi phí ngoài | Lead duyệt kỹ thuật trong phạm vi được giao; nếu vượt thẩm quyền thì đưa đúng proposal cho owner quyết định, không tự ghi user-approved |
| O06 — dữ liệu probe | Local-only, retention 7 ngày, JSONL + JSON summary, mục đích kiểm khả thi; raw data/secrets ngoài repo/.brain | Lead/owner chốt policy cụ thể và decision_ref trước dữ liệu thật; ngân sách/policy sản phẩm 24h vẫn là quyết định riêng |
| O03 — route/session | FB_BROWSER_PUBLIC_SEARCH là route nghiên cứu; setup CSD và condition assessment như bảng trên | Lead điều phối bước xác minh còn thiếu, không hỏi lại Meta API hoặc loại search posts |
| Run envelope | Template DRAFT có đủ trường; unknown vẫn null/UNRESOLVED | Host tạo manifest frozen mới ở Start với artifact/config/campaign hashes thật; không chỉnh template thành bằng chứng lịch sử |

## Giới hạn của kiểm chứng

- Checker read-only là bộ đối chiếu claim/hash và test protocol; luôn `execution_authorized:false`, không gọi mạng hoặc cấp quyền/gate. Những giá trị LIVE/CONFIRMED/READY và `fixture://` trong self-test là **claim tổng hợp**, không là phiên/quyền/ngân sách thật.
- Không thay runtime CampaignSpec validator/schema, permission verification, parser, relevance classifier, evaluator 1.000 bài, scheduler hoặc bộ giới hạn network thực thi. Trước host Start vẫn phải chạy validator sản phẩm đã có (gồm RANGE `from < to`, timezone, normalized keywords và schema đầy đủ), rồi bind exact campaign hash.
- Hash là consistency check của JSON và các file bàn giao. Nếu cùng một người sửa cả manifest/execution/freeze anchors thì checker không phát hiện được tất cả; không tuyên bố tamper-proof hoặc trusted capture chỉ vì JSON ghi LIVE.
- Kiểm seed chỉ chặn hình thức permalink phổ biến và kiểm lineage claim; URL nguồn thật/publicity vẫn phải xác minh từ evidence. Không quảng cáo URL regex là classifier hoàn chỉnh Facebook.
- Không có LIVE observation; chưa chứng minh khả thi 1.000 bài/24h hay giải thích được kết quả Apify 8 bài.

[Handoff](../handoffs/p00-protocol-2026-10-27.md) · [File hashes](p00-protocol-manifest-2026-10-27.json).
