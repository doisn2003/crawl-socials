# P02.02 — Review độc lập search → mở một post (ADR-016)

Trạng thái: **FINAL REVIEW PASS — không còn blocker trong phạm vi ADR-016; R-SO1/R-SO2 CLOSED trên frozen snapshot**. Reviewer `csd_adapter`, 2026-10-28. Đã đọc [ADR-016](../decisions/ADR-016-observed-search-post-open.md) và [dispatch](../handoffs/lead-p02-search-post-open-dispatch-2026-10-28.md). Audit v18 hoàn tất riêng tại [report](adapter-p02-v18-live-sample-audit-2026-10-28.md). Không thao tác runtime/nguồn thật, không sửa production. Kết luận cuối ở cuối tài liệu; giữ nguyên lịch sử failed snapshots để tái hiện.

## Điểm cần giữ khi tái dùng reader

1. Search reader đã cho phép `HEADING_PUBLIC` với thời gian optional. Một sample được nhận không chứng minh đã tìm thấy timestamp có thể click. Target cần proof riêng, cùng header cluster và exact public-group signal; không chọn first link hoặc author/group title. Theo làm rõ của lead, temporal text match **không phải gate bắt buộc duy nhất**: unique structural placeholder proof được chấp nhận khi loại được author/group/body/actions và ambiguity. Code mới đã thêm group-public counter riêng cho search open.
2. Placeholder cùng href/tracking không xác định một post. Discovery và click phải giữ đúng node đã chọn trong đúng document/owned view; replacement node cùng attributes, header bị chuyển vị trí, public signal đổi, hoặc nhiều timestamp hợp lệ trong một boundary phải không tạo action nếu binding không còn chắc chắn. Không dùng hash href như duy nhất bằng chứng node.
3. Một click phải được arm sau recheck target/owner/route/barrier. Navigation trước action hoặc từ owner khác không chứng minh click đã mở bài. SPA hợp lệ không cần document generation tăng; full navigation phải được theo dõi và bind generation mới trước read. Không tự chấp nhận URL chỉ vì parsed IDs giống.
4. Stop/timeout phải ngăn fixed read hoặc nhận late result, giữ native pending fence tới khi execute/navigation thực sự kết thúc; dùng cùng combined-start budget. Current-post reader tiếp tục giữ public/body/comment/auth guards hiện có.

## Các fixture hẹp sẽ kiểm khi API/code frozen

- Positive: một timestamp visible trong header nhóm công khai có placeholder search; click handler tạo route post thật trong SPA, đúng một click và một fixed read. Không `loadURL` placeholder.
- Negative binding: node detach/replacement cùng href; header/private proof đổi; author/group-title hoặc body/comment link có text giống timestamp; hai target mơ hồ. Kỳ vọng zero click nếu discovery/revalidation không đủ.
- Lifecycle: owner/main route đổi, barrier xuất hiện trước click, Stop trong pending click/navigation/read. Không sample thành công từ late callback; không cho operation kế tiếp chạy chồng.
- Native local fixture qua menu/watchers sau freeze để kiểm event ordering thực; dùng regressions bị ảnh hưởng của search/current-post. Không viết framework hoặc chạy suite rộng khi implementation chưa sẵn sàng.

## Lượt review sơ bộ: R-SO1 và R-SO2 (P2)

Snapshot source `facebook-search-post-open-script-hooks.ts` SHA-256 `2f3b46b8bde61eaff2ab70ce8d970be677da7cebdfeb1dd0555f400080012134`. Owner chưa freeze; không gán findings này cho bản chưa kiểm sau đó. [Receipt hashes](adapter-p02-search-open-preliminary-files-2026-10-28.json) ghi hashes trước/sau compile, bốn source/test không thay trong khoảng compile. Output riêng giữ nguyên tại `.test-build-adapter-candidate/search-open-preliminary/`.

**R-SO1: menu link vẫn bị click như timestamp.** `src/main/facebook-search-post-open-script-hooks.ts:21` chặn `aria-haspopup` menu/listbox/tree/grid nhưng thiếu `true`. Synthetic fixture có một group-public header, một body, một placeholder `A` có `aria-haspopup="true"`, text `Options`. Toàn bộ DISCOVER và CLICK scripts trả TARGETS_READY rồi CLICK_DISPATCHED, target click counter tăng 1. Đây là action menu đã được đánh dấu, trái phạm vi timestamp; uniqueness không đủ loại action này. Expected zero target/zero click.

**R-SO2: author link có explicit relationship vẫn thành timestamp.** Cùng chỗ lọc `:20–26` không xem `rel=author`. Fixture có group heading, author link ngoài heading với `rel="author"`, placeholder href và một exact public-group badge. DISCOVER/CLICK chọn author link, proof `UNIQUE_HEADER_PLACEHOLDER`, thực hiện một click. Expected zero target/zero click; việc author nằm ngoài heading không loại nghĩa author của link. Không yêu cầu text temporal làm gate duy nhất để sửa hai ca này.

[Repro sạch](adapter-p02-search-open-preliminary-repro-2026-10-28.json) chỉ lưu enums/counters. Cả hai là synthetic DOM, chưa chứng minh những attributes này có trên Facebook LIVE. Tác động được tái hiện trên hành vi lựa chọn/click của code hiện tại, không suy nguyên nhân nguồn thật.

Reviewer tests `tests/facebook-search-post-open-review.test.ts`: **2 PASS / 2 FAIL**. Positive unique opaque placeholder vẫn PASS dù không có temporal text; hai placeholders mơ hồ vẫn zero-click PASS. Hai negatives trên FAIL. Harness chạy cả complete scripts trong cùng VM, mô phỏng node identity/HTMLElement click counter/geometry và fixed XPath; chưa là native Electron evidence. MutationObserver trong harness hiện là stub nên không dùng kết quả này để claim đã kiểm mutation lifecycle.

Lệnh tái hiện đúng failed compiled snapshot, không đọc source đang sửa:

```powershell
node --test .test-build-adapter-candidate/search-open-preliminary/tests/facebook-search-post-open-review.test.js
node .test-build-adapter-candidate/search-open-preliminary/tests/preliminary-repro.mjs
```

Đã báo lead, giữ reviewer expectations và failed snapshot. Chờ owner sửa/freeze để review controller/lifecycle/native; chưa kết luận nghiệm thu toàn task và chưa tác động runtime.

## Lượt sơ bộ tiếp: controller/lifecycle và fix R-SO1/R-SO2

Theo giao tiếp của lead, kiểm thêm Stop/late result tại CLICK/READ và owner/navigation trước click. Bản mới đã loại popup attribute khác `false`, explicit rel author và các ancestor tương ứng. Giữ nguyên hai fixture R-SO1/R-SO2 và structural opaque positive; **8/8 tests PASS** trong `.test-build-adapter-candidate/search-open-lifecycle-preliminary/`. [Receipt](adapter-p02-search-open-lifecycle-preliminary-files-2026-10-28.json) ghi sáu hashes source/test giống nhau trước/sau compile và lúc chốt receipt. Không ghi đè failed output cũ.

- Controller source SHA `26824149832ed477032e1c65ea52815d238ee969806b967ef24833e596cd02da`; hooks source SHA `4462e1aa158ed5d40205db41f684ef7d33c4a597e9d8ce26d0c4b47c70fc755e`.
- Positive thực thi complete DISCOVER/CLICK scripts, click callback tạo SPA route trong cùng synthetic DOM, fresh callback bind run/hashes: OPENED_POST_SAMPLE, một click/một read, valid0.
- Stop khi CLICK **đã dispatch nhưng promise result còn pending**: INCONCLUSIVE/STOPPED, click confirmation UNCONFIRMED; không gọi fixed read. Start kế tiếp bị BUSY cho tới native promise hoàn tất; late completion không sửa summary đã ghi. Test không tuyên bố Stop hoàn tác click đã dispatch hoặc hủy mọi lệnh đã gửi tới renderer.
- Stop khi READ còn pending: gọi stopRead một lần; giữ BUSY fence; late observation/callback không tạo success, body hash vẫn null trong summary đã ghi.
- SPA route đổi trước khi fixed CLICK script thật chạy: script không click, controller INCONCLUSIVE và không read. Owner/view loss trước click cũng zero click/read. Do đó event routeReady trước click chưa đủ tự tạo success trên các ca này; vẫn phải nhận CLICK_DISPATCHED từ fixed script và qualifying read.
- Các tests dùng callback cộng fixed-script VM, không phải native Electron. Chưa kiểm frozen menu/native event ordering; source owner vẫn đang phát triển. Không gọi kết quả này là nghiệm thu cuối hay proof về runtime LIVE.

Lệnh chạy snapshot controller đã lưu:

```powershell
node --test .test-build-adapter-candidate/search-open-lifecycle-preliminary/tests/facebook-search-post-open-review.test.js
```

Không thấy blocker mới trong phạm vi lượt này. Reviewer dừng chờ freeze/native; không mở rộng test suite hoặc tác động source/runtime.

## Final review trên frozen handoff

Đối chiếu [handoff owner](../handoffs/p02-search-post-open-2026-10-28.md) và manifest `p02-search-post-open-files-2026-10-28.json`. Đã đọc hooks, href classifier, controller, menu integration và native fixture. **31/31 owned hashes** khớp trước native run và khi chốt; **67/67 files** trong bản native copy riêng khớp frozen build. [Final receipt](adapter-p02-search-post-open-final-files-2026-10-28.json) giữ hashes/test/native refs đầy đủ.

Matcher của synthetic reviewer fixture trước đó chỉ nhận tên tag chữ cái nên throw ở selector `h2/h3/h4` mới của production. Đã sửa đúng semantics tên tag có chữ số; không đổi fixture nội dung hoặc assertions để che lỗi. Đây là lỗi harness, không phải regression production. Fresh compile riêng và **112/112 checks PASS**: 8 reviewer search-open + 12 owner search-open + 84 search candidate regressions + 8 current-post reviewer regressions.

Native Electron kiểm lại độc lập trên bản copy riêng, dùng menu/watchers thật và protocol fixture local:

| Case | Actual clicks | Post read attempts | Kết quả |
|---|---:|---:|---|
| Opaque unique placeholder | 1 | 1 | OPENED_POST_SAMPLE; structural proof không cần temporal text match |
| Node replacement cùng href | 0 | 0 | INCONCLUSIVE / STALE_TARGET |
| Challenge sau click | 1 | 1 | INCONCLUSIVE / CHALLENGE; không qualifying sample |

**3/3 native scenarios PASS**, external requests0, windows/webContents sau cleanup0. Native stop-after-click/read không được thêm vào owner fixture trong lượt này; hai pha đó đã được kiểm riêng bằng controller + complete fixed-script VM, với giới hạn đã nêu ở trên. Owner/lead có các native cases khác; report này chỉ nhận ba lượt reviewer tự chạy.

Controller compiled SHA `d659257dcb1eced2ac591241652cdd3fc3f5988c31d1e5de0f1e8ebaaa038b26` khớp manifest. Discovery script `d2c4f6be903135651759ba69bc7d78341b02040d51fa5be9acc7245bf2919931`; click script `3095f0b4ed1ddd9fd8de4e47c03b9853d7fd2dc422f04d7592479511ee91f6db`. Default current-post và search script bytes giữ nguyên accepted hashes; không nới body/public/barrier guards để có action.

R-SO1/R-SO2 CLOSED: hai negative fixtures giữ nguyên và zero action; opaque positive vẫn hoạt động. Node/header/body/public binding được consume trước dispatch, fresh guard scan và MutationObserver bảo vệ replacement; native stale xác nhận đường này. Controller yêu cầu click reply, transition trong cùng owner và đúng qualifying post-read refs; event trước actual fixed click trong regression không tự tạo thành công. Stop/late completion không nhận sample/proof thành công, native capacity giữ fence tới settlement. Summary vẫn không giữ raw URL/ID/body, valid0/permission UNKNOWN/benchmark OFF/full-text false.

Core-ready đã báo lead trước khi hoàn thiện receipt để lead có thể activation và thực hiện một phép thử LIVE theo ADR-016. **Review không chứng minh Facebook LIVE sẽ mở được timestamp, không chứng minh đủ 5 bài hoặc 1.000 bài/24h, không nâng gate.** Không cần thêm checks trong scope đã đạt này; reviewer giữ vai trò review cho kết quả/triển khai tiếp theo.
