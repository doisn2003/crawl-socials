# P02 header temporal v5 — code ready

Ngày2026-10-27, Asia/Bangkok. Theo [dispatch](lead-p02-header-temporal-dispatch-2026-10-27.md) sau [LIVE v4 NO_TEMPORAL](../evidence/p02-live-overlay-v4-2026-10-27.md). Worker không đọc nguồn, restart runtime2460/source6492758 hoặc ghi shared dist. Chưa biết shape timestamp thật, không khẳng định fixtures là DOM Facebook. Permission UNKNOWN/benchmark OFF/valid0 và gates giữ nguyên.

Candidate script/result/validator/writer cùng **schema5**. Metadata diagnostic cũ, native LIVE trigger và đường payload local giữ nguyên. Không đổi policy/session/BrowserHost/menu/master/README.

## Sửa temporal và cluster

- Header A/role-link được ghi nhận trước body, lấy **visible text nodes** trong cùng link qua tối đa8 ancestor, gom tối đa96chars/16textnodes. Nested/split strings được xét nguyên chuỗi sau khi candidate walk hoàn tất; không dùng `.textContent`, không nhận prefix trước phần còn lại hoặc lấy hidden text. Boxless links chỉ nhận text từ descendants có visibility/Range evidence.
- A role=button giữ link semantics trong header. Button/control có temporal label dùng label; control chưa có label chỉ được probe sau khi heading+public đã cùng ancestor cluster không chứa body. Tối đa4probes/64nodes chung run, không duyệt mọi button. Body/footer controls không cấp temporal; footer restricted/ad vẫn chặn.
- Format classifier hữu hạn DATE/RELATIVE/DAY_WORD/ABBREVIATED, yêu cầu whole string và range cơ bản. Bare IDs/junk/invalid ranges không thành date. Không chuyển thành timestamp thực, không bổ sung năm/ID/permalink giả. Locale/format ngoài tập này vẫn có thể thiếu.
- Temporal evidence được đặt ở link/control root để nested spans không tiêu tốn cluster ancestry. Common cluster heading/time/public vẫn giới hạn8ancestor, không chứa body. Fallback có thể đề xuất recheck từ heading+public khi time chưa đọc được; **đề xuất không đủ lưu sample**: recheck vẫn bắt buộc temporal/public/cluster và toàn guard cũ.
- R-T1: BLOCKQUOTE/Q không cấp heading/public/temporal cho outer header; negative restricted/ad trong vùng liên quan vẫn xét. Body/comment/embedded/sidebar/author-heading link không cấp temporal. Không bỏ subtree quote đơn thuần để mất negative evidence.

Mọi temporal ancestor/probe dùng chung2500nodes/1giây và main4giây, không reset. Link record cap16, text cap96/16nodes và probe caps được ghi rõ trong limits. Text/probe thiếu không được promote temporal; global/probe interruption bỏ candidate chưa hoàn tất. Các caps12boundaries/5samples/5shapes/32KiB/1action, barrier state invariants, Stop/late/owner, private/footer, alias/body/identity/contact guards giữ nguyên.

## Metadata mới và giới hạn

`diagnostics.temporal` và mỗi rejection shape có cùng record enum-key/count: links/roleLinks/controls, label/direct/nested/split/control matches, format families, unmatched/textLimits/ancestorLimits/controlSkipped/probeNodes, quote/heading/body/hidden exclusions. Không ghi temporal text/aria-label/title/href/date/CSS/class hay đường DOM. Counts là observed attempts, có thể chồng loại và lặp giữa feed/recheck; không unique posts hoặc hoàn chỉnh của nguồn. Zero trong partial/pruned không chứng minh không có date.

`metadata.temporal/timeTag/abbr/ariaTemporal` ở sample vẫn chỉ evidence flags/counts. Temporal thiếu làm sample bị loại; identity/source type thiếu vẫn null/UNKNOWN. Body/permalink chỉ candidates.json ngoài repo; summary/hashes không chứa nội dung. Retention7ngày/manual cleanup như trước. Ancestor8/text96/control4 là giới hạn cụ thể cần đọc cùng counters nếu source vẫn chưa khớp; không tự tăng cap hoặc hover/scroll/network để né thiếu evidence.

## Checks snapshot v5 ban đầu (trước R-T2/R-T3)

```powershell
node scripts/facebook-dom-diagnostic-build.mjs
node --test .test-build-csd-dom/tests/facebook-dom-diagnostic.test.js .test-build-csd-dom/tests/facebook-public-candidate.test.js
node scripts/facebook-public-candidate-smoke.mjs --temporal --output .brain/evidence/p02-header-temporal-fixture-2026-10-27.json
node scripts/facebook-public-candidate-smoke.mjs --overlay --output .brain/evidence/p02-header-temporal-overlay-regression-2026-10-27.json
node scripts/facebook-public-candidate-smoke.mjs --output .brain/evidence/p02-header-temporal-candidate-regression-2026-10-27.json
node scripts/facebook-public-candidate-smoke.mjs --boundary --output .brain/evidence/p02-header-temporal-boundary-regression-2026-10-27.json
node scripts/facebook-public-candidate-smoke.mjs --layout --output .brain/evidence/p02-header-temporal-layout-regression-2026-10-27.json
```

Build PASS; **26/26 owner tests PASS**, **15/15 native cases PASS** (3temporal +12related regression). Không sửa/chạy reviewer tests trên v5 trước handoff. External0 theo local protocol, observer không attach, synthetic shutdown0windows/0WebContents, temp data xóa sạch. Metadata native suite không liên quan không lặp;14metadata unit checks vẫn PASS.

Native temporal dương:5samples chỉ dùng nested/split A, boxless role-link, A role=button, button có same-header cluster và labelled button; không TIME/ABBR hỗ trợ. Observed4nested/4split/2control-text/1label matches,5format matches,151node visits. Native âm: body/comment/embedded/sidebar/heading date, plain Q date (R-T1), quote có Friends, cross-cluster time, hidden date, footer Friends/Sponsored đều0samples; giữ NO_TEMPORAL/NO_HEADER_CLUSTER/CONFLICTING/AD reasons. Native partial header dùng chung cap2500, textLimits>0, không giữ snippet hoặc prefix date. Unit classifier/schema reject oldv4/raw temporal values và tiếp tục kiểm lifecycle/limits/redaction.

Thêm fixture-only `--csd-header-temporal-fixture`/smoke `--temporal`, chỉ cùng public-candidate fixture và không kết hợp variant khác; không đổi LIVE route/flags. Files sửa đúng candidate fields/script/controller/fixture/owner test, index/smoke tối thiểu. [Manifest v5 ban đầu](../evidence/p02-header-temporal-files-2026-10-27.json) giữ hash của snapshot trước hai finding mới; copied probe-build metadata chỉ bootstrap baseline.

## Review fix R-T2/R-T3 — 2026-10-28, Asia/Bangkok

Theo lead:8 temporal baseline tests PASS, R-T1 đã đóng, nhưng reviewer tái hiện hai false positives. Owner sửa hẹp script, native temporal fixture và classifier rejection table; schema vẫn5. Không sửa reviewer tests/evidence, shared dist, runtime/source, policy/session/menu hoặc gates.

- **R-T2:** prefix `2 giờ` trong anchor có tail `NOT_A_TIMESTAMP` sau8 wrappers phải không cấp temporal. Scope của temporal record được truyền qua các element đã đi qua bằng WeakMap; khi text không nối được tới record trong8ancestor, record đó bị `limited` và không được match, kể cả prefix đã hợp lệ. Không đi thêm ancestor, không dùng prefix hoặc raw tail để suy timestamp. `ancestorLimits` ghi lần thiếu. Các record khác không bị loại chỉ vì record này thiếu; global caps giữ nguyên.
- **R-T3:** visible text nodes chỉ chứa whitespace vẫn tham gia nối raw string của temporal. `<span>1</span> <span>2 giờ</span>` giữ `1 2 giờ` và không match; không thành `12 giờ`. Whitespace vẫn nằm trong96chars/16textnodes. Positive role-link boxless `<span>2</span> <span>giờ</span>` cho đúng temporal; không ghép thêm separator tự tạo hoặc lấy `.textContent`.

Hai repro âm được đặt **đầu** negative native fixture để được register trước cap16links. Sau sửa native positive5samples/153visits, negative0samples/261visits với `ancestorLimits=1` và `NO_TEMPORAL=7`, partial0samples tại2500nodes. Vẫn giữ private/footer/quote/header/body/hidden checks trong cùng temporal fixture. External0, observer không attach, shutdown0windows/0WebContents, temp data xóa sạch.

Validation trên snapshot sửa này:

```powershell
node scripts/facebook-dom-diagnostic-build.mjs
node --test .test-build-csd-dom/tests/facebook-public-candidate.test.js
node scripts/facebook-public-candidate-smoke.mjs --temporal --output .brain/evidence/p02-header-temporal-fix-2026-10-28.json
```

Build PASS, **12/12 candidate unit tests PASS**, **3/3 native temporal cases PASS**. Các số26/26 và15/15 ở phần trước thuộc snapshot v5 ban đầu; không lặp metadata hoặc native suites không liên quan sau fix hẹp này. Reviewer chưa rerun hai regressions trên snapshot sửa trong phạm vi owner; không tự tuyên bố reviewer đã đóng R-T2/R-T3.

[Manifest hiện tại](../evidence/p02-header-temporal-fix-files-2026-10-28.json) đóng băng source/isolated build mới và liên kết evidence; fixed script hash là hash chuỗi thực thi, controller hash chỉ module controller. Source/build giữ ổn định cho reviewer/lead đối chiếu và quyết định activation. Owner LIVE reads0, permission UNKNOWN, benchmark OFF, valid0; shape DOM thật vẫn chưa được chứng minh.
