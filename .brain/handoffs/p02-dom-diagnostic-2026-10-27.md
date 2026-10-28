# P02.02 — Bàn giao đường chẩn đoán DOM native

Ngày 2026-10-27, Asia/Bangkok. CSD agent triển khai theo [dispatch](lead-p02-dom-diagnostic-dispatch-2026-10-27.md) và [ADR-010](../decisions/ADR-010-bounded-source-diagnostic.md). Đây là bàn giao implementation/fixture để lead nghiệm thu; chưa chạy DOM trên phiên Facebook thật, chưa thay task hoặc gate.

## Kết quả và phạm vi file

Đã có điểm kích hoạt trong native CSD: menu **Chẩn đoán Posts**, chọn **Đọc một lần: <phiên đang mở>**, cùng **Dừng DOM diagnostic**. Main chỉ chạy script cố định trong isolated world 1004 của owned WebContents; không có IPC evaluate hoặc script/URL do renderer cung cấp.

- `src/main/index.ts`: cờ opt-in, native menu, refresh sau thao tác profile, Stop khi suspend/quit và nhánh fixture cô lập.
- `src/main/facebook-dom-diagnostic.ts`: route/mode guard, controller, validator và writer ngoài repo.
- `src/main/facebook-dom-diagnostic-script.ts`: script đọc cấu trúc cố định, không điều hướng/click/scroll/fetch.
- `src/main/facebook-dom-diagnostic-menu.ts`: menu và adapter sử dụng `observerTarget` hiện có.
- `src/main/facebook-dom-diagnostic-fixture.ts`: ba ca DOM giả trong Electron bằng protocol handler cục bộ.
- `tests/facebook-dom-diagnostic.test.ts` và hai script `scripts/facebook-dom-diagnostic-{build,smoke}.mjs`.

Không sửa BrowserHost/policy/session, renderer/preload/shared API, package/README/master/ADR hoặc file reviewer. Không ghi shared `dist`/`.test-build`, không khởi động lại hoặc thao tác phiên thật. Build riêng chỉ đọc renderer/preload/resources hiện có trong `dist` để tạo app fixture chạy được.

## Lead kích hoạt sau nghiệm thu

Lead duy nhất nạp build và chuyển phiên theo lifecycle giữ session. Agent triển khai chưa chạy lệnh LIVE dưới đây. Từ workspace, sau khi lead đã đóng app cũ theo lifecycle:

```powershell
& .\node_modules\electron\dist\electron.exe .build-csd-dom --allow-manual-facebook-login --csd-facebook-dom-diagnostic
```

1. Dùng lại profile CSD Facebook đã có. Menu không tự mở profile, tìm kiếm, đổi filter hay nạp trang. Điểm đọc chỉ nhận owned view đang ở đúng `/search/posts` hoặc `/search/posts/`, HTTPS Facebook, duy nhất một tham số `q` chuẩn hóa thành `cafe Hà Nội`.
2. Trên cửa sổ CSD chính, nhấn Alt nếu menu đang ẩn, mở **Chẩn đoán Posts**. Danh sách tự refresh sau thao tác profile; có mục **Làm mới danh sách phiên**. Chọn **Đọc một lần: <label phiên>**. Đây là một controlled action đọc DOM.
3. Xem trạng thái cuối trong menu và `result.json` mới nhất tại `%APPDATA%\csd-desktop\dom-diagnostics\dom-<UUID>\`. Có `started.json` ghi trước thao tác. Khi cần dừng, chọn **Dừng DOM diagnostic**; không retry tự động. Tối đa ba lần start mỗi process, một native read tại một thời điểm.
4. Lead chỉ lưu summary/hash đã lọc vào `.brain`. Chưa lấy bài thật trong bước này; lựa chọn parser và extraction tối đa 5 public candidates là bước sau khi có cấu trúc thật được review.

Route khác, kể cả `/search/top`, `/search/people`, `/search/groups` hoặc `/search/pages`, bị từ chối trước đọc. Nếu URL thực tế chưa đúng scope thì giữ kết quả `UNSUPPORTED_ROUTE`; không suy người dùng tìm sai entity từ ảnh hoặc tự mở rộng route. Chưa có cơ chế xác nhận selected Posts tab cho route khác.

## Giới hạn và provenance

Một read, một query/batch; tối đa 2.500 node, 5 mẫu cấu trúc, cooperative script budget 1 giây, main timeout 4 giây, hard run budget 5 phút, tổng hai file ≤32 KiB. Main kiểm elapsed trước native read và sau await, kể cả timer bị trễ. Stop, suspend, main navigation, in-page navigation, destroyed/render-process-gone, devtools-opened và thay owned generation đều chặn nhận kết quả. Nếu native promise chưa settle sau Stop/timeout, giữ capacity để không tích lũy read; kết quả muộn không ghi đè report cuối.

Main dựng lại payload từ whitelist: enums/counts/buckets, link families và hint counts. Không trả hoặc lưu text/HTML, tên người, URL/query/token, profile ID/label, cookies/headers/postdata hoặc DOM dump. Writer tạo run directory mới, `wx`, kiểm canonical root ngoài repo và symlink; retention local-only tối đa bảy ngày, **manual cleanup required**, chưa có scheduler xóa tự động.

Report ghi `capture_mode=LIVE` chỉ từ cờ native diagnostic riêng; không cho kết hợp cờ này với fixture hoặc smoke. Fixture luôn `FIXTURE`. Có run/time, code hash của compiled controller với scope khai báo rõ `DOM_CONTROLLER_MODULE`, script string hash riêng, `diagnostic_only=true`, `benchmark_eligible=false`, `platform_permission=UNKNOWN`, `verified_valid_count=0`, `candidates_collected=0`. SHA-256 trả về cho fixture/lead là hash **đúng bytes result.json trên đĩa**, gồm định dạng và newline. Manifest đi kèm hash toàn build cô lập để kiểm phần integration ngoài scope controller hash.

Heuristic `article`/`role=article` và label công khai còn thử nghiệm, chưa quan sát trên DOM Facebook thật. `HEURISTIC_MATCH` chỉ nghĩa khớp cấu trúc, không xác nhận bài/publicity/source type. `NO_MATCH` không có nghĩa nguồn cạn. Node/time truncation được ghi rõ; count có thể gồm DOM ẩn bởi CSS/ancestor. Script không đi shadow DOM/iframe con, không lấy định danh/text/timestamp thật. Hints public/restricted không chuyển record sang PUBLIC. Không có post được tính hợp lệ.

Budget trong renderer là cooperative giữa các node. Native DOM/layout, Electron serialization và OS file I/O không thể hard-preempt từ JS; main timer và elapsed guard giới hạn nhận kết quả, native-pending latch giới hạn số read, chưa chứng minh renderer trên DOM thật luôn hoàn tất dưới một giây. Không claim thử fixture đã kiểm hiệu năng nguồn thật.

## Kiểm chứng và review

```powershell
node scripts/facebook-dom-diagnostic-build.mjs
node --test .test-build-csd-dom/tests/facebook-dom-diagnostic.test.js
node scripts/facebook-dom-diagnostic-smoke.mjs --output .brain/evidence/p02-dom-diagnostic-fixture-2026-10-27.json
```

Build PASS; **10 unit tests PASS**; **3 native fixture cases PASS**, external network 0 theo protocol cục bộ, observer không attach, đóng sạch 0 window/0 WebContents. Test bao gồm route, mode separation, validation/redaction, exact-file hash, Stop, owner loss, timer thật 4 giây, injected late/backward clocks, late-result discard, process cap và output root. Fixture đi cùng native menu/adapter/isolated-world path; gọi cùng main handler của menu, không mô phỏng một click UI menu.

Đã sửa bốn finding lead yêu cầu: exact Posts route ở main/script, elapsed ≥readMs sau await, Stop khi suspend, và reject tổ hợp LIVE/smoke. [Review script độc lập](../evidence/adapter-p02-dom-diagnostic-review-2026-10-27.md) ghi 5/5 regression PASS và không còn blocker trong scope script/schema; agent này không chạy/sửa test hoặc output reviewer. Lead xác nhận đã kiểm lại fix, compile riêng `.test-build-lead-dom`, 15/15 tests PASS (10 owner + 5 reviewer), và native smoke 3 cases PASS; evidence riêng do lead sở hữu. Lead đối chiếu manifest rồi build/nạp và quyết định thời điểm đọc thật. Owner chốt snapshot này, không sửa source tiếp khi chưa có finding mới.

Evidence: [validation](../evidence/p02-dom-diagnostic-validation-2026-10-27.md), [native fixture summary](../evidence/p02-dom-diagnostic-fixture-2026-10-27.json), [file/build manifest](../evidence/p02-dom-diagnostic-files-2026-10-27.json). `probe-build.json` được copy vào build cô lập để giữ bootstrap; đó là metadata baseline cũ, không được dùng làm freeze mới cho diagnostic LIVE.
