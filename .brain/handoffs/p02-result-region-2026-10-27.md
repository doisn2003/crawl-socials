# P02 result-region diagnostic v2 — code ready

Ngày 2026-10-27, Asia/Bangkok. Theo [dispatch](lead-p02-result-region-dispatch-2026-10-27.md) sau [NO_MATCH có node truncation trên DOM thật](../evidence/p02-live-dom-structure-2026-10-27.md). Chỉ metadata; chưa extractor hoặc lần đọc LIVE mới. Old live report giữ nguyên.

## Thay đổi và cách đọc report

Schema script, `DomResult`, validator và report envelope cùng **version2**. Validator từ chối v1 và mọi key/value ngoài allowlist. Đổi đúng controller/script/fixture và owner test; không sửa index/menu/BrowserHost/policy/session/API hoặc scripts. Native menu/cờ/đường output giữ nguyên; lead duy nhất build/nạp và dùng lại search đang mở. Không restart runtime21432, không đọc source3278844, không ghi shared `dist`/`.test-build`.

- Trước walk: ba lookup barrier cố định, sau đó tối đa ba `querySelector` đầu tiên cho `main`, `[role=main]`, `[role=feed]`. Selector loại root nằm trong nav/aside/dialog/navigation/complementary hoặc hidden/aria-hidden ancestry. Ưu tiên main tag, rồi role main, rồi feed; thiếu thì fallback body. Không materialize NodeList hoặc quét innerText để chọn root.
- `root.kind`, `probes`, `candidates`, `cap=3`, `enumeration=FIRST_PER_SELECTOR`, `verified=false` mô tả lựa chọn. Candidates là số node khác nhau quan sát từ **first match của mỗi selector**, không phải tổng root trên trang. Main và feed lồng nhau có thể thành hai candidates; nhiều candidates không tự chứng minh nhiều vùng kết quả. Chưa xác nhận main đã chọn là kết quả tìm kiếm thật.
- Root và mọi node được TreeWalker kiểm đều chung cap2500; nav/aside/navigation/complementary/hidden subtree được prune, có count `pruned`. Không reset budget theo card/link. `scan=COMPLETE` chỉ hoàn tất vùng đã chọn sau pruning; `PARTIAL` đi với node/time flag; `NOT_SCANNED` khi chưa vào vùng; `BARRIER_STOP` khi barrier dừng giữa walk. Chưa bao giờ đồng nghĩa toàn trang hoặc toàn nguồn đã được quét.
- Tối đa5 `postLinkSamples`, mỗi mẫu tối đa8 ancestor từ parent của link, dừng ở selected root; tổng `ancestorSteps≤40`. Chỉ tag/role enums, child-count bucket, boolean presence của pagelet/aria-label và `atRoot`, kèm `depthLimit`. Không lấy values/href/ID/text/name/class/HTML. Không quét descendants lại theo ancestor; trường `ANCESTOR_DESCENDANTS_NOT_SCANNED` nói rõ thiếu phần này.
- Có article heuristic vẫn `HEURISTIC_MATCH`; chỉ có post-like link shape thì **`POST_LINK_STRUCTURE`**; không có cả hai thì `NO_MATCH`. Link count/samples không unique posts, không xác nhận Page/post/ad/publicity. Có `POST_LINKS_NOT_UNIQUE`, `RESULT_REGION_UNVERIFIED` cùng missing identity/text/source/publicity. Mixed route vẫn `SEARCH_TOP_MIXED`, không đổi thành Posts-only.
- Input password/OTP và reCAPTCHA có lookup cố định trước chọn root; các barrier gặp trong bounded walk vẫn dừng và xóa cả article/link samples. Dialog/alert subtree bên trong root được xem cho barrier nhưng không sinh card/link samples. Ba lookup đầu chỉ kiểm first matching node mỗi selector; không chứng minh toàn trang không có barrier khi không thấy. Partial walk cũng không chứng minh auth/challenge vắng mặt.

Các caps cũ giữ nguyên: 1 action, query/batch cố định, script1giây cooperative, main4giây elapsed/timeout, run5phút, tổng output32KiB, tối đa3 runs/process. Thêm limits tường minh cho root/barrier probes và ancestor depth/steps. Stop/suspend/owner change/late-result latch/mode separation không thay. Native selector/layout/serialization không hard-preempt từ JS; query count cố định không có nghĩa native selector chỉ duyệt2500 node nội bộ. Thời gian selector dùng chung deadline cooperative và main chỉ chấp nhận kết quả trong4giây.

## Kiểm chứng owner

```powershell
node scripts/facebook-dom-diagnostic-build.mjs
node --test .test-build-csd-dom/tests/facebook-dom-diagnostic.test.js
node scripts/facebook-dom-diagnostic-smoke.mjs --output .brain/evidence/p02-result-region-fixture-2026-10-27.json
```

Build riêng PASS; **14/14 unit tests PASS**, **3/3 native fixture cases PASS**. Summary [fixture JSON](../evidence/p02-result-region-fixture-2026-10-27.json), mode FIXTURE, external network0 theo protocol cục bộ, observer không attach, shutdown0 windows/0 WebContents. Không chạy hoặc sửa tests/output reviewer/lead.

Native HTML có2600 span chrome (hơn5200 element/text nodes) trước main. Case Posts chọn MAIN_TAG, dedupe main/role-main và quan sát feed thành2candidates, visited122/COMPLETE, 5 article samples. Case mixed chọn ROLE_MAIN, visited103/COMPLETE;8 post-like links trong deeply nested div không article, chỉ5 link samples/tổng40ancestor steps, đúng POST_LINK_STRUCTURE. Page/ad markup vẫn chỉ link family hints, không entity/public claim. Case password trả AUTH_REQUIRED trước root scan. Synthetic names/body/IDs/token không lọt output.

Fix review self-match đã áp dụng trước snapshot cuối: selector thêm `:not(nav):not(aside)` ngoài descendant exclusions; bước nhận candidate còn guard tag NAV/ASIDE/DIALOG, hidden và forbidden roles để root không bypass pruning do TreeWalker không xử lý filter trên chính root. Native chrome nay là `nav role=main`, kèm `aside role=feed` có post-like link riêng ở trước results. Main thực vẫn được chọn; mixed candidate count vẫn1 và post links vẫn8 (sidebar link không lọt vào root/samples). Unit cố tình trả NAV từ semantic lookup cũng bị guard loại và fallback body. Build/14unit/3native đã chạy lại PASS sau fix này; không đổi schema/caps/runtime hoặc scope.

Unit VM fixture riêng kiểm fixed script khi không có semantic root: BODY_FALLBACK + POST_LINK_STRUCTURE, và BODY_FALLBACK + NO_MATCH/PARTIAL sau cap2500. Validator tests reject v1, excessive probes, verified-root claim, depth9, samples6, steps41 và raw ancestor href. Maximum combined5article+5link×8ancestor payload vẫn ghi đủ hai file trong32KiB. Toàn bộ controller lifecycle/redaction/clock/timeout/mode/root-output checks trước vẫn PASS.

## Lead tiếp nhận

[Manifest snapshot](../evidence/p02-result-region-files-2026-10-27.json) hash source, compiled controller, fixed script string và toàn build cô lập. Copied `probe-build.json` chỉ metadata bootstrap từ shared build, không là freeze diagnostic mới. Lead review rồi build/nạp theo lifecycle; không đổi runtime khi chưa tiếp nhận snapshot.

Một lượt đọc thật tiếp theo cần trả lời: root.kind/candidates/scan/truncation có đưa walk vào vùng phù hợp hay chưa; ancestor level/tag/role/child-bucket nào có thể là ranh giới card. Nếu vẫn NO_MATCH/PARTIAL, giữ đúng thiếu quan sát thay vì kết luận không có bài. Định danh/text/publicity và public/ad/entity verification còn thiếu; extraction chưa được triển khai. Permission UNKNOWN, diagnostic-only, benchmark ineligible, candidates/valid count0, gate chưa thay.
