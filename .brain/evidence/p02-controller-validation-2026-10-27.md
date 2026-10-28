# P02.02 — Validation controller fixture

Ngày 2026-10-27, Asia/Bangkok. Theo [dispatch](../handoffs/p02-probe-controller-dispatch-2026-10-27.md), [ADR-009](../decisions/ADR-009-source-probe-operational-limits.md) và [review observer](lead-p01-observer-review-2026-10-27.md). Đây là phần controller offline để lead review; chưa hoàn tất phép thử Facebook, không đổi master hoặc gate.

## Hành vi đã có

- Dùng BrowserHost, view ownership và một observer manager/resolver hiện có. Manager dùng chung qua segments/runs để không reset native-promise capacity hoặc poison state. Không tạo crawler/host sản phẩm thứ hai; fixture server chỉ là nguồn tổng hợp loopback.
- Start tạo ID, wall/monotonic anchor, deadline, manifest FROZEN và build/input hashes trước action. Thời gian freeze/write nằm trong run. Counters actions/batches/candidates/bytes/operator không reset theo segment hoặc retry. 30 phút gồm mọi wait; drift >2s hoặc UTC lùi dừng CLOCK_UNCERTAIN. OS suspend dừng, không resume.
- Controller fixture dùng 3 query cố định, tối đa 5 batch/query, 20 controlled actions gồm navigation/retry, 1 retry transient/batch, 100 candidates nếu extractor được nối, 50 MiB persisted records/evidence, 600s operator và 0 VND external cost. Candidate cap và progress seam chỉ kiểm bằng injected extractor. Không có extractor Facebook nên candidates=null/UNKNOWN, ba source counts=null, relevance UNVERIFIED, valid=0. Không gọi BODY/CDP command là candidate/action. Không suy SOURCE_EXHAUSTED từ timeout hay batch rỗng; NO_PROGRESS chỉ khi injected parser xác nhận continuation lặp và không có candidate mới.
- Native observer window 30s ≤60s; outer deadline có thể kết thúc sớm hơn. Mỗi retry dùng generation mới, bỏ response chậm của attempt cũ. Attach lỗi không cho action fetch tiếp. Stop/race/close/DevTools/auth status/coverage loss ngăn action mới và dọn observer. Driver fixture khóa input keyboard/mouse; main chặn open/login lên profile đang chạy, close dừng trước. Navigation ngoài controller bị phát hiện và thu hồi driver. Không đo/cap toàn bộ HTTP từ Chromium.
- IPC exact config/Start(profileId)/Stop/status với sender/frame policy hiện có. Stop vô hiệu hóa Start đang await profile preflight. Không mode/LIVE/approved/URL/JS/cookie/budget/resume API. Phiên/manual login app thường luôn tách khỏi capture, liveAvailable=false.

## Persist và cutoff

Writer chỉ tạo run mới dưới CSD userData ngoài repo; kiểm resolved root, symlink/junction, existing redirected files và từ chối reuse thư mục run. File whitelist: manifest/build-inputs, observations/events JSONL, snapshot/evidence-map/freeze/summary. Kiểm bytes trước write, flush sync, dành 1 MiB cho finalization **trong** trần 50 MiB. Storage lỗi dừng collection; nếu finalization lỗi thì status WRITE_FAILED, không hứa có bundle hoàn chỉnh. Chromium cache/profile nằm ngoài cap này.

Sanitizer tạo object mới từ metadata allowlist: method GET/POST, HTTP status, MIME category, byte size, response-origin enum và timestamp. Không ghi body, body hash, URL, request headers/cookies/auth, nội dung text, JSON keys/shape hoặc unknown fields. Hash chỉ dùng cho records/artifacts đã chọn, không gọi hash raw body là sanitization. Raw bytes vẫn có thể nhạy cảm trong main memory; giới hạn native allocation của P01.03 vẫn áp dụng.

Record content version/hash giữ `write_started_at`; thời điểm hoàn tất write thật nằm tại frozen membership `persisted_at`. Chỉ observation có Start ≤ observed ≤ completion ≤ cutoff vào snapshot. Write hoàn tất sau deadline vẫn có thể tồn tại ngoài membership, không đếm. Snapshot khóa line/record version/hash và completion time; có membership/full snapshot digests và freeze.json giữ digest riêng. Đây là **diagnostic membership**, chưa có post identity/publicity evidence và không là valid-post snapshot.

Build tạo `dist/resources/probe-build.json`, gồm exact src/dist/package/build-script/fixture-script/policy input hashes. Host fixture đọc ở startup, kiểm lại tất cả file tại Start; source/build/config thay đổi thì từ chối. Effective config, canonical coffee campaign, source matrix, route assessment, runtime/driver/metadata/rubric versions được pin. Evidence map có refs/version/hash tới artifact trong run và policy input path/hash; policy text không được copy. Nếu repo policy sau này thay đổi, cần bản gốc khớp hash để resolve; không claim retained policy copy. Manifest v1 là diagnostic bundle, không giả bundle đủ điều kiện cho benchmark checker.

Summary expiry = stopped_at +7 ngày, `MANUAL_REQUIRED_NO_SCHEDULER`. Harness dùng temp root ngoài repo và xóa sau kiểm; `.brain` chỉ giữ sanitized report/ảnh/hashes. Không có automatic retention hoặc resume run sau process interruption. Run bị ngắt giữ manifest chưa có summary; lần chạy sau chỉ được ID/thư mục mới, không sửa run cũ.

## Kiểm đã thực hiện

| Kiểm | Kết quả |
| --- | --- |
| `npm run check` | PASS main/preload/renderer/tests +44 contract |
| `npm test` | PASS toàn suite hiện có; 89 unit gồm 53 baseline, 16 intent do owner khác, 20 controller/freeze của đợt này; +44 contract |
| Unit controller/freeze riêng | 20/20 PASS: duplicate Start, Stop race/hanging wait, deadline qua segments, clock drift, action/batch/candidate caps, retry/timeout, progress UNKNOWN, malformed/mode/secret payload, auth/challenge/DevTools/close/suspend, operator intervals, storage/cutoff/path/reuse, exact IPC, freeze drift và live unavailable |
| [Electron controller](p02-controller-smoke-2026-10-27.json) | PASS 2 process/9 nhóm; 3 query ×5 batch; 16 actions/15 diagnostics, 0 valid; real UI/IPC Start/Stop, pending Start cancellation, DevTools, unexpected navigation, close, abrupt process kill/restart; cleanup 0 window/webContents |
| [Ảnh UI](p02-controller-ui-2026-10-27.png) | Đã xem: STOPPED/COMPLETED_FIXTURE, 16/20 actions, 5/5/5 batch, 15 diagnostics, UNKNOWN candidates/sources, valid=0 |
| [Session regression](p02-controller-session-regression-2026-10-27.json) | PASS 3 process/13 nhóm |
| [Bootstrap regression](p02-controller-bootstrap-regression-2026-10-27.json) | PASS 2 lượt, bridge thêm probe, sandbox/network policy giữ đúng |
| [Observer regression](p02-controller-observer-regression-2026-10-27.json) | PASS 9 nhóm/10 response FIXTURE, 0 valid |
| [Command record](p02-controller-checks-2026-10-27.json) | Exit codes và số test đọc từ command output; kiểm observer CLI malformed-input redaction |

Smoke coverage phát hiện detach debugger đồng bộ ngay trong native navigation callback có thể làm Electron exit bất thường. Driver hiện thu hồi quyền action ngay, defer lifecycle callback tới lượt event loop kế tiếp và cho lifecycle reason thắng incidental promise rejection. Ca navigation và DevTools thật sau sửa đạt. Có một observer regression đầu báo fixed OBSERVER_DEBUG_FAILED mà wrapper cũ không giữ chi tiết; lần chạy lại với safe diagnostic codes đạt, không đổi transport engine. Không gọi lần lỗi thiếu chi tiết đó là root cause đã biết. CLI observer hiện chỉ bổ sung fixed native-check codes, malformed JSON vẫn không echo input.

## Phần thực còn thiếu

1. Driver Facebook search/posts/paging/entity/filter/cursor thực: NOT_IMPLEMENTED. Fixture fetch numeric indices không chứng minh query UI hoặc endpoint Facebook. Không hard-code GraphQL/selectors từ suy đoán.
2. Parser, post identity/publicity/relevance/source-type evidence, challenge/login HTML detection và source-end/progress thực: NOT_IMPLEMENTED. HTTP 401/403 và trusted lifecycle/challenge signal có stop path; chưa nhận diện challenge Facebook qua body chưa quan sát.
3. Disposition route/điều kiện automation và session setup evidence: lead xử lý theo [assessment](facebook-browser-route-assessment-2026-10-27.md). User chỉ có account thường, chưa có Meta grant. Không tạo boolean thay bằng chứng và không hỏi lại câu đã trả lời.
4. Công cụ hiện là offline smoke tự động, không có live command hoặc màn hình vận hành Facebook. Sau review cần nối source driver/parser đã quan sát vào host hiện có, pin phiên bản mới và evidence thực. Operator ledger có API main-only đã inject-test; fixture khóa mọi can thiệp trang, chưa đo thời gian attention người dùng. Không quảng cáo 600s như đo hành vi ngoài CSD.
5. PoC từ chối resume, retention cleanup còn thủ công. Chưa benchmark 1.000/24h, live search/paging/yield, release/portable hoặc source gate.

Xem [handoff](../handoffs/csd-probe-controller-p0202-2026-10-27.md) và [owned-file hashes](p02-controller-source-manifest-2026-10-27.json). dist/.test-build/build chính trả khi bàn giao; không tự bắt đầu task khác.
