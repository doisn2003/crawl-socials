# P02.02 — Review eligibility diagnostics và sửa R-SO3 (v20)

28/10/2026, Asia/Bangkok. Theo [dispatch](../handoffs/lead-p02-search-target-diagnostics-dispatch-2026-10-28.md) và ADR-016. Trạng thái: nghiệm thu code PASS; một LIVE đã thực hiện, chưa có click/read.

## Code và kiểm chứng độc lập

Lead đọc hook, validator, vị trí hook trong scan và fixture wiring. Bản sửa lọc href/action/header không phù hợp trước `visibleSignal`, tránh làm hỏng visibility state của timestamp khác. Timestamp có thể được click vẫn chịu geometry guard cũ; `openVisibilityInvalidated` chỉ ghi nguồn invalidation, không reset `visibilityUnknown`. Default search/current-post scripts giữ hash đã nghiệm thu. Metadata chỉ counter/enum/boolean, tối đa 5 shapes; schema version 2, validators từ chối field/raw value/enum ngoài contract và kiểu dữ liệu sai. Counters mô tả records, không phải số bài duy nhất.

- Compile riêng + 13 tests search-open PASS, gồm lifecycle, owner/route change, Stop/late result, guard và metadata validation.
- Ba native checks độc lập PASS: group-geometry, timestamp-geometry, shape-cap. Link nhóm có 18 rects bị loại ở href, timestamp hợp lệ vẫn mở 1 lần/đọc 1 lần. Timestamp thật có 18 rects không click/read, ghi TARGET_VISIBILITY. Shape cap không đổi hành vi action. Network requests 0.
- `npm run build` PASS; 27 owned file hashes và 135 frozen artifact/input hashes khớp. Controller SHA-256 `6efb4afac58afc02f75bca753f199e1676640566909bd1e300571d0a6656e6de`.
- Default scripts và controller reader không đổi; không lặp toàn bộ các regression đã đạt chỉ để tăng số test.

Evidence: `lead-p02-search-target-{group-geometry,timestamp-geometry,shape-cap}-2026-10-28.json`, [owner manifest](p02-search-target-files-2026-10-28.json). Lead đã gọi `csd_adapter` kiểm độc lập từ freeze; chưa nạp runtime mới hoặc chạy LIVE ở thời điểm viết mục này.

R-SO3 là lỗi code đã tái hiện và được sửa; chưa đủ bằng chứng quy nó thành nguyên nhân LIVE v19. Gate, valid count và benchmark giữ nguyên.

## Reviewer final và LIVE

Reviewer [PASS](adapter-p02-search-target-diagnostics-review-2026-10-28.md): 26 checks (13 reviewer/13 owner), 3 native, 27 owned/67 copied native hashes khớp; R-SO3 CLOSED. Lead đã đọc các assertion độc lập về first rejection, redaction, shape cap và Stop. Không còn blocker trước khi nạp v20.

Lead đóng CSD bình thường, nạp build mới, profile đăng nhập được giữ; runtime13492. Run `candidate-724cc3de-d19a-4263-a355-31511ea48c11`, 23:13:04.008–04.059Z, **51 ms / NO_ELIGIBLE_TIMESTAMP**. Có 2 qualified headers/6 records: HREF rejected4, NOT_LINK2, visibility unknown0, click/read0.

Đối chiếu accessibility cùng source: hai timestamp là same-origin/same-path search placeholders với fragment dạng `^#\?[a-z]{3}$`, bị blanket `u.hash` guard loại. Đây là dữ liệu mới đủ giao sửa classifier hẹp; không gọi Facebook chặn. [Evidence sạch](p02-live-search-target-v20-2026-10-28.json), [dispatch patch](../handoffs/lead-p02-search-placeholder-fragment-dispatch-2026-10-28.md). Runtime13492/main987044/source11337892,1/3starts; không chạy lại bản cũ.
