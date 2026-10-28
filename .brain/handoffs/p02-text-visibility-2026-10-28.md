# P02 text visibility v7 — code ready

Ngày28/10/2026, Asia/Bangkok. Theo [dispatch](lead-p02-text-visibility-dispatch-2026-10-28.md) sau [LIVE v6](../evidence/p02-live-temporal-scope-v6-2026-10-28.md). Lead giữ runtime20188/source6361794 và1/3starts. Owner không thao tác UI/runtime/shared dist/master/README, không source read. Permission UNKNOWN/benchmark OFF/valid0 giữ nguyên. Chưa xác nhận predicate là nguyên nhân duy nhất trên Facebook.

## Sửa predicate và giới hạn

- Bỏ shortcut parent RENDERED→text visible. `layout` chỉ coi rect có finite positive width/height là RENDERED, tối đa8rects; wrapper boxless/contents vẫn đi qua. Mỗi text cần Range của chính nó, có finite geometry; list malformed/missing/throw, hơn8rects hoặc geometry không xác định làm boundary incomplete, không giữ prefix/sample. API exceptions không được ghi raw.
- Text Range không có area bị loại dù parent có box. Whitespace có Range height>0 được giữ làm separator, kể cả width0; không nối `1` + visible space + `2 giờ` thành `12 giờ`. Không dùng parent-box fallback khi Range thiếu. Body snippet cũng dùng predicate này; không giữ non-rendered body segments.
- Clip frames được cache WeakMap theo ancestor tới body, tối đa32new ancestors mỗi lần resolve. Range probe, rect inspection và ancestor work dùng cùng `consume()`/2500nodes/1giây; không reset budget. Overflow clip lấy client box; fully clipped text bị bỏ. Partial/mixed clipping, transformed clip box, clip-path/legacy clip không có model chắc chắn hoặc resolve thiếu làm visibility UNKNOWN/boundary incomplete. Body/root viewport overflow không dùng làm quy tắc loại offscreen. Không sửa CSS hoặc đọc toàn subtree.
- Không lọc mọi màu transparent; native text transparent có text-shadow vẫn được nhận. Không dùng vị trí ngoài viewport làm hidden. Native font-size0/scale(0)/overflow0×0 có repro geometry cụ thể; đây không phải bảo đảm mọi CSS paint pattern. Full text node Range vẫn chỉ là geometry evidence, không chứng minh từng glyph đã paint hoặc nội dung đúng chủ đề.
- Giữ known scope collector, whole-string classifier, header cluster8ancestor,96chars/96textnodes/16records,4control probes/64probe nodes,12boundaries/5samples/32KiB. `limits.textRects:8,textAncestors:32` mô tả probe bounds mới, không tăng cap chung. Không đổi fields/classifier, session/policy/BrowserHost/menu hoặc LIVE trigger.

Script/result/controller/validator/writer/payload cùng **schema7**. Native fixture assertions đổi7; thêm fixture-only `--csd-text-visibility-fixture`/smoke `--visibility`, chỉ đi cùng public-candidate fixture và không kết hợp variant khác. Build `.build-csd-dom`, owner tests `.test-build-csd-dom`; không ghi shared dist.

## Metadata

Layout giữ counters cũ và thêm `textParentBoxes,textRangePositive,textZeroArea,textClipped,textUnknown,textSeparators,textClipChecks`. Parent boxes là observation, không positive text proof. RangePositive gồm separator được nhận; zero/clipped/unknown là lý do không thu. Partial clip có thể vừa clipped vừa unknown. Cached ancestor style/clip checks đếm attempts, không unique bài.

Temporal thêm `rangeSegments,rangeChars,zeroSegments,clippedSegments,unknownSegments` cho text có known record owner. `rangeChars` đếm UTF-16 chars trong whole raw text segments được geometry nhận, saturate2500 ở shape/summary; không là exact painted glyph count. Các segment counts có thể lặp giữa feed/recheck, không unique. Fields chỉ counts với fixed allowlist ở diagnostics và tối đa5rejection shapes; không raw date/text/labels/URLs/CSS/DOM. Có thể đối chiếu rangeSegments/rangeChars/zeroSegments với char/text-node limits ở lượt LIVE kế tiếp, không suy date thật quá dài từ cap hit đơn lẻ.

## Validation và review

Owner đã chạy fixture geometry mới trên collector v6 trước sửa: process FAIL ở native fixture. Không có baseline candidate-count artifact nên không gán số actual cho lần đó. Reviewer độc lập có R-V1 baseline10targeted=6PASS/4FAIL (Range empty/zero-area, date+noise, body contamination, missing/throw). Đã đọc và đối chiếu cả4case; không sửa/chạy reviewer harness và không tự đóng R-V1.

```powershell
node scripts/facebook-dom-diagnostic-build.mjs
node --test .test-build-csd-dom/tests/facebook-public-candidate.test.js
node scripts/facebook-public-candidate-smoke.mjs --visibility --output .brain/evidence/p02-text-visibility-native-2026-10-28.json
node scripts/facebook-public-candidate-smoke.mjs --temporal --output .brain/evidence/p02-text-visibility-temporal-2026-10-28.json
node scripts/facebook-public-candidate-smoke.mjs --layout --output .brain/evidence/p02-text-visibility-layout-2026-10-28.json
```

Build PASS; **13/13 candidate tests**, **9/9 native cases** (3geometry/3temporal/3layout) PASS trên source cuối. Không lặp unrelated suites. Unit mới kiểm missing/malformed/list-length/rect-count Range và deadline hết ngay trong Range work; payload vẫn0 và không raw text. Schema chặn old6/raw geometry/non-numeric/out-of-bound counts; lifecycle/barrier/bytes/redaction checks giữ PASS.

- Geometry positive5samples/588visits: visible date cùng100font-zero fragments, scale(0) noise, overflow0×0 noise; boxless link/visible whitespace, transparent+shadow và offscreen đều đúng. Temporal zeroSegments101/clippedSegments1/rangeSegments7/rangeChars27, char/node limits0. Body giữ đúng `VISIBILITY_PUBLIC_BODY`.
- Geometry negative0samples/234visits: font-zero/scale-zero/clip/hidden date, private, quote, body-only date. Range API missing ở isolated fixture world cho0samples/38visits, textUnknown8/unknownSegments2 và incomplete reason. Không đổi API/page nguồn thật.
- Temporal positive5samples/924visits; deep>8/fragmented/96nodes/control/label vẫn đúng. Negative0/486visits, R-T1–3/body/comment/embedded/heading/footer/hidden/cross-cluster giữ0. Limits/partial0/2500visits,97textnodes và97single-node chars vẫn bị loại, không partial prefix.
- **Fixture contract:** padding spaces từng span mặc định có thể collapse và Range[] trong Chromium; geometry đúng sẽ không tính chúng là rendered segments. Fixture96/97 đổi `white-space:pre` để thực sự render đủ96/97nodes, giữ expected5/0. Reviewer helper baseline trả Range[] cho mọi `!nodeValue.trim()`; khi kiểm R-T3/96–97, cần cho whitespace được chủ đích visible có Range evidence phù hợp. Không đổi expected negative0 hoặc production trở lại parent-box shortcut để khớp mock.
- Layout positive1/85visits giữ body/contact redaction và aliases; negative0/465visits; global partial0/2500. External0, debugger observer không attach, shutdown0windows/0WebContents, temp files xóa sạch cho cả3native groups.

[Manifest source/build frozen](../evidence/p02-text-visibility-files-2026-10-28.json) chứa fixed script string hash và compiled controller module hash riêng. Copied probe-build metadata là bootstrap baseline. Source/build giữ ổn định cho lead/reviewer; chưa activation/LIVE từ owner và chưa chứng minh yield trên nguồn thật.
