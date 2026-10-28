# P02.02 — Nghiệm thu fragment placeholder và LIVE v21

28/10/2026, Asia/Bangkok. Theo ADR-016 và [dispatch](../handoffs/lead-p02-search-placeholder-fragment-dispatch-2026-10-28.md).

## Nghiệm thu code

Lead đọc classifier và native fixture. Chỉ nhánh placeholder cùng origin/path chấp nhận fragment `^#\?[a-z]{3}$`; post-route có fragment, anchor khác, query ngoài phạm vi vẫn bị loại. Không thay href/node binding, controller hay guard khác.

- Compile riêng + 14 focused tests PASS.
- Ba native tests độc lập PASS: fragment positive mở 1 bài/đọc 1 lần; fragment đổi trên cùng node trả STALE_TARGET và không click; post-route fragment bị HREF reject. Không external request.
- Build PASS; 27 owned hashes/135 frozen hashes khớp owner manifest. Default search/current-post script hashes và controller hashes không đổi; chỉ DISCOVER/CLICK strings chứa classifier mới.
- Reviewer [PASS](adapter-p02-search-placeholder-fragment-review-2026-10-28.md): 30 checks, 3 native, 27 owned/67 copied build hashes. Không blocker. Lead giữ nguyên profile khi graceful restart và nạp v21.

## LIVE

Run `candidate-319916c1-adca-4c6e-b9d0-d775fa0b65b3`, 23:21:18.187–18.247Z: **60 ms, NO_ELIGIBLE_TIMESTAMP**. 2.009 steps/7 examined, 2 qualified public-group headers. Sáu records gồm 2 HREF rejected, 2 placeholder accepted, 2 NOT_LINK. Hai placeholder đều dừng tại **NEW_WINDOW**, 0 click/read, visibility uncertainty0. Các điều kiện sau target guard chưa được đánh giá.

Fragment fix đã có tác dụng trên nguồn thật. NEW_WINDOW ở đây là tên guard cho thuộc tính `target` không thuộc empty/`_self`; chưa xác định `_blank`, `_top`, `_parent` hay named target. Không gọi đây là popup thật, Facebook deny hoặc tài khoản bị chặn. Native BrowserHost vẫn deny popup.

[Evidence sạch](p02-live-search-fragment-v21-2026-10-28.json). Giao [target preflight](../handoffs/lead-p02-search-target-preflight-dispatch-2026-10-28.md) để quan sát target category và các điều kiện còn lại trong một lượt, giữ hành vi action. Runtime22252/main4723190/source4917500, search công khai `cafe Hà Nội`,1/3starts. Không lặp run cũ. Valid0, benchmark OFF, permission UNKNOWN, gates giữ nguyên.
