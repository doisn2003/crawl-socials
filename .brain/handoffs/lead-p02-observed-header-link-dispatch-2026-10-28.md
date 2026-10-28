# P02.02 — Mở link bài thật trong header công khai

28/10/2026, Asia/Bangkok. Tiếp tục ADR-016 từ [ba lượt LIVE v22](../evidence/p02-live-search-preflight-v22-2026-10-28.json). Không đợi grant/login hoặc mở rộng hạ tầng.

## Bằng chứng và hướng chọn

Lượt đầu thấy placeholder BLANK, media predicate FAIL, viewport FAIL. Lead cuộn UI hai lần650px để đưa header đã quan sát vào viewport. Lượt thứ hai dừng UNSUPPORTED_OVERLAY vì toast khôi phục Internet; lead đóng toast bằng UI. Lượt thứ ba49ms/1931steps/7examined: ba header công khai, một link OBSERVED_POST có target ABSENT, viewport/visibility PASS và header COLOCATED; không nhận được temporal text và media predicate FAIL. Hai placeholder BLANK còn lại vẫn ngoài viewport. Tất cả0click/read, không có auth/challenge/deny.

Ưu tiên link bài thật hiện hữu trong header. Chưa nới BLANK/new-window policy. Predicate media hiện gộp img/svg/video/canvas/picture/headings nên chưa biết phần tử thực là gì; không khẳng định SVG là nguyên nhân LIVE khi chưa có subtype evidence.

## CSD agent — production + owner tests

1. Thêm proof riêng `UNIQUE_HEADER_POST_LINK`: một link bài nhóm thuộc href classifier đã có, nằm trong header được chứng minh công khai, đúng body/root/header, vượt mọi guard và duy nhất trong header. Khi không có temporal text, không gán LABEL/VISIBLE_TEXT hay bịa published_at. Không dùng link body/ảnh/comment/author/group title; không dùng URL suy đoán.
2. Thay blanket media rejection bằng phân loại subtree hẹp, có ngân sách: NONE, SVG_TEXT_ONLY, MEDIA, HEADING, SVG_OTHER/UNSUPPORTED, INCOMPLETE (tên có thể chọn tương đương). SVG_TEXT_ONLY chỉ được chấp nhận khi chứng minh inline SVG hiển thị chữ, với whitelist cấu trúc/thuộc tính tối thiểu; không external references, image, foreignObject, nested link/control, interactive/media/unknown content. Không bỏ chặn toàn bộ SVG. Bounded subtype facts phải xuất hiện kể cả record bị loại trước để lượt LIVE tiếp theo giải thích được nguyên nhân; không raw markup/text/href/IDs/coords.
3. Giữ click native đúng node đã bind; target policy hiện hành ABSENT/EMPTY/SELF, popup deny, stale/owner/budget/Stop/auth/challenge guards giữ nguyên. Không sửa target attribute, tự điều hướng URL thay click hoặc thêm scroll/hover/retry. Tối đa1click/1fixed read; chứng minh route thật cùng owner trước đọc. SVG classification phải tiêu ngân sách chung1s/2500steps, dừng incomplete không cấp action.
4. Kiểm complete discovery→click với unique observed post+SVG text, thay node/href/subtree giữa hai lần, hai link mơ hồ, SVG/media/control giả, ngoài viewport/geometry unknown, budget và Stop. Thêm native fixture có SVG text thật; không chỉ mock querySelector. Nếu phải thay schema/fixtures thì cập nhật đồng bộ và freeze.

Ownership: src/main/facebook-search-post-open-script-hooks.ts, facebook-search-post-open.ts, facebook-public-candidate-fields.ts và script/fixture/index tích hợp cần thiết; tests/facebook-search-post-open.test.ts; scripts/facebook-public-candidate-smoke.mjs nếu cần case mới. Build riêng .build-csd-dom, tests .test-build-csd-dom; handoff/evidence prefix p02-observed-header-link-. Không sửa reviewer tests, shared dist, profile/.env, master/README/gates.

## csd_adapter — kiểm độc lập

Chuẩn bị repro/test đầy đủ cho unique observed link và bounded inline SVG text; rà phân biệt media/author/action với timestamp link. Test cấu trúc giả có img/foreignObject/use external/nested links/heading/control/unknown tags, ambiguity, mutation, budget deadline/cap và no popup-policy expansion. Chỉ sửa reviewer tests/evidence và output .test-build-adapter-candidate; không production/UI/runtime. Phối hợp owner về interface, kiểm freeze thực tế trước báo core-ready. Không cần lặp toàn bộ test không liên quan.

## Lead

V22 đã nghiệm thu R-PF1, reviewer38checks/4native PASS; lead17owner+2repro/3native PASS và26owned/135frozen hashes khớp. Runtime26544/main6358074/source2887068 đã dùng3/3starts. Giữ profile/source hiện hữu, không restart bản cũ để tăng lượt. Sau freeze mới, lead review/build/nạp và thử một lượt khi header visible; nếu subtype chưa được hỗ trợ, dùng facts thật để sửa hẹp tiếp. Permission UNKNOWN, benchmark OFF, valid0 và gates không đổi. Mục tiêu trước mắt là một search→post→read tự động, rồi pilot tối đa5.
