# Kiểm chứng triển khai P01.03 — 2026-10-27

Múi giờ Asia/Bangkok. Theo [giao việc observer](../handoffs/p01-observer-dispatch-2026-10-27.md), sau [lead nghiệm thu P01.02](lead-p01-session-review-2026-10-27.md). Agent triển khai không sửa master plan/`.brain/README.md`, không tự nhận DONE hoặc PASS gate. Bản này bàn giao source, kết quả và giới hạn để lead nghiệm thu.

## Phạm vi thực hiện

Port `application/ports/response-observer.ts` không import Electron hoặc social-adapter/parser contracts. Engine tại `infrastructure/browser/response-observer.ts` xử lý request/response correlation, body transport và lifecycle. Driver Electron, driver replay và replay fixture loader tách riêng. Browser host chỉ được bổ sung `viewGeneration` và `observerTarget(profileId)` main-only; main thêm nhánh CLI/harness temp, không sửa bridge/renderer hoặc mở response-body API cho website.

Không có parser Facebook, URL/GraphQL schema giả định, source probe, account pool, scheduler/DB hoặc dependency mới. Package chỉ thêm `test:observer`/`debug:observer`; package-lock không đổi. Không sửa file adapter P02.01 hay protocol P00.04. Giới hạn của observer là giới hạn transport, không phải các caps source probe đã được lead chọn tại [ADR-009](../decisions/ADR-009-source-probe-operational-limits.md).

## Ownership và lifecycle

Attach dùng profile ID, webContents ID và view generation do browser host cấp. `createOwnedObserverResolver(host)` cache driver theo webContents và chỉ resolve target đang thuộc host; UI, profile khác hoặc generation cũ không được nhận. Handle gắn capture mode từ trusted main, không lấy mode từ body/replay payload. Attach cùng owner idempotent; debugger đang do người khác giữ hoặc DevTools đang mở bị từ chối, không detach để chiếm.

Mỗi document/capture có generation riêng. Main-frame navigation/reload, suspend, stop và owner change hủy pending records/timers/own command awaits và bỏ unread body queue cũ kèm drop reasons. Native promise muộn chỉ có thể giải phóng capacity, không được giao body sang generation/owner mới. Read kiểm lại owner trước khi lấy queue; stop chạy đua với resume không được làm debugger sống lại. Đóng/destroy view hoặc debugger detach là terminal; reopen cần context mới từ host. Suspend chỉ dừng observer, không đình chỉ network/view của browser hoặc thay deadline run. Same-document navigation không tự đổi query context; application sau này phải quản lý query/access context.

DevTools thực được mở trong WebContents riêng của một BrowserWindow ẩn, permission/network policy riêng chỉ cho internal DevTools resources; không bật cửa sổ trên desktop. Cấu hình thử ban đầu cho thấy Electron 44.7.0 có thể giữ debugger client khi embedded DevTools mở, nên implementation **không dựa vào giả định tự detach**. Policy chủ động dừng bằng DEVTOOLS_OPENED nếu detach native chưa xảy ra, cleanup owned client, từ chối attach khi tools còn mở. [Report cuối](p01-observer-smoke-2026-10-27.json) ghi terminal code DEVTOOLS_OPENED. Đây là hành vi của cấu hình hidden custom DevTools đã thử, không là kết luận về mọi cấu hình runtime. [Electron Debugger](https://www.electronjs.org/docs/latest/api/debugger) là primary reference cho attach/detach/command và cảnh báo lệnh trước navigation đầu tiên có thể chờ.

## Transport, kết quả và dữ liệu nhạy cảm

- Chỉ request GET/POST, resource Fetch/XHR, URL filter do main cấp. Default MIME JSON/text; fixture Electron thêm octet-stream để kiểm binary. Redirected request/child target/nonmatching resource có filter counts, không giả thành capture.
- Chờ responseReceived và loadingFinished tương ứng rồi mới đọc body; hỗ trợ UTF-8/base64/empty. Empty body hợp lệ là BODY với 0 byte, không là body-unreadable. HTTP status và cache/service-worker hints được giữ; BODY 403 hoặc JSON 200 không chứng minh bài hợp lệ hay auth thành công. Origin là metadata CDP, không phải bằng chứng quyền/freshness.
- NETWORK_FAILED, REQUEST_TIMEOUT, BODY_UNREADABLE, BODY_DECODE_FAILED, RESPONSE_MISMATCH/INVALID, COMMAND_TIMEOUT, detach, owner change và các limits là mã cố định. MIME/resource bị lọc chỉ có counts; read TIMEOUT khác END, không đồng nghĩa hết kết quả nguồn.
- Không thu request/response headers, cookies, POST data mặc định. URL chỉ dùng filter và fingerprint nội bộ để correlation, không đưa ra event metadata/log. Body bytes thô chỉ nằm trong main memory và có thể nhạy cảm; callback downstream tương lai phải áp dụng policy dữ liệu trước khi lưu/xuất.
- CLI/report chỉ có sizes, hash decoded bytes, status, mode và counts/mã lỗi; không xuất body, raw URL/query/header/cookie hoặc native exception. Hash phản ánh bytes CDP đã trả/được decode, không khẳng định raw wire fidelity. Replay sai JSON trả mã lỗi cố định, không dump đoạn input trong SyntaxError; [negative logging check](p01-observer-redaction-2026-10-27.json).

Theo [CDP Network reference](https://chromedevtools.github.io/devtools-protocol/tot/Network/), Network.enable buffer hints và getResponseBody là các phần khác nhau. CSD kiểm thêm encoded length, string length và decoded bytes; không coi hints là bảo đảm allocation tuyệt đối.

## Giới hạn hữu hạn

Default mỗi observer: 32 pending requests, 2 body commands, 128 KiB/body, 512 KiB queue bytes, 32 results (reserve terminal), 100 accepted captures, 2 MiB tổng decoded bytes/run, command timeout 2s, request timeout 10s, run 30s. Manager tối đa 4 observers, tối đa 12 native promises chưa settle. Factory giới hạn run segment ≤60s; elapsed monotonic giữ nguyên qua suspend/resume. Actual smoke giảm run xuống 20s và request timeout 3s; replay dùng run 2s.

Queue overflow hoặc fatal limit dừng với terminal error thay vì trả mảng rỗng. Cancel/navigation/stop bỏ unread bodies và báo drop counts; caller phải drain kịp thời. Body too large loại record và báo lỗi riêng. Bộ đếm transport không phải unique posts/candidates hoặc số network actions của source probe.

JS cancellation không abort được promise native CDP. Capacity được giữ tới lúc promise thực settle, kể cả đã hủy await; hết capacity phải dừng. Body command timeout detach/poison target, không cho lặp attach vào cùng target để nhân promise treo; cần view mới. Native body string/event object có thể đã được runtime cấp phát trước khi JS kiểm; buffer hints và post-decode guards không là hard heap/process memory limit. Không có cam kết hard real-time khi event loop bị block hoặc OS ngủ; không thay deadline campaign P07/P08.

## Kiểm chứng đã chạy

| Lệnh/phạm vi | Kết quả |
| --- | --- |
| `npm run check` | PASS main/preload/renderer/tests và 44 contract P00 |
| `npm test` tích hợp | **53/53 unit PASS**: 35 baseline + 18 observer; 44 contract PASS |
| Observer unit riêng sau hardening cuối | **18/18 PASS**: empty/Unicode/base64, ownership/stale queue/body, attach/bind cleanup, concurrent read, native rejection/timeout/capacity, limits, filters, deadline qua suspend và stop/resume race |
| `npm run test:observer -- --output ...` | Electron thực **9 nhóm kiểm, 10 response fixture**, 0 window/webContents sau cleanup; [smoke report](p01-observer-smoke-2026-10-27.json) |
| `debug:observer --mode fixture --scenario query` | Một query local, một capture FIXTURE, 0 valid posts; [query report](p01-observer-query-2026-10-27.json) |
| `debug:observer --mode replay` | Ba capture REPLAY gồm empty/base64, payload khai LIVE không đổi provenance, 0 valid posts; [replay report](p01-observer-replay-2026-10-27.json) |
| Invalid replay subprocess | Exit 1, stdout rỗng, stderr chỉ OBSERVER_DEBUG_FAILED, không chứa input; [report](p01-observer-redaction-2026-10-27.json) |
| Session regression vì sửa host generation | **3 process/13 nhóm kiểm PASS**; [report mới](p01-observer-session-regression-2026-10-27.json) |
| Bootstrap regression vì sửa main | **2 lượt PASS**; [report](p01-observer-bootstrap-regression-2026-10-27.json), [ảnh](p01-observer-bootstrap-regression-2026-10-27.png) |

Electron thật chứng minh: correlated JSON/empty/binary/POST/non-2xx, profile isolation, reload pending, suspend/resume, oversized/network-abort response, external detach pending, hidden DevTools policy, close pending + reopen generation. Không dùng mock làm bằng chứng những hành vi này.

Injection/replay chứng minh các lỗi khó tái tạo: native getResponseBody reject/hang, partial listener bind failure, invalid base64/protocol envelope, strict queue/byte/count/capacity faults và race resume-stop. Native promises không settle được giữ trong accounting khi cancel/navigation, không giả báo đã abort. Không gọi các lỗi inject là Facebook errors đã quan sát thật.

## Interface để lead/source-probe owner tích hợp sau review

1. Dùng BrowserHost hiện có, await mở/warmup owned view; lấy `{profileId, webContentsId, viewGeneration}` từ `observerTarget`. Không tạo host thứ hai hoặc attach UI. Cache resolver một lần bằng `createOwnedObserverResolver(host)` rồi cấp cho manager.
2. Main cấp URL/MIME/resource filters và limits phù hợp từng segment; `attach(owner, mode)` trả handle với read/snapshot/suspend/resume/stop. Drain STATE/ERROR/BODY; chỉ parser/validator phía sau mới đánh giá bài/source. Raw body không được xuất sang UI hoặc `.brain`.
3. Close/destroy/detach/DevTools là terminal, lấy owner mới nếu reopen; không tự chiếm debugger hoặc resume một target đã timeout. `stopAll()` dọn các captures trước host shutdown.
4. Outer P02.02 runner phải giữ deadline/budget/stop/redaction/output của ADR-009 độc lập; không reset outer run khi tạo segment ≤60s. 100 response transport không là 100 candidates, CDP commands không là controlled collection actions, và observer không giới hạn mọi HTTP request browser phát sinh.
5. Không dùng fixture flags/openFixture/replay để chạy live hoặc coi type LIVE là quyền nguồn. Source preflight/G00, phiên thật và policy lưu/xuất còn thuộc review/runner sau này. Task này không thực hiện tích hợp live hoặc P02.02 host.

## Bàn giao và giới hạn còn lại

[Handoff](../handoffs/csd-observer-p0103-2026-10-27.md), [SHA-256 manifest](p01-observer-source-manifest-2026-10-27.json). Manifest chỉ hash file thuộc đợt này; không ghi đè bằng chứng session/lead cũ, master plan hoặc file adapter/protocol do owner khác sửa.

Không Facebook live/login/parser, không benchmark/candidate/unique-post evidence, không source permission claim. Không thêm UI lớn/Crawlee/Apify/DB/account pool; không thử packaged executable/Windows sạch. Automatic OS power lifecycle/scheduler không có trong P01.03; explicit observer suspend và target-close đã được kiểm. Không tự PASS gate hoặc nhận thêm task khi bàn giao.
