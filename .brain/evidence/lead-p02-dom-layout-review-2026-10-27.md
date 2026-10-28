# P02.02 — Lead review layout / marker / header v3

Ngày 2026-10-27. Theo [dispatch](../handoffs/lead-p02-dom-layout-dispatch-2026-10-27.md) và [handoff owner](../handoffs/p02-dom-layout-2026-10-27.md). **V3 đã nghiệm thu code trong phạm vi kiểm, nạp cùng profile và chạy LIVE; run dừng ở UNSUPPORTED_OVERLAY trước khi đọc bài**, xem [evidence thật](p02-live-dom-layout-v3-2026-10-27.md). Runtime9532/main3084798/source1511160. Lỗi tiềm năng của overlay predicate được giao sửa; chưa nghiệm thu nguồn.

Lead đọc candidate script, controller/validator, fields, native fixture, isolated build và smoke runner. Các thay đổi tập trung vào wrapper-through khi zero rect, kiểm Range cho text trực tiếp dưới wrapper, nhóm nested marker theo chuỗi DIV/SPAN không có material riêng, header cluster hữu hạn thay guard depth6. Giữ guards restricted/ad ngoài body, embedded/comment/sidebar, identity/null/missing fields, stop/late result, local-only payload và bounded output. Summary v3 chỉ counts/booleans/enums; không CSS/class/HTML/body/permalink.

Native fixture `display:contents` chứng minh một trường hợp predicate cũ bỏ descendants hiển thị. Chưa chứng minh DOM Facebook dùng kiểu này. Header cluster và alias vẫn heuristic; sample không thành verified public/valid. Handoff nói rõ ancestorLimit có thể true khi cluster gần đủ, không được hiểu đã xác minh toàn boundary.

## Kiểm chứng của lead trên snapshot code-ready

- [Manifest owner](p02-dom-layout-files-2026-10-27.json) lúc15:36:50.955Z: **15/15 owned hashes khớp**.
- Fresh compile `.test-build-lead-candidate/tsconfig.json`: PASS. **44/44 tests PASS** (metadata owner14 +reviewer9; candidate owner9 +reviewer12 regression ở thời điểm compile).
- Native **12/12 cases PASS**, output riêng của lead: [layout](lead-p02-dom-layout-fixture-2026-10-27.json), [boundary](lead-p02-dom-layout-boundary-regression-2026-10-27.json), [candidate](lead-p02-dom-layout-candidate-regression-2026-10-27.json), [metadata](lead-p02-dom-layout-metadata-regression-2026-10-27.json). Mỗi suite3cases; không source network, không attached observer; shutdown0windows/0WebContents.
- Source script SHA256 `c29df29aecbbf5d5f9a017ced43ffdd5fe0082d3d08b4869af26540bf775f025`.
- Source controller SHA256 `b84b43b6313d6a8944a245ce051395e1296aa5f5be97cf43a573a234efea1f11`.
- Fixed script SHA256 `0c820ada5aaf8259d6ae2657f9d493217179827044507e9a583f2969eeef7b03`.
- Isolated compiled controller SHA256 `1e7e54afa3979ee914173b9fd55042b6b6baf86ccccf70600ba27e3cb7b3b63b`.

## Kết quả kiểm cuối trước activation

Reviewer bổ sung5cases v3, [17/17 tests PASS](adapter-p02-public-candidates-review-2026-10-27.md), source hashes ổn định. Lead compile lại sau các tests mới: **49/49 PASS**. `npm run build` PASS; **129/129 frozen entries khớp** và compiled controller/script trùng isolated snapshot đã kiểm. Reviewer test SHA256 `3769c87d8422cdc05f196671ebf24d4b0e039d51b22398269051d15b4be7af67`.

Đóng app theo lifecycle, chờ root22308 kết thúc (launch guard đã ngăn mở instance khi process chưa thoát), rồi mở root9532 cùng profile. LIVE32ms dừng UNSUPPORTED_OVERLAY,visited0. Đây là khoảng trống fixture của guard `walkable` cho overlay; không coi49tests đạt là bằng chứng nguồn đạt. [Dispatch sửa](../handoffs/lead-p02-overlay-visibility-dispatch-2026-10-27.md). Permission UNKNOWN, benchmark OFF, G00–G05 NOT_EVALUATED, chưa continuation.

## Regression bổ sung sau LIVE: chưa chấp nhận v3 cho lượt đọc tiếp

Reviewer thêm4tests overlay trên snapshot v3,21tests tổng18PASS/3FAIL; lead chạy lại compiled reviewer snapshot và xác nhận cùng3failures. R-O1 empty boxless alert tựblock; R-O2 hidden ancestor không được xét khi jump preflight; R-O3 hidden first match che visible second match. Test visible overlay thật vẫn PASS. Các49tests trước không bao phủ các case này; không ghi đè lịch sử PASS hoặc gọi bản v3 đã hoàn tất nguồn. Xem chi tiết/repro trong dispatch overlay và report reviewer. Owner đang sửa, runtime9532 được giữ, không thử lại nguyên build.
