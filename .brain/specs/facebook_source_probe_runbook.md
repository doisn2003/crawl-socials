# Runbook Facebook source probe — sau login

> Cập nhật hiện hành v1.21: [ADR-010](../decisions/ADR-010-bounded-source-diagnostic.md) và [dispatch DOM diagnostic](../handoffs/lead-p02-dom-diagnostic-dispatch-2026-10-27.md) thay phần chờ khảo sát UI và điều kiện mọi diagnostic tự động phải sau G00 bên dưới. User đã xác nhận search có bài; không hỏi lại. Diagnostic kỹ thuật hẹp được triển khai và chạy sau code review, giữ platform permission UNKNOWN/benchmark OFF. Các mô tả implementation FIXTURE bên dưới là baseline trước thay đổi.

P02.02, cập nhật 2026-10-27 sau [dispatch của lead](../handoffs/lead-post-login-dispatch-2026-10-27.md), master v1.16. Áp dụng [protocol](benchmark_protocol.md), [ADR-008](../decisions/ADR-008-direction-and-source-validation.md), [ADR-009](../decisions/ADR-009-source-probe-operational-limits.md). Tài liệu này sửa trạng thái cũ; không thực hiện source probe hoặc thay gate.

## 1. Hiện trạng hiện hành và lịch sử

| Phần | Đã có | Chưa được chứng minh |
| --- | --- | --- |
| Phiên CSD | User xác nhận đăng nhập thành công; lead nghiệm thu [login render](../evidence/lead-p02-session-diagnostics-review-2026-10-27.md). Giữ PID10344/profile CSD Facebook đang mở | Persistence qua restart tiếp theo, binding account identity và search/posts chưa kiểm |
| Auth dependencies | Instagram XHR, fbsbx frame/resources và reCAPTCHA rendering đã sửa có context từ native owned Facebook view | Không suy mọi network đã thông; snapshot1854 events bị ring drop, không còn chuỗi provider complete |
| Observer P01.03 | Port, ownership/resolver, lifecycle, bounded capture, fixture/replay đã nghiệm thu | Chưa dùng để thu Facebook posts; BODY không là candidate |
| Controller P02.02 | Start/Stop/status/caps/deadline, freeze và writer đã nghiệm thu [offline](../evidence/lead-p02-controller-review-2026-10-27.md) | Main app gán driver=null; LIVE unavailable. Controller/status/manifest/writer còn FIXTURE cố định |
| Adapter/parser | SocialAdapter/PostCandidate contract và fake adapter có fixture tests | Chưa có Facebook search/continuation driver, parser/post/publicity/relevance evidence |

Các nhận xét “chưa login”, “observer/controller chưa có” trong preflight, assessment hoặc matrix cũ là snapshot lịch sử. Tình trạng session hiện lấy từ lead review/master; **không sửa những file đang pin chỉ để nâng readiness**. Điều kiện automated capture trong assessment vẫn chưa được giải quyết. Login không là permission hoặc search capability.

## 2. Giữ phiên đã đạt

Lượt chuẩn bị hiện tại không đóng/restart, tạo profile khác hoặc yêu cầu login lại. Không đọc cookie/token/password, tự thao tác auth/CAPTCHA, attach observer hoặc thu bài. Khi một lượt triển khai sau thật sự cần nạp build, lead điều phối graceful restart giữ profile; không dùng fixture/temp flags cho nguồn thật.

Lệnh đã dùng cho setup, chỉ tham khảo khi lead quyết định restart sau này:

~~~powershell
.\node_modules\.bin\electron.cmd . --allow-manual-facebook-login --csd-browser-policy-diagnostics
~~~

Diagnostics metadata ngoài repo ở %APPDATA%\csd-desktop\logs\browser-policy-diagnostics-v2.json; đó không phải output posts. Account binding vẫn UNVERIFIED, không đổi registry thành VERIFIED chỉ từ login. Không bắt kiểm persistence bằng restart ngay trước khảo sát đầu tiên.

## 3. Bước tiếp thực hiện được theo gate hiện tại

G00 vẫn NOT_EVALUATED. Bước nhỏ nhất đề nghị cho **lead quyết định**, chưa thực hiện trong lượt này: human tự làm một lượt tìm **cafe Hà Nội → Bài viết/Posts** trong cửa sổ CSD Facebook hiện có, observer/crawler tắt.

Đầu ra chỉ cần summary: có/không thấy tab Posts; có/không có card kết quả; UI label/locale; có control continuation nhìn thấy hay chưa quan sát. Không cần chép nội dung bài, tên tài khoản, credentials hoặc URL chứa query/token. Không bắt cuộn/truy cập thêm để tìm đủ nguồn. Không thấy Posts hoặc gặp auth/challenge thì ghi đúng điều kiện và dừng.

Đây là khảo sát UI do human thao tác, không phải automatic probe. Agent/CUA tự gõ/click hoặc phần mềm thu response sau cú click tay **không được đổi nhãn thành human-only**. Không hỏi lại Meta API/login; không chuyển sang provider trả phí.

## 4. Điều kiện trước source capture tự động

Lead cần tách ba nhóm còn thiếu:

1. **Điều kiện route:** assessment hiện chưa xác lập căn cứ/disposition cho automated browser collection trong use case; G00 chưa PASS. Quyền dùng phiên, budget approval và boolean từ renderer không thay điều kiện nguồn. Không yêu cầu có proof1000/search/paging trước phép thử nhằm đo chúng.
2. **Code live:** factory/commands/mode/filter/parser/writer chưa triển khai cho nguồn thật. Xem [readiness và vị trí cần đổi](../evidence/p02-post-login-readiness-2026-10-27.md).
3. **Dữ liệu quan sát:** chưa có Posts UI/entity/filter/response shape, identity/permalink/publication context, continuation hay source mix thực.

Chỉ sau quyết định route/gate phù hợp và bản live đã review mới Start collection; hiện không có command LIVE để chạy.

## 5. Lát cắt triển khai nhỏ nhất đề nghị sau khảo sát/gate

Giữ host/session/observer/controller đã có. Đề nghị một query cafe Hà Nội, một batch, tối đa5 candidates, tối đa5 phút và3 controlled actions; không retry/continuation ở lát cắt đầu. Đây là **đề xuất scope thấp hơn caps**, chưa là budget/run đã freeze hoặc capability đã có. Không SQLite, scheduler, dashboard, vendor hoặc host thứ hai.

- Quan sát UI thật trước khi chọn thao tác/response filter; không hard-code GraphQL/selectors/cursor từ suy đoán.
- Trusted main chọn route/mode và kiểm disposition/session evidence trước action; không nhận approval hoặc arbitrary URL/JS/cookie API từ renderer.
- Freeze query list, code/build/config/campaign/evidence refs mới; run ID/Start/deadline trước action đầu. Không chỉ đổi FIXTURE thành LIVE: driver/action port, controller read/status/manifest, freeze config, sanitizer và writer đều phải nối đúng.
- Chọn candidate fields theo PostCandidate contract và evidence quan sát được, giữ thiếu trường/source/publicity là UNKNOWN/UNVERIFIED. Không persist raw body mặc định hoặc lấy hash body thay sanitizer. Dữ liệu nguồn chỉ ở userData ngoài repo.
- Đạt kỹ thuật khi một action được account → một batch nguồn thật được chọn/parse bounded → output có version/hash/cutoff và Stop sạch. Valid count vẫn0 cho tới audit đủ bằng chứng. Không đòi cả ba loại nguồn hoặc1000 bài ở lát cắt đầu.

Phép thử rộng hơn mới đo continuation/source mix. End phải có evidence; timeout, lỗi parser hoặc batch không thêm candidate không tự là source exhausted. Không fake cursor/query filters.

## 6. Caps và Stop không reset

ADR-009 là trần probe:3 query quán cà phê/cafe Hà Nội/Tiny Cafe;30 phút từ Start gồm pause/sleep/retry;100 candidates;20 controlled collection actions;5 batch/query;50 MB records/evidence;600s operator;1 retry transient/batch;2 batch không tiến triển dừng nhánh; external cost0 VND. Không đổi target campaign1000/24h. Action khác HTTP request, BODY khác candidate.

Observer segment mặc định30s, tối đa60s; outer deadline/counters giữ nguyên qua segment/retry. Controller PoC hiện **không resume run cũ**, lần Start khác phải có ID/thư mục mới; không mô tả durable resume đã làm. Operator port có union ledger nhưng fixture khóa input, chưa đo attention ngoài app.

Auth/challenge/denied/schema/clock/coverage loss, đóng view/DevTools/suspend hoặc cap/deadline → ngăn action mới, dọn observer và freeze cutoff. Không đổi account/proxy hoặc tự vượt xác minh. Sửa renderer/network dependency có bằng chứng không là quyền thu bài.

## 7. Output đã có và khoảng còn thiếu

Writer hiện tạo diagnostic bundle dưới %APPDATA%\csd-desktop\source-probes\<run_id>:

~~~text
manifest.json / build-inputs.json / events.jsonl / observations.jsonl
evidence-map.json / snapshot.json / freeze.json / summary.json
~~~

Đã có path/byte guard, prewrite checks,1 MiB reserve nằm trong50 MiB cap, record versions/hashes, completion-time membership và cutoff; write muộn không vào snapshot. Policy refs chỉ pin path/hash, không có retained policy text copy. Sanitizer hiện chỉ metadata; không lưu text/ID/permalink/source evidence. Đây chưa là candidate/benchmark bundle.

Summary expiry7 ngày, cleanup thủ công, không scheduler xóa. Browser cache/profile nằm ngoài records cap. Trong .brain chỉ sanitized summaries/refs/hashes, không raw posts/response/auth data.

## 8. Lệnh offline hiện có — không chạy trong lượt tài liệu này

~~~powershell
node scripts/prepare-facebook-probe.mjs --output .brain/evidence/facebook_source_probe_preflight-next.json
npm run test:probe -- --output .brain/evidence/source-probe-fixture-next.json
node scripts/observer-debug.mjs --mode fixture --scenario query
~~~

Prepare script và preflight cũ chỉ là DRAFT/hashes tài liệu tại thời điểm chuẩn bị, không run ID hoặc frozen live manifest. Controller test dùng temp loopback và dọn dữ liệu sau kiểm; observer debug không là live crawler. Lead/build owner mới chạy khi cần, không cạnh tranh build/runtime.

Bước đang chờ quyết định là khảo sát Posts do human và disposition route; chưa cần thêm framework. [Readiness sau login](../evidence/p02-post-login-readiness-2026-10-27.md) phân loại blockers và tiêu chí lát cắt tiếp theo.
