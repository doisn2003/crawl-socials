# P02.02 — Review eligibility instrumentation sau LIVE v19

Trạng thái: **FINAL REVIEW PASS — R-SO3 CLOSED trên frozen instrumentation; nguyên nhân LIVE v19 vẫn UNDETERMINED**. Reviewer `csd_adapter`, 2026-10-28. Đọc [dispatch](../handoffs/lead-p02-search-target-diagnostics-dispatch-2026-10-28.md) và [LIVE v19](p02-live-search-post-open-v19-2026-10-28.json). Không đọc payload nguồn, UI, profile hoặc credentials; không sửa production. Giữ baseline/historical finding bên dưới, kết luận cuối ở cuối file.

V19 chỉ chứng minh hai qualified headers nhưng không có target, zero click/read, không ambiguity. Metadata hiện tại không cho biết record bị loại ở bước nào. Không suy Facebook chặn, không có bài, CSS/temporal failure hay nguyên nhân cụ thể từ kết quả này.

## R-SO3 — Link chắc chắn không phải post làm hỏng visibility state của target khác (P2)

Ở frozen v19 `src/main/facebook-search-post-open-script-hooks.ts:20`, `visibleSignal(target,c)` chạy trước href classification và các loại trừ semantic ở dòng21. `src/main/facebook-public-candidate-script.ts:69–72` đặt `c.visibilityUnknown=true` khi node có quá8 client rects, rect không hợp lệ hoặc partial clipping. Cuối vòng, `choices.size===1&&!c.visibilityUnknown` từ chối binding.

Repro dùng complete DISCOVER/CLICK scripts của **compiled v19** trong một VM:

- Một header public-group hợp lệ, heading và body riêng, một timestamp placeholder có geometry rõ và một group-only link ngoài heading.
- Group-only link có href `/groups/123/`, chắc chắn không thuộc href kinds được mở; riêng link này có9 client rects. Các text Range, public signal, body và timestamp giữ như positive fixture đã PASS.
- Expected: group-only link bị loại vì href; timestamp riêng còn đủ proof và được chọn. Actual: target count0, không click. Uncertainty của link không thuộc phạm vi action đã làm mất binding của target hợp lệ.
- Counterpart khi **timestamp thật** có9 rects vẫn đúng zero target/zero click. Không đề nghị nâng rect cap hoặc chấp nhận geometry không rõ trên target có thể được click.

Hai narrow tests trong `tests/facebook-search-post-open-review.test.ts`: **1 PASS / 1 FAIL** trên baseline. Baseline tái dùng modules v19 từ output reviewer đã nghiệm thu, không compile owner source đang thay đổi. Discovery fixed-script SHA-256 `d2c4f6be903135651759ba69bc7d78341b02040d51fa5be9acc7245bf2919931` đã assert trước run. File hashes ở `.test-build-adapter-candidate/search-target-v19-baseline/baseline-hashes.json`.

```powershell
node --test --test-name-pattern='review search target:' .test-build-adapter-candidate/search-target-v19-baseline/tests/facebook-search-post-open-review.test.js
```

Đây là lỗi isolation giữa một record đã không thể là action target và visibility proof của record khác. Có thể sửa bằng loại href/semantic chắc chắn không đủ điều kiện trước phép đo visibility có side effect; giữ uncertainty guard cho những target có thể hợp lệ. Đề nghị instrument nguồn của visibility invalidation để không nhầm nó với “không có temporal record”. **Fixture không chứng minh R-SO3 là nguyên nhân LIVE v19.** Đã báo lead để owner quyết định sửa hẹp trong lượt instrumentation theo dispatch.

## Phạm vi review khi code-ready

- First decisive rejection phải đúng mỗi record; phân biệt không có record, semantic/heading/body/quote, href, geometry/viewport, header cluster và ambiguity. Nếu state từ record trước làm mất binding, metadata cần thể hiện rõ, không gán sai cause cho target cuối.
- Counter/shape chỉ enum/count/boolean, ≤5 shapes, có bounds/strict validator; không giữ href, attribute values, text/name/IDs hoặc DOM dump. JSON malformed/extra keys/array coercion phải bị từ chối.
- Không reset node/deadline budget hoặc tăng số click/read; instrumentation không tự đổi target ordering/binding. Giữ R-SO1/R-SO2, stale, barrier, Stop/late result và opaque positive.
- Không tự thêm temporal text match làm gate. Chờ freeze để compile/test/native cần thiết; chưa kết luận nghiệm thu instrumentation.

## Final frozen review

Đã đọc [handoff](../handoffs/p02-search-target-diagnostics-2026-10-28.md), hooks/fix, validator và summary/proof flow; đối chiếu `p02-search-target-files-2026-10-28.json`. Fix loại href/action/header chắc chắn không thể là target trước `visibleSignal`; không tăng8rect cap và không reset sticky uncertainty. Instrumentation chỉ mở cho variants DISCOVER/CLICK; default search/current-post strings giữ accepted hashes.

**26/26 checks PASS** trong output riêng `.test-build-adapter-candidate/search-target-final`: 13 reviewer +13 owner. Hai fixture baseline R-SO3 giữ nguyên geometry/hành vi; bổ sung assertions cho cause. Group-only link được HREF/visibility NOT_CHECKED/header invalidation NONE; timestamp thật không rõ geometry bị TARGET_VISIBILITY và headers_visibility_unknown. Menu/author/ambiguous/opaque positive, Stop pendingCLICK/READ, late callback và pre-click navigation/owner regressions vẫn đạt.

Instrumentation mới được kiểm độc lập:

- Cùng một popup+author+geometry-unknown target chỉ ghi first decisive POPUP; author/visibility counters không tăng và downstream fields NOT_CHECKED. Không gán geometry uncertainty từ record chưa cần đo.
- Fixture7records có6 loại trừ và1target giữ tối đa5shapes +shapes_truncated=true; counters vẫn nhận đủ7records, một action độc lập vẫn chạy. Shape cap không đổi target decision.
- Generated metadata được validator nhận;9 biến thể raw field/enum array/object, counter coercion/oversize, shape>5/count0 và boolean string bị INVALID_RESULT. Serialized opening không giữ synthetic raw href/tracking/text/label/body/group name.

Native Electron tự chạy bằng bản copy frozen build riêng, protocol local/menu/watchers thật:

| Case | Browser clicks / post reads | Quan sát |
|---|---|---|
| group-geometry | 1 / 1 | Group-only18rects bị loại HREF; target tốt vẫn OPENED_POST_SAMPLE; zero header visibility invalidation |
| timestamp-geometry | 0 / 0 | Timestamp18rects bị TARGET_VISIBILITY; NO_ELIGIBLE_TIMESTAMP |
| shape-cap | 1 / 1 |5shapes/truncated; counters đầy đủ và OPENED_POST_SAMPLE |

**3/3 native PASS**, external requests0, windows/webContents cleanup0. Không chạy lại native menu/author/stale trong lượt instrumentation vì predicates/binding không đổi; frozen tests liên quan đạt và lead/owner có native coverage riêng. Không nhận các lượt đó là lượt reviewer tự chạy.

**27/27 owned hashes và67/67 copied native build hashes khớp** trước native run và cuối receipt. [Final receipt](adapter-p02-search-target-final-files-2026-10-28.json) gồm hashes, source snapshot, native outputs và counters sạch. Compiled controller `6efb4afac58afc02f75bca753f199e1676640566909bd1e300571d0a6656e6de`; discovery `44828d3d6af163205b85018a57aed57bbae4d95a8d9f24019d941ba87f228943`; click `b9799e8671788a325381d0640edd332337b441b8e40fd7462fea5587d595b2fc`.

Core-ready đã báo lead. R-SO3 CLOSED trong fixture và code isolation; **không coi fixture là nguyên nhân v19 hoặc bằng chứng nguồn sẽ có target ở lượt kế**. Scope vẫn discovery≤5/oneclick/oneread, no retry/scroll, permission UNKNOWN, benchmark OFF, valid0. Chờ một diagnostic LIVE của lead để đọc counters cụ thể; không cần mở thêm suite trong phạm vi đã đạt.
