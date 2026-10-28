# P02.02 — Lead review overlay visibility v4

Ngày2026-10-27, theo [dispatch](../handoffs/lead-p02-overlay-visibility-dispatch-2026-10-27.md). **R-O1–R-O4 đóng, code v4 đã nghiệm thu và chạy LIVE.** [Kết quả LIVE lúc 16:28Z](p02-live-overlay-v4-2026-10-27.md): preflight CLEAR, 1151 nodes, 0 candidates vì thiếu temporal. Runtime 2460/main 1511526/source 6492758 giữ cùng profile. Các mục dưới ghi lịch sử review và activation trước lượt thật; hiện trạng task xem master v1.30.

Lead đã đọc fixed script/controller/schema, native overlay fixture, fixture-only flags và smoke runner. V4 dùng XPath có17sentinel để kiểm tối đa16barrier candidates theo thứ tự DOM; không chỉ first match. Hidden ancestry kiểm tối đa32steps; descendants≤128 dùng chung2500nodes/1s. Empty/boxless region không tựblock: cần modal box cóarea hoặc visible text/control trong viewport; authfield/recaptcha cóguard riêng. Unknown/incomplete/API unavailable dừng BARRIER_SCAN_INCOMPLETE, không chạy extraction hoặc lưu partial candidate. Summary chỉ state/reason/kind/evidence enum và counters, không raw labels/HTML/URLs.

Native XPath/layout không hard-preempt từ JS; deadline main vẫn4s và late result bị loại. Đây là giới hạn kỹ thuật, không đổi caps hoặc cho bỏ qua xác minh.

## Kiểm tra lead đã hoàn thành trên isolated snapshot

- **24/24 owner unit tests PASS**, chạy compiled `.test-build-csd-dom` của v4; đang chờ reviewer chốt thêm cases trước fresh integrated compile.
- **15/15 native cases PASS**: [overlay](lead-p02-overlay-visibility-fixture-2026-10-27.json), [layout](lead-p02-overlay-visibility-layout-regression-2026-10-27.json), [boundary](lead-p02-overlay-visibility-boundary-regression-2026-10-27.json), [candidate](lead-p02-overlay-visibility-candidate-regression-2026-10-27.json), [metadata](lead-p02-overlay-visibility-metadata-regression-2026-10-27.json). Mỗi suite3cases, output lead riêng; source network0, observer không attach, shutdown0windows/0WebContents.
- Native clear case bỏ qua3empty/1hidden và lấy1fixturecandidate. Visible second dialog/contents cótext dừng UNSUPPORTED_OVERLAY. Hidden first authfield không che recaptcha iframe thứ hai: CHALLENGE/0candidate. Đây là fixture, chưa xác định DOM node thật đã kích hoạt v3 guard.

| Snapshot đã kiểm | SHA256 |
| --- | --- |
| Source script | `c33b0169e8f6beeb54ffe80dc9d0204f03b9176402b9d54b056a1e71dc2ee6eb` |
| Source controller | `10ff1ed0ef788a22412489551c95114e6b08f3f93f1b7a42068ecf40f9aa2d24` |
| Isolated compiled script module | `4e42bacd1c96c87e2cfbeb58aaffd49e9b445635d35c5345be32ac57e7e76e4b` |
| Isolated compiled controller | `687a1f2435fbfb8157a6da5dce2fea90eb442ee3700b9e3a4fc079537be90c22` |

R-O1/R-O2/R-O3 chưa đóng ở thời điểm ghi phần này: reviewer đang kiểm expectations cũ và cases incomplete/metadata. Chờ handoff/manifest, kết luận độc lập và integrated checks trước activation. Giữ permission UNKNOWN/benchmark OFF/valid0/gates, không continuation.

## Review v4 bổ sung — một lỗi metadata cần sửa

[Handoff v4](../handoffs/p02-overlay-visibility-2026-10-27.md) và manifest lúc15:59:53Z đã chốt, **16/16owned hashes khớp**. Fixed script `292c6abfa52ba5a211dee5bc072561bb180d8763af57f9ded275410b274dc9bc`.

Reviewer fresh compile26tests: **25PASS/1FAIL**. Lead chạy lại compiled snapshot cũng25/26. R-O1/R-O2/R-O3 đã qua tests cùng inspected/hidden/empty/visible counters;16+17sentinel/128descendants/32ancestors/chung2500/time/API checks cũng đạt. Không còn repro cũ bị nới hoặc bỏ.

**R-O4 OPEN — validator nhận metadata mâu thuẫn.** Tạo result hợp lệ ACCESS_DENIED/VISIBLE/visible1/evidenceDENIED_TEXT, chỉ đổi barriers.state=CLEAR; validator vẫn nhận. Chưa có bằng chứng script tự sinh ra cấu trúc này hoặc có bypass thu nội dung (samples vẫn0). Đây là lỗi boundary validation cần sửa: quan hệ status/state/kind/evidence/count phải nhất quán hai chiều, đồng thời giữ báo cáo đúng cho challenge/denied phát hiện ở text trong FORM. Lead đã gửi owner sửa hẹp, không nới reviewer tests. Chưa nạp v4; không lặp mọi native suite nếu fix chỉ ở validator, nhưng script đổi thì kiểm phù hợp đường mới.

## Nghiệm thu sau fix R-O4 và activation

Owner sửa consistency hai chiều của status/state/kind/evidence/count, đồng thời cho literal FORM challenge/denied dùng chung quota16 và ghi VISIBLE hoặc INCOMPLETE khi hết quota. Lead đọc code/tests, fresh compile đạt60/60; sau reviewer bổ sung2cases FORM thật đã compile/test lần cuối **62/62 PASS** (metadata23, owner candidate11, candidate reviewer28). Reviewer độc lập **28/28 PASS**, source hashes ổn định; giữ expectations26tests cũ và thêm2tests staged-sample/FORM/quota15–16.

[Native overlay sau fix](lead-p02-overlay-visibility-r04-fixture-2026-10-27.json) **3/3 PASS**. Các12native regression của v4 đầu ở trên giữ bằng chứng lịch sử, không giả rằng đã chạy lại trên snapshot telemetry cuối. Unit/reviewer đã kiểm direct FORM và xóa staged samples. Manifest owner lúc16:07:59Z **16/16owned hashes khớp**. `npm run build` PASS, **129/129frozen entries khớp** trước đóng/nạp.

| Snapshot cuối được nạp | SHA256 |
| --- | --- |
| Source script | `fa32eb37704c2e87d671d1e275e96716898156e8bac5a229834e8c374f5aedd4` |
| Source controller | `4883b0cc012fb4f5c3dcc6ea738f58db63a5daf6dbd31c14fcbe412d9f09ba05` |
| Reviewer test | `519b0653071a7f19e7e9f9b1142f7098f94c1556ec28a144900204167a150b67` |
| Fixed script string | `55eb05c71a39f90f9a350ea122258b23bfe98ec0c6f86edde5173f74466c699e` |
| Compiled controller | `fdff7e8783f82b663a47d67afc05ae30750e9370a628ff63c8589edb5412feba` |
| Compiled script module | `7818921bd689c6feb6137028bf14d3127b12a007a8d17d8805948dc23002778a` |

Lead đóng root9532 theo lifecycle, xác nhận process kết thúc, rồi mở **root2460/main1511526** bằng flags đã review và cùng userData. Không kill/copy cookie hoặc nhập credentials. Sau activate, main CSD hiện đúng; Ctrl+End đã gửi. Lần refresh kế tiếp ảnh của selected window lại bị ứng dụng khác che, tương tự snapshot đầu của runtime mới. Lead dừng input để không giành focus lặp; đây không phải auth/challenge hoặc auto-approval rejection. Không lưu screenshot ứng dụng khác.

`list_windows` cuối chỉ có main1511526 trong app CSD, chưa có source window; chưa trigger diagnostic nên **0/3starts của process mới**. Latest LIVE vẫn v3 UNSUPPORTED_OVERLAY, không gán v4 đã đọc nguồn. CSD agent idle(cursor100), subagent completed. Lead lấy state mới ở lượt tiếp; khi quan sát/thao tác ổn định, mở đúng profile đã lưu, xác nhận phiên tự khôi phục, đặt query/publicfilter và một candidate read. Không cần build/rerun checks nếu hashes không đổi. Permission UNKNOWN/benchmark OFF/gates giữ nguyên.
