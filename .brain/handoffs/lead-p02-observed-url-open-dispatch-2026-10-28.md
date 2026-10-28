# P02.02 — Nhánh mở exact observed URL

28/10/2026, Asia/Bangkok. Thực hiện [ADR-017](../decisions/ADR-017-bound-observed-post-url.md), dựa trên [LIVE v25](../evidence/p02-live-passive-aria-v25-2026-10-28.json). ARIA fix đã nghiệm thu; style SPAN/SVG D2 là hạn chế tiếp theo của presentation whitelist. Không thêm từng thuộc tính CSS để định danh permalink đã quan sát.

## CSD agent

Triển khai nhánh bounded observed URL open bằng hạ tầng search scan/binding, navigateObservedRoute và current-post reader hiện có. Proof của URL tách khỏi timestamp presentation; đọc kỹ ADR-017 trước khi sửa. GROUP_QUERY đã thấy, gồm tracking __cft__[0], là scope đầu tiên. Không tự mở rộng sang posts paths, arbitrary URLs hoặc auto-hover. Không giả lập PASS subtree; metadata có thể giữ failure nhưng nhánh URL không dùng nó làm proof identity. Eligibility cốt lõi public/header/body/unique/visible/action vẫn phải kiểm và revalidate. Nhánh placeholder giữ guards cũ.

Một fixed revalidation không click, consume binding rồi controller điều hướng đúng raw observed URL. Kiểm owner/search/generation tại dispatch, fresh main destination/route/Stop trước một reader. Không nhận URL qua menu/IPC/CLI. Hãy tái dùng interface PostRouteTarget.navigateObservedRoute và event guard hiện có, tránh dựng framework/queue mới. Current-post parser cần chấp nhận tracking đã quan sát có giới hạn; không đổi canonical identity từ tracking hoặc dựng URL mới để navigate.

Ownership: cùng production/owner tests/isolated build cũ; có thể thêm module hẹp nếu cần, handoff nêu rõ. Không shared dist/runtime/profile/.env/master/README/reviewer files. Handoff/evidence prefix p02-observed-url-open-. Freeze sau focused checks và native success + stale/invalid route/owner/Stop/redirect như cần thiết; không lặp suite không đổi.

Điều kiện nghiệm thu: decorated SPAN/style/SVG hợp lệ trong cùng header không chặn observed URL proof; placeholder/ambiguous/bad route/action/body/heading/private/hidden/owner loss/stale/limit đều zero navigation; exact href đi qua controller không sửa; một navigation/fresh reader đúng post, không click/retry. Summary không lộ href/ID/label/raw DOM. Báo core-ready để lead nạp nguồn ngay sau review.

## csd_adapter

Review thiết kế và code độc lập theo ADR-017. Ưu tiên binding→dispatch race, validator parity, query tracking/identity, lifecycle và no raw data trong summary. Gửi concern sớm cho lead; chuẩn bị focused tests song song nếu không tranh file. Chỉ tests/evidence/isolated output, không production/runtime/status. Khi owner freeze chạy final kiểm đủ rủi ro thay đổi, không kiểm rộng phần không đổi.

## Lead/runtime

Giữ v25 PID19440/main591142/source2098306, query cafe Hà Nội/public filter,1/3starts đã dùng. Không thử lại bản cũ cùng state. Sau freeze: đọc code/hash/check, reviewer final, shared build và nạp giữ profile, chạy một source diagnostic nhỏ. Chỉ sau source open/read thành công mới bước tối đa5candidates/continuation; vẫn chưa benchmark hoặc PASS gate.

## Review thiết kế ban đầu

Reviewer chỉ ra resolveVerification.navigateObservedRoute hiện ràng buộc current page cùng post/canonical hint. Lead đã chuyển concern cho main: search→exact tracked URL phải có capability hẹp riêng hoặc mode rõ, không bỏ guards của verifier cũ. Kiểm owner/search URL/document generation và Stop tại loadURL sau await revalidation. Parser fixed/main/destination thống nhất duplicate/encoded keys/length; giữ exact URL riêng khỏi normalized identity, không đưa raw URL vào public scan/summary. Đây là điều kiện triển khai trong ADR-017, không thêm phạm vi nguồn.

## Review sơ bộ và sửa trước freeze

Reviewer báo 8 focused checks PASS nhưng R-URL1 (P2): descendant `role="menuitem"` còn được nhận trong URL target, vi phạm loại action controls. Lead đã gửi main sửa semantic guard cho interactive ARIA roles và chạy focused regression trước freeze; không mở rộng kiểm style. [Review/repro](../evidence/adapter-p02-observed-url-open-review-2026-10-28.md). Main đang triển khai; reviewer đã kết thúc lượt sơ bộ và chờ fix/freeze để nghiệm thu. Native success hiện là FIXTURE, chưa có LIVE open→read của nhánh URL mới; runtime vẫn v25, gates và valid count giữ nguyên.
