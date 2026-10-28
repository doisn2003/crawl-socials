# P02.02 — Review target-kind và read-only preflight

Trạng thái **FINAL REVIEW PASS — R-PF1 CLOSED trên bản sửa frozen 23:44:45Z**. Reviewer `csd_adapter`, 2026-10-28. Đã đọc [dispatch](../handoffs/lead-p02-search-target-preflight-dispatch-2026-10-28.md) và [LIVE v21](p02-live-search-fragment-v21-2026-10-28.json). V21 nhận2 placeholders rồi loại NEW_WINDOW; chưa biết target category hoặc downstream eligibility. Không suy `_blank`, popup, deny hoặc bot block từ counter này. Lịch sử failed snapshot bên dưới được giữ nguyên; kết luận cuối nằm ở phần cuối báo cáo.

## Điểm tích hợp đã phản hồi lead

- `visibleSignal` hiện có side effect lên `c.visibilityUnknown`, `c.temporalUncertain`, `c.openVisibilityInvalidated`; gọi `textClip` có clip cache và diagnostic counters. Không dùng trực tiếp state `c` thật để preflight một record đã bị NEW_WINDOW loại, nếu không sẽ lặp kiểu R-SO3.
- Preflight cần đọc cùng DOM/header/clip context đã biết nhưng state riêng; không tạo/đổi choices, bindings, target attributes, first decisive rejection hoặc trạng thái sticky visibility của action path.
- Ancestor/rect work vẫn tính vào budget chung; không reset cache/budget hoặc đo không giới hạn. Khi hết budget phải thể hiện NOT_CHECKED/INCOMPLETE và không cấp action từ facts dở. Equivalence ở đây là action/first rejection/state trong ca đủ ngân sách; không đòi visited hoặc diagnostic count phải giống trước khi có thêm phép đo.

## Frozen v21 equivalence baseline

Tái dùng compiled modules đã review, discovery hash `bcbb45e85ce60432c6d7d3eb3702e885151c14718d470b3f631ef2b2dd3ccb5d`; không compile source owner đang viết. [Receipt](adapter-p02-search-preflight-v21-baseline-files-2026-10-28.json), output `.test-build-adapter-candidate/search-preflight-v21-baseline/`.

**3/3 targeted baseline checks PASS**, fixtures trong `tests/facebook-search-post-open-review.test.ts`:

1. `_blank` link có9rects nằm cạnh timestamp hợp lệ: NEW_WINDOW vẫn là first rejection của link đó; timestamp riêng vẫn có1click. Không visibility invalidation từ record đã không đủ action eligibility.
2. Timestamp có9rects trước một `_blank` link geometry rõ: preflight của link bị loại không được xóa sticky uncertainty; zero targets/clicks, header visibility unknown vẫn1.
3. BLANK/PARENT/TOP/NAMED với popup+author+geometry unknown: vẫn first NEW_WINDOW và zero click, không sửa `target`; raw named-window value không xuất hiện trong opening metadata.

```powershell
node --test --test-name-pattern='review preflight equivalence:' .test-build-adapter-candidate/search-preflight-v21-baseline/tests/facebook-search-post-open-review.test.js
```

Sau freeze sẽ giữ nguyên các fixture/expectations, thêm assertions đúng schema target_kind/preflight thực tế, kiểm bounds/redaction/incomplete và một vài native cases cần thiết. Chưa có implementation frozen nên không claim preflight facts đã được kiểm, không mở rộng scope/action hoặc tác động runtime/profile.

## R-PF1 (P2) — Telemetry hết hard budget nhưng CLICK vẫn dispatch

Đã đọc [handoff frozen](../handoffs/p02-search-target-preflight-2026-10-28.md). Lead phát hiện điểm nghi vấn, reviewer tái hiện độc lập bằng **complete fixed scripts**. `SEARCH_OPEN_FINISH` trong `src/main/facebook-search-post-open-script-hooks.ts` gọi `finishEligibilityDiagnostics()` trước dispatch. `preflightSpend` khi hết deadline/node budget chỉ throw marker; `runOpenPreflight` catch và giữ incomplete, không set scan limit flags. FINISH sau đó chỉ xét flags cũ rồi có thể gọi `HTMLElement.prototype.click`.

Giữ completed eligibility để báo cáo riêng là hợp lý; nó không cho phép phát sinh action mới sau hard deadline/cap. Hai repro:

1. Discovery hoàn tất bình thường. Trong CLICK, original eligibility chạy với monotonic clock0; lần đọc target attribute thứ hai thuộc preflight khiến clock chạm đúng1000ms. Preflight còn lại dừng/incomplete, nhưng actual browser-click counter vẫn1. Expected0.
2. Một body có812 empty spans khiến original eligibility hoàn tất rồi telemetry dùng hết2500steps. DISCOVER vẫn ready; CLICK cũng visited2500 và actual click1. Expected0. Fixture không tăng cap hoặc làm sai geometry/public proof.

**0 PASS /2 FAIL** targeted tests, output giữ nguyên `.test-build-adapter-candidate/search-preflight-budget-failed/`. Snapshot generated discovery hash `02d434e668e92878cefe14c9baab3de18158c452311b2d8509016380758cbbce`, click hash `26f3f51153a38d00e9798d25d59a682724d51aecc964c2234df419e067e666b9`, cả hai khớp manifest freeze đã lưu. [Failed receipt](adapter-p02-search-preflight-budget-failed-files-2026-10-28.json) gồm copy manifest và compiled/test hashes; không gán source hash sau edit cho failed run.

```powershell
node --test --test-name-pattern='review preflight hard budget:' .test-build-adapter-candidate/search-preflight-budget-failed/tests/facebook-search-post-open-review.test.js
```

Đã báo lead để owner sửa hẹp: chặn action khi hard budget đã hết trước dispatch, vẫn có thể báo completed eligibility và incomplete telemetry riêng. Không hạ kỳ vọng0click hoặc nới1s/2500. Chưa chạy native/final acceptance vì blocker đủ evidence; giữ baselines và chờ fix-ready.

## Final frozen review — R-PF1 CLOSED

Đã đọc [handoff bản sửa](../handoffs/p02-search-target-preflight-budget-2026-10-28.md), đối chiếu [manifest owner](p02-search-target-preflight-budget-files-2026-10-28.json) và kiểm độc lập trên output riêng. [Final receipt](adapter-p02-search-target-preflight-final-files-2026-10-28.json) lưu source/compiled/fixed-script/test/native hashes; **26/26 owned hashes và 68/68 bản sao native build khớp**, source ổn định trước/sau review. Default search/current-post fixed-script hashes giữ nguyên.

`openBudgetExhausted` giờ ghi limit flags khi chạm 1.000 ms hoặc 2.500 bước. Guard chạy trong preflight, sau tổng hợp facts, trước lưu discovery binding và ngay trước click; nếu observer setup vượt ngân sách thì hủy observer/binding. Vì vậy completed eligibility có thể còn trong metadata, nhưng không cho phép bắt đầu action khi hard budget đã hết. Không coi “telemetry giữ nguyên action” là invariant ở ca cạn ngân sách; equivalence chỉ áp dụng khi còn đủ ngân sách.

**38/38 focused checks PASS: 21 reviewer + 17 owner.** Hai repro full-script deadline/cap giữ nguyên fixture và kỳ vọng zero click, nay PASS; failed compiled snapshot vẫn giữ riêng. Assertions bổ sung xác nhận limit flags, SCAN_INCOMPLETE và preflight INCOMPLETE. Kiểm schema 3, bounded facts/shapes, first decisive rejection, 13 raw/coercion mutations, placeholder binding/stale, actual timestamp geometry uncertainty, Stop/late results đều đạt. Không dùng preflight facts để cấp action; không xóa sticky uncertainty hoặc làm record đã bị NEW_WINDOW loại gây visibility invalidation sang target hợp lệ.

```powershell
node node_modules/typescript/bin/tsc tests/facebook-search-post-open-review.test.ts tests/facebook-search-post-open.test.ts --rootDir . --outDir .test-build-adapter-candidate/search-preflight-final --target ES2022 --module NodeNext --moduleResolution NodeNext --types node --lib ES2022 --strict --skipLibCheck
node --test .test-build-adapter-candidate/search-preflight-final/tests/facebook-search-post-open-review.test.js .test-build-adapter-candidate/search-preflight-final/tests/facebook-search-post-open.test.js
```

**4/4 native fixture scenarios PASS**, chạy trên bản sao build riêng với protocol fixture, external requests 0, cleanup windows/webContents 0:

- [Deadline trong DISCOVER](adapter-p02-search-preflight-time-discovery-2026-10-28.json): SCAN_INCOMPLETE, zero click/read.
- [Deadline trong CLICK](adapter-p02-search-preflight-time-click-2026-10-28.json): SCAN_INCOMPLETE, zero click/read.
- [State isolation](adapter-p02-search-preflight-isolation-2026-10-28.json): link BLANK có geometry UNKNOWN/RECT_LIMIT không làm hỏng target riêng hợp lệ; đúng 1 click và 1 read trên fixture.
- [Downstream facts](adapter-p02-search-preflight-facts-2026-10-28.json): BLANK có popup/author/media/action facts vẫn giữ first rejection NEW_WINDOW và zero action.

Native comparison giữ original decision/counters so với frozen v21 trên workload đủ ngân sách; work counters có thể tăng do phép đo bổ sung. Những kết quả này xác minh implementation và fixture, không chứng minh target category trên Facebook, khả năng mở bài LIVE, identity/public validity hoặc throughput. Reviewer không chạm runtime/profile/source production, không nâng gate. Đã báo **core-ready** cho lead để quyết định activation và một lượt LIVE; không còn blocker trong phạm vi review này.
