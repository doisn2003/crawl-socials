# P02.02 — Chấp nhận dạng fragment placeholder đã quan sát

28/10/2026, Asia/Bangkok. Tiếp nối ADR-016, giữ phạm vi một timestamp click và một post read. Không mở pilot/continuation trong patch này.

## Evidence nguồn thật

[V20 LIVE](../evidence/p02-live-search-target-v20-2026-10-28.json): 51 ms, 1.865 work steps/7 examined, 2 qualified public-group headers; 6 records gồm 4 bị loại ở HREF và 2 NOT_LINK. Không có target visibility uncertainty, không click/read. Lỗi R-SO3 đã sửa nhưng không giải thích lượt v20 này.

Lead đọc accessibility của chính hai header sau run: mỗi header có một group-title link và một timestamp cùng origin `www.facebook.com`, path `/search/top`, query keys `__cft__[0]`, `__tn__`; hai timestamp có fragment khác nhau nhưng cùng dạng `^#\?[a-z]{3}$`. URL lengths 268/266; tracking value lengths dưới giới hạn đang dùng. Base search có q/filters, cùng origin/path. Không lưu raw URL/ID/tracking value vào `.brain`.

`classifySearchTimestampHref` hiện từ chối mọi `u.hash` trước khi xét placeholder. Đây là điều kiện cụ thể loại các timestamp đang hiển thị; chưa chứng minh hết mọi lỗi phía sau điều kiện này. Hai group-only links bị loại đúng.

## CSD agent

Sửa hẹp classifier: cho phép đúng fragment family đã quan sát trên placeholder có cùng origin/path tìm kiếm và toàn bộ điều kiện hiện hành. Tiếp tục từ chối fragment trên post route, `#target`, fragment khác dạng, external origins, query ngoài allowlist hoặc vượt giới hạn. Không strip href để né stale check; giữ nguyên node/href binding và một native click. Không load placeholder URL hoặc suy ID/permalink.

Thêm classifier và native fixture với fragment cùng cấu trúc (giá trị synthetic), kiểm positive click/read và negative anchors/post fragments/bad shapes. Giữ visibility/header/menu/author/Stop/barrier guards. Không cần lặp toàn bộ suite không thay đổi. Freeze manifest/handoff `p02-search-placeholder-fragment-*` để lead review và thử đúng một lần nguồn thật. Không sửa shared dist, runtime, profile, `.env`, master, README hoặc reviewer tests.

## csd_adapter

Review phạm vi href classifier và node binding, kiểm repro trước/sau cùng negative boundaries. Chỉ sửa reviewer tests/evidence và build riêng. Không phỏng đoán sửa URL là đã đủ thu bài; chờ LIVE. Worker đã được gọi tiếp tục sau khi kết thúc review v20.

## Lead

Runtime 13492; main 987044; source 11337892; search công khai `cafe Hà Nội`, 1/3 combined starts. Sau freeze/review nạp bản mới, bảo toàn profile, một diagnostic mở bài. Nếu còn fail, dùng first rejection mới để giao sửa cụ thể; không lặp run cũ. Permission UNKNOWN, benchmark OFF, valid0 và mọi gate giữ nguyên.
