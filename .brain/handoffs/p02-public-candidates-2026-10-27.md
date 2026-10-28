# P02 public-candidate probe — code ready

Ngày 2026-10-27, Asia/Bangkok. Theo [dispatch](lead-p02-public-candidates-dispatch-2026-10-27.md) và [evidence v2 sau public filter](../evidence/p02-live-result-region-2026-10-27.md). Đây là implementation để lead review/nạp/chạy một read; worker chưa đọc nguồn thật hoặc đụng runtime1632/source2362756/shared dist. Permission UNKNOWN, diagnostic-only, benchmark OFF, verified valid count0.

## Điểm kích hoạt và output

Cờ native `--csd-facebook-dom-diagnostic` giữ nguyên. Menu **Chẩn đoán Posts** có thêm **Trích tối đa 5 ứng viên công khai: <phiên>**, gọi `startCandidates` trong trusted main/owned isolated world1004. Không có evaluate/URL/content IPC. Metadata v2 và mục **Đọc một lần** giữ riêng. **Dừng DOM diagnostic**, suspend và quit dừng cả hai đường; mutex/native-pending latch và cap3 starts/process dùng chung giữa metadata/candidates.

Lead duy nhất build/nạp theo lifecycle sau review. Không tự điều hướng, đổi filter, Xem thêm, hover, scroll, retry, endpoint hoặc capture network. Chỉ exact `/search/top`/`posts` (có thể có slash cuối), HTTPS Facebook và query cafe Hà Nội cố định. Bộ lọc không được dùng làm bằng chứng public trong code.

Candidate schema1 khác metadata schema2. Output local:

`%APPDATA%\csd-desktop\public-candidate-diagnostics\candidate-<UUID>\`

- `started.json`: run/mode/time/limits/hashes, không content.
- `candidates.json`: payload duy nhất có text/canonical permalink/ID; tối đa5 samples, mỗi snippet≤800chars, tổng≤4000chars. Missing ID/permalink là null; source_type UNKNOWN, boundary_verified=false, missing_fields tường minh.
- `summary.json`: enum/count/rejection reasons/hash của candidate file, missing-field counts; không samples/body/permalink/author/profile/query/token. Controller/menu chỉ trả summary/path/hash, không trả samples. `.brain` chỉ summary fixture/hash.

Cả ba file tổng≤32KiB, exclusive `wx`, containment/canonical/symlink checks; retention7ngày/manual cleanup. Một read/action, script1giây cooperative, global2500nodes, tối đa12 feed children xét, main4giây elapsed/timeout, run5phút. Stop/clock/owner/route change/late result bỏ payload; native read chưa settle giữ capacity. LIVE chỉ trusted main normal diagnostic flag; candidate fixture riêng luôn FIXTURE, không được kết hợp LIVE/smoke khác.

## Boundary/publicity/body/identity contract

Script chọn semantic main/feed bằng các fixed lookups, rồi xét từng direct feed child. Không dùng toàn feed làm candidate; không mượn public badge của nested article. Header zone tối đa6mức, trước message marker đầu tiên; cần1–2 heading cùng temporal signal và semantic public label trực tiếp. Restricted/conflicting labels, sponsored/Page suggestion, nhiều message regions/headings/IDs hoặc boundary không hoàn tất đều bị loại, chỉ giữ rejection enum. Nested article/comment, hidden/navigation/dialog và control text không sinh post body; overlay chưa nhận dạng dừng toàn run. Header/publicity vẫn heuristic, chưa independent verification hoặc relevance review.

Sau review: negative restricted/ad signal của chính outer boundary được xét cả **sau body**, kể cả footer; public eligibility vẫn chỉ ở header zone. Embedded/comment vẫn bị prune trước khi xét signal. Boundary có nhiều message regions/IDs được báo AMBIGUOUS_BOUNDARY trước các lý do publicity để không che việc gộp nhiều post.

Chỉ ba semantic message markers thử nghiệm (`data-ad-preview=message`, `data-ad-comet-preview=message`, `data-ad-rendering-role=story_message`) được đọc thành body; chưa quan sát marker nào trên nguồn thật. Header/comment/ad/embedded text không thay body. Không marker/không text hiển thị =>text null + reason; không dùng fallback innerText của toàn card. Multiple markers, kể cả nested, bị loại để không gộp nội dung. Snippet là CSS-rendered DOM, chưa xác minh viewport/occlusion hoặc full text. Phone/email/link/@mention và một số secret-like patterns được redact; đây là pattern redaction, không bảo đảm nhận diện mọi contact format/ngôn ngữ. Không thu riêng author/commenter/contact fields.

Chỉ canonical post paths/`story_fbid+id` thật có trong header DOM mới thành identity. ID giữ string (gồm số dài/pfbid), query/tracking bị bỏ; group link/profile ID/photo ID không thành post ID. Canonical group permalink/post và story/permalink aliases dedup theo post ID; không tạo ID từ text/hash/order. Thiếu permalink vẫn có thể giữ public-signal sample chưa xác minh, valid/unique count0. Không suy source type từ group link hoặc infer PUBLIC từ sidebar filter.

Nếu nguồn không có feed child/header/temporal/public/message/permalink theo các shape này, code trả rejection/missing reasons; chưa claim parser đã đúng Facebook. Native query/layout/serialization không hard-preempt từ JS; fixed query counts và global cooperative deadline không là native internal node cap. Chưa có fallback extractor hoặc mở rộng capability.

## Files và kiểm chứng

Mới: `facebook-public-candidate-{fields,script,fixture}.ts`, `facebook-public-candidate.ts`, owner test và smoke script. Sửa tối thiểu index/menu/fixture-mode guard/build include. Không đổi old metadata script/schema, BrowserHost, policy/session, renderer/shared API, package/master/README/ADR hoặc reviewer files.

```powershell
node scripts/facebook-dom-diagnostic-build.mjs
node --test .test-build-csd-dom/tests/facebook-dom-diagnostic.test.js .test-build-csd-dom/tests/facebook-public-candidate.test.js
node scripts/facebook-public-candidate-smoke.mjs --output .brain/evidence/p02-public-candidates-fixture-2026-10-27.json
node scripts/facebook-dom-diagnostic-smoke.mjs --output .brain/evidence/p02-public-candidates-metadata-regression-2026-10-27.json
```

Build riêng PASS; **22/22 unit tests** (14 metadata +8 candidate) PASS; **3 native candidate +3 native metadata cases PASS**, external0 theo protocol cục bộ, shutdown0 windows/0 WebContents. Candidate fixture UTF-8 chứa outer private/unknown +inner public, outer public +inner restricted, Page/ad/comment, canonical alias, long ID, identity missing, header/embedded-only body missing và contact redaction. Giữ5samples/1identity missing/1text missing, loại duplicate. Partial boundary2500nodes không lưu snippet; password dừng. Unit kiểm writer byte cap, containment, strict validator, real timeout, delayed-clock timeout, Stop/owner-loss và payload không lọt summary/late output.

Hai finding reviewer đã sửa trước snapshot cuối: footer Friends/Sponsored không còn bị bỏ qua do header đóng; number redaction nhận whitespace/newline từ text-node splits ở bước ghép snippet cuối, và `contacts_redacted` phản ánh thay đổi cuối này. Native fixture đưa Friends/Sponsored xuống footer và số090/123/4567 vào ba span để xác nhận thực tế qua Electron.

Theo dispatch follow-up của lead, owner compile **read-only** `tests/facebook-public-candidate-review.test.ts` vào `.test-build-csd-dom/reviewer` rồi chạy cùng owner tests: **30/30 PASS** (22 owner +8 reviewer), không sửa reviewer test hoặc output `.test-build-adapter-candidate`. Hai native suites được chạy lại sau fix:3+3 PASS. Lệnh compile review dùng cùng strict flags/NodeNext như repository; không thay build script để nhận ownership reviewer test.

Evidence: [candidate fixture](../evidence/p02-public-candidates-fixture-2026-10-27.json), [metadata regression](../evidence/p02-public-candidates-metadata-regression-2026-10-27.json), [manifest](../evidence/p02-public-candidates-files-2026-10-27.json). Manifest ghi fixed script hash (gồm embedded canonical/redaction functions), controller-module hash scope rõ và toàn isolated build. Copied probe-build metadata vẫn chỉ phục vụ bootstrap, không thay freeze của probe này. Lead còn nghiệm thu final hashes/host/runtime; snapshot sau fix đã ổn định để nạp, không thêm capability.
