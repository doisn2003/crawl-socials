# P00.04 — Protocol source probe và benchmark CSD 1.0.0

Ngày 2026-10-27, Asia/Bangkok. Áp dụng [product contract 1.0.0](product_contract.md), [campaign coffee](campaign.coffee.json), [source matrix](source_access_matrix.md), ADR-002/008 và master plan. Đây là protocol; task/gate hiện hành do lead quản lý trong [master plan](../master_plan.md).

**Đề xuất G00 hiện tại: chưa đủ bằng chứng để PASS.** Có đủ khung phép thử offline; session/điều kiện nguồn thực và quyết định ngân sách/lưu dữ liệu vẫn cần chốt. Không yêu cầu thêm Meta app mặc định, không yêu cầu có kết quả search/pagination trước khi được probe. Không mở Facebook/Apify trong P00.04.

## 1. Ba phép đo khác nhau

| Loại run | Mục tiêu | Được kết luận |
| --- | --- | --- |
| SOURCE_PROBE / P02.02 | Với một route cụ thể, xem có nhận đúng entity posts, trường gì, continuation/stop reason gì, loại nguồn nào quan sát được | Khả năng quan sát của route trong mẫu đã thử; không tuyên bố 1.000/24h |
| BENCHMARK / P08 / G02 | Ít nhất 1.000 bài Facebook hợp lệ trong ≤24h, presence cả ba nguồn theo contract, audit từng identity | PASS/FAIL G02 sau audit trên snapshot đóng băng |
| REPLAY/IMPORT/CACHE/FIXTURE | Kiểm phần mềm, parser, recovery hoặc đánh giá dataset đã có | Kết quả offline; không tăng số bài LIVE cho G02 |

Cold run bắt đầu với đầu ra run rỗng: không nạp trước post IDs/nội dung vào tập đếm hoặc cung cấp danh sách permalink bài làm seed. Đăng nhập ban đầu được phép là setup trước Start, ghi riêng thời gian/setup và profile reference. Source URL seeds được phép nếu có lineage và điều kiện nguồn phù hợp. Khi dùng registry/source từ run trước, khai báo WARM và xuất xứ; không báo thành cold discovery.

Warm LIVE run có thể tìm lại bài từng biết bằng request thực trong run mới, đếm một lần trong run mới theo cùng contract và báo novelty riêng. Tập output của warm run vẫn bắt đầu rỗng; lịch sử hỗ trợ discovery/novelty tách riêng, không preload bài vào tập đếm. Warm kết quả không thay bằng chứng cold run đầu tiên. Thư viện/CSD cache không thành LIVE vì được đọc trong 24 giờ; cache nội bộ phía nền tảng khi có request nguồn thật trong run không phải CSD CACHE.

TikTok và Apify run cũ không cộng vào chỉ tiêu Facebook. Người dùng đã xác nhận Apify tìm **posts**; không dùng giả thuyết pages-google để giải thích 8 kết quả.

## 2. Cấu hình source probe nhỏ đề xuất

Tất cả ngưỡng trong bảng này là **PROPOSED để lead duyệt kỹ thuật**, chưa là ngân sách được người dùng giao, không có permission grant ngầm. [Manifest template](benchmark_manifest.template.json) giữ DRAFT/PROPOSED và các evidence/hash chưa có là null.

| Mục | Đề xuất |
| --- | --- |
| Route | FB_BROWSER_PUBLIC_SEARCH, profile CSD riêng; không mượn profile HotMatch |
| Query khởi tạo | `quán cà phê`, `cafe Hà Nội`, `Tiny Cafe`; ba query có trong campaign đã chốt |
| Wall time | Tối đa 1.800 giây từ Start, gồm mọi pause/retry/re-login |
| Thu ứng viên | Tối đa 100 candidates tổng, 5 batch/query, không bảo đảm đủ 100 |
| Collection actions | Tối đa 20 actions; một navigation/search/load-next/read-detail chủ động = một action; retry cũng tăng counter |
| Network telemetry | Báo riêng HTTP request count nếu quan sát được và mức coverage; `max_requests` của proposal là controlled actions, **không gọi nó là hard cap mọi HTTP request của browser** |
| Chi phí dịch vụ ngoài | 0 VND, không mua proxy hoặc chạy Actor trả phí |
| Dung lượng | 50 MB dữ liệu/evidence của run; giới hạn buffer/response trước ghi, ngừng nhận batch nếu không thể persist trong budget |
| Can thiệp trong run | Tối đa 600 giây; setup trước Start tách riêng, audit sau cutoff tách riêng |
| Retry | Tối đa một retry/batch cho lỗi transient; không tự retry challenge/permission/auth failure |
| Không tiến triển | Hai batch liên tiếp không có ID/cursor tiến triển theo định nghĩa bên dưới → dừng nhánh NO_PROGRESS |
| Dữ liệu | Đề xuất local-only, giữ 7 ngày, JSONL records + JSON summary; không tải toàn bộ media mặc định |

Probe không phải benchmark: không cần đủ ba nguồn trước khi bắt đầu. Một nguồn đáp ứng điều kiện thử là đủ để thử route; ghi rõ Page/Group/personal chưa thử hoặc không xuất hiện. Nếu có nhiều nguồn, báo từng loại. Không đánh dấu nguồn AVAILABLE chỉ vì template liệt kê tên nguồn.

Mẫu 20–100 bài là kích thước tìm hiểu, không là điều kiện G00. Probe chạy độc lập bằng host nhỏ/fixture-tested harness có counter và lưu evidence; không cần đợi SQLite, durable queue, UI hoàn chỉnh hoặc tích hợp Crawlee.

## 3. Freeze cấu hình và manifest

Trước Start: khóa campaign snapshot, normalized keyword list/intent/geography/content types, source minima, historical window, identity policy, seed lineage, expansion policy, ngân sách và data policy. Cấu hình coffee giữ 1.000/86.400s và cả ba minimum=1; SOURCE_PROBE dùng thời lượng nhỏ ở manifest probe, không sửa target của campaign.

Tại Start, trước action thu đầu tiên: tạo run ID, ghi started_at/deadline_at, bind các digest/version và ghi manifest FROZEN bền vững. Phần thời gian ghi manifest cũng nằm trong run. Không dời Start đến response đầu tiên. Nếu ghi manifest thất bại, không bắt đầu thu.

Manifest bắt buộc có:

- Campaign ID/contract version và SHA-256 canonical JSON của snapshot campaign.
- Code SHA-256 manifest hoặc commit + artifact manifest để bao gồm uncommitted source; configuration/source-matrix digest.
- Adapter ID/version, parser version và coffee-intent-v1 rubric. `unversioned`, null hoặc hash giả không mở run.
- Query list đã chọn; query mở rộng giữ parent/reason/evidence theo policy đã freeze, không đổi intent để bù thiếu bài.
- Seed entries có source URL, source type, origin ref, evidence rằng URL là nguồn và thời điểm xác minh. Không cho post permalink làm seed.
- Bốn trục source readiness: session, technical capability, permission/điều kiện sử dụng, product fit.
- Clock, budget, data policy và các quyết định thực sự áp dụng. Không đổi PROPOSED thành CONFIRMED chỉ để qua checker.
- Freeze digest trên manifest trừ trường `freeze_sha256` của chính nó. Canonical JSON: object keys sort theo thứ tự codepoint, array giữ thứ tự; UTF-8, không whitespace phụ. Đây là consistency hash, không phải chữ ký chống người có quyền sửa file.

Template DRAFT không chạy được. Manifest benchmark thật cần campaign BENCHMARK đã giải quyết open questions; không sửa campaign coffee DRAFT trong P00.04. Tạo snapshot/version mới khi có quyết định thật, giữ lịch sử cũ.

## 4. Điều kiện trước probe và tránh gate vòng

| Trục | Cần trước SOURCE_PROBE | Điều được phép chưa biết |
| --- | --- | --- |
| Session | Profile CSD/anonymous route cụ thể, quyền dùng session của người vận hành, kiểm session setup tối thiểu và evidence ref | Chưa biết search có trả đủ bài hay không |
| Technical | Host/harness điều hướng + thu bằng chứng có giới hạn đã kiểm offline; route/query cụ thể được chọn | Search posts, paging, độ phủ ba nguồn và yield có thể UNPROBED — đó là mục tiêu P02.02 |
| Permission/điều kiện | Có đánh giá điều kiện áp dụng cho đúng route/mục đích/nguồn, ghi người quyết định và evidence ref; không ghi thành Meta grant nếu không có | Không suy từ login thành permission; chưa được kết luận UNKNOWN là đã đáp ứng |
| Product fit | Mục tiêu probe và cách báo cáo rõ | Có thể UNPROVEN; không đòi 1.000/24h, G01/G02 hoặc mẫu thật trước G00 |

Thiếu Meta API không tự chặn browser. Với hiện trạng người dùng chỉ có account cá nhân và chưa có chấp thuận automation riêng, assessment phải ghi đúng điều đó; không tự biến nghiên cứu này thành quyền nguồn. Lead cần chọn điều kiện thực thi phù hợp của route, hoặc giữ live chưa mở và chỉ hoàn tất phần chuẩn bị. Không hỏi lại câu đã có câu trả lời.

Benchmark chính thức yêu cầu G00/G01 đã được lead xác nhận và evidence nguồn cho phạm vi cần nghiệm thu; phần công suất/phù hợp vẫn chờ G02. Checker offline chỉ đối chiếu claim/ref/hash có nhất quán, không tự xác minh quyền của Meta hoặc thay quyết định gate.

Manifest 1.0.0 chọn một adapter/route: `versions.adapter_id` phải khớp chính xác một `source_readiness.route_id`. Chỉ evidence/session/điều kiện/source types của entry đó tạo readiness cho run; entry của route khác không thay thế hoặc bù source mix. Entry trùng route đang chọn bị từ chối vì mơ hồ. Nếu cần run phối hợp nhiều adapter, phải version hóa lựa chọn đó riêng, không suy từ việc có nhiều hàng trong source matrix.

## 5. Clock, restart và cutoff

`deadline_at = started_at + max_wall_time_seconds`. Với BENCHMARK, max_wall_time_seconds luôn 86.400. Run ID, started_at và deadline_at không đổi sau restart; có thể dừng sớm hơn bằng cutoff nhưng không kéo dài deadline. Pause/sleep/retry/network outage/re-login đều tính thời gian.

Trong process, ghi UTC wall-clock và monotonic elapsed từ cùng anchor. Sử dụng elapsed lớn hơn giữa wall elapsed và monotonic accumulation; không dùng bộ đếm “thời gian đang chạy job” để trừ pause. Lưu high-water mark elapsed cùng last-seen UTC/checkpoint bền vững. Đề xuất phát hiện drift khi hai clock lệch >2 giây: ghi CLOCK_UNCERTAIN và dừng thu để đánh giá; không cấp lại thời gian.

Sau restart, monotonic clock cũ không so trực tiếp với clock mới. Đọc manifest/elapsed high-water mark/last-seen UTC; cộng khoảng thời gian ngoài process theo UTC khi tin cậy, không giảm elapsed. Nếu UTC lùi hoặc continuity không xác lập được, chỉ finalise/audit run cũ; run thử mới phải có ID mới và không trộn dữ liệu. Runtime cần xử lý suspend/resume, không mặc định monotonic behavior trên mọi OS.

Continuation phải giữ `elapsed >= previous.elapsed + (now_utc - previous.last_seen_at)` bên cạnh elapsed từ Start. Checkpoint phải có thời gian hợp lệ trong `[Start, deadline]`, elapsed hữu hạn không âm và không thấp hơn UTC duration của chính checkpoint. Chênh quá drift threshold làm CLOCK_UNCERTAIN. Checkpoint hoặc tổng elapsed đã chạm deadline chỉ cho finalise/audit, không resume collection. Ví dụ checkpoint tại phút 5 có elapsed 301 giây; resume ở phút 10 yêu cầu ít nhất 601 giây, không được làm mất một giây high-water đã tích lũy. Nếu tổng tối thiểu đó đã hết budget, khai elapsed thấp hơn không cấp lại thời gian.

Giới hạn bảo đảm: máy local và file unsigned không chống được người có quyền sửa cả đồng hồ lẫn state. Benchmark đáng tin hơn cần log/anchor ngoài máy nếu muốn chống can thiệp chủ động. P00.04 không quảng cáo tamper-proof clock.

`cutoff = min(actual_stop_at, deadline_at)`. Observation chỉ nằm trong tập xét nếu `started_at <= observed_at <= persisted_at <= cutoff`. Sau deadline chỉ finalise/audit, không resume collection của run đó. Record đến trước cutoff nhưng persist sau cutoff không được đếm.

## 6. Snapshot và audit

Tại cutoff khóa membership **và** phiên bản record/evidence: identity, observation ID, source type, capture mode, observed/persisted time, record version/hash, evidence refs/version/hash và thời điểm evidence đã được lưu. Snapshot có membership hash và full snapshot hash; runtime freeze event giữ digest riêng để đối chiếu.

Snapshot membership có thể chứa ứng viên chưa được phân xử; chỉ ACCEPT đủ bằng chứng mới thuộc tập V cho nghiệm thu. Không dùng state hiện tại của Post sau này thay record version đã freeze. Alias/merge sau audit phải giữ trace đến membership cũ, không tạo bài mới.

Audit sau cutoff được tạo quyết định mới tham chiếu snapshot/record/evidence version cũ và có thể giảm số hợp lệ. Không đổi membership, nội dung hoặc bổ sung evidence bắt buộc còn thiếu tại cutoff. Mở permalink sau cutoff tạo observation mới ngoài snapshot; không hydrate bài cũ để đạt 1.000. Nếu 1.020 ứng viên còn 990 hợp lệ sau audit thì FAIL, không lấy thêm 10 bài để bù.

`time_to_target` chỉ xác nhận hồi cứu ở mốc có 1.000 identity và source minima đạt trên đúng version đã tồn tại tại mốc đó; không dùng evidence thu về sau để kéo mốc đạt về trước. Tính `published_at` theo nguồn; không dùng observed/indexed date thay ngày đăng. Nếu window UNBOUNDED thì published_at null được phép theo contract.

## 7. Stop conditions và thao tác tay

| Điều kiện | Hành vi và lý do báo |
| --- | --- |
| Deadline hoặc budget | Không nhận action mới; flush trong giới hạn; dữ liệu persist muộn bị loại khỏi snapshot; DEADLINE_REACHED/BUDGET_REACHED |
| Source báo end có bằng chứng | SOURCE_EXHAUSTED cho query/source đó; không suy “đã tìm hết Facebook” |
| Hai batch lặp | NO_PROGRESS nếu cả tập ID không thêm và cursor không tiến/đã lặp; log thống kê đã làm sạch; không gọi đây là hết nguồn |
| Auth/challenge/access denied | Dừng nhánh, ghi reason; can thiệp thủ công chỉ trong policy/budget, không tự quay account/proxy để tiếp tục |
| Schema/parser failure | Quarantine batch, dừng route để chẩn đoán; không trả OK rỗng |
| Clock không tin cậy | CLOCK_UNCERTAIN, dừng collection; không reset start/deadline |
| Chất lượng không đủ | Báo tỷ lệ UNVERIFIED/REJECT và lý do; chưa có threshold quality stop được duyệt thì không tự bịa ngưỡng PASS |
| Người vận hành Stop | Ghi actual_stop_at, đóng nguồn/remote run nếu có, freeze phần đã persist đúng hạn |

Số bài đạt mục tiêu không tự buộc dừng ở 1.000: tiếp tục khi còn hiệu quả/ngân sách như contract. Không kéo dài run đủ 24h chỉ để tăng thời gian quan sát.

Operator ledger ghi start/end/action/reason, không ghi nội dung credential. Tách setup trước Start, intervention trong run và audit sau cutoff. Tính union intervals để tránh cộng đôi thời gian song song; pause máy vẫn tính wall time ngay cả khi operator_seconds không tăng.

## 8. Báo cáo tối thiểu

- Raw observations, unique identities trước relevance, verified valid, unverified/rejected và lý do.
- Source breakdown Page/Group/personal theo bối cảnh xuất bản; một identity không lấp hai quota.
- Duplicates cùng mẫu số; new-to-campaign/new-to-global-history riêng, không gọi bài cũ tìm lại là bài mới đăng.
- Query/batch yield và coverage đã quan sát; discovery/extraction failures và stop reason.
- Time-to-first-valid, time-to-target đã audit, wall time, setup/operator/audit time.
- Controlled actions, HTTP requests quan sát được + coverage limitation, retries, auth/challenge/schema events, data bytes.
- Chi phí thực và model billing nếu có; cost/1.000 valid = cost / valid ×1.000, N/A nếu valid=0. Không suy giá raw record thành giá valid.
- Execution status, retrieval completeness và quality/gate result riêng. “Run không báo lỗi” không tự là benchmark PASS.

## 9. Data handling đề xuất

Mục đích probe là đánh giá nguồn/quán cà phê công khai; không thu danh bạ, email, số điện thoại hoặc dữ liệu không phục vụ bài toán. Public status phải có bằng chứng, không suy từ việc account nhìn được. Nhóm riêng tư/nhiều account vẫn thuộc phase mở rộng riêng.

Đề xuất dữ liệu vận hành ở namespace CSD ngoài repository/.brain, local-only, retention 7 ngày sau probe; raw body chỉ giữ phần cần đối chiếu, bỏ cookie/token/auth header/signed query secrets. Evidence trong .brain chỉ là summary, internal refs và digest đã làm sạch. Export JSONL theo record version + JSON summary trước; chưa chọn chia sẻ ra ngoài hoặc cloud. Chưa có decision_ref chốt O06 nên đề xuất chưa thành policy vận hành đã phê duyệt.

## 10. Checker offline và giới hạn

`node scripts/check-benchmark-protocol.mjs --self-test` kiểm invariant bằng fixture tổng hợp. `--bundle <json>` đọc một gói manifest/campaign/execution/previous/snapshot để đối chiếu cấu trúc/hash; không chạy crawler, không đọc credential và không thay gate. Khi audit, `claimed_valid_ids` là danh sách claim ngoài snapshot, phải là tập con membership; candidate chưa đủ bằng chứng vẫn được freeze nhưng không được claim valid. Checker chỉ kiểm tính nhất quán của claim, không đánh giá relevance hoặc thực hiện evaluator 1.000 bài. Output luôn ghi `execution_authorized: false`; người điều phối vẫn phải xác minh evidence và điều kiện nguồn thực.

Execution facts phải do host thực thi tạo, tách khỏi raw bài hoặc user payload; cùng một file JSON do người dùng chỉnh có thể tự khai gian cả hai phía, nên checker không là security boundary. Fixture self-test không chứa quyền, budget hoặc nguồn thật dù dùng giá trị giả để kiểm nhánh hợp lệ.

Phần còn thiếu trước live probe: session setup evidence, route-condition assessment, quyết định áp dụng budget/data policy, version/hash của probe host thực và manifest frozen. Kết quả search/pagination/1.000 bài **không** nằm trong danh sách điều kiện phải có trước probe.
