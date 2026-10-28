# P02.02 — LIVE v6 xác định char/text-node limits nhưng vẫn 0 ứng viên

Ngày28/10/2026 giờ Asia/Bangkok, sau [review v6](lead-p02-temporal-scope-review-2026-10-28.md). Runtime20188/main1511604/source6361794, phiên tự khôi phục; query `cafe Hà Nội` và public filter xác nhận. Không nhập credentials hoặc thao tác challenge.

- Run `candidate-8652cc25-70fa-4cfe-b33e-c0f6ddbc23ae`, schema6/LIVE, UTC2026-10-27T17:33:04.772Z → .833Z (61ms), địa phương00:33:04 ngày28/10.
- **NO_PUBLIC_CANDIDATE**,0samples, actions1; CLEAR/inspected2/hidden2/visible0. MAIN_FALLBACK/SEARCH_TOP_MIXED, visited1089/examined7/pruned150, không global cap.
- NO_HEADER4/NO_TEMPORAL3. Temporal roleLinks5/unmatched5, **charLimits2/textNodeLimits2**, recordLimits0/probeLimits0, scopeMisses5/emptyText1/classifierMisses2, controlSkipped29/probeNodes0. Header clusters0/ancestorLimits3.
- V6 loại sự phụ thuộc8ancestor của text collector; lần này ghi rõ hai attempts vượt96chars và96textnodes. Counters không unique bài. DOM/kết quả đầu thay đổi so với v5; không dùng giảm node visits để kết luận cải thiện yield.
- Chưa có bằng chứng date thật chứa>96ký tự hiển thị. Có thể record đang chứa text không phải ngày hoặc predicate text visibility nhận quá rộng; cần kiểm code/fixture và geometry counts, không tự nâng cap lần nữa.

[Summary nguyên bản](p02-live-temporal-scope-v6-2026-10-28.json), SHA256 `8bf3140de12cecd1726f7c89b54fc4b252f67d66d8b600a289187c3b3c923b79`. Payload rỗng ngoài repo, không đọc/dump; hash `34b31390b33b184efcf0eb6518304a7e835eb36de9b8cf198c5cf81013be335c`. Script `cde0d7ac60865910ba4d5eddae5252542a6ba67eb99b7734d6dca474130cb462`, controller `3173cd4847594a8c4d153a6e76e9a0942cd394ff6bb028deeef3ccdc4396b15f` đúng snapshot nghiệm thu.

Code hiện `visibleText` coi text là visible ngay khi parent có bất kỳ client rect; `layout` cũng coi rect count>0 là RENDERED, kể cả rect zero-area. Một parent có box không chứng minh text node có glyph/area hiển thị. Đây là lỗ hổng predicate có thể tái hiện độc lập; chưa khẳng định nó là nguyên nhân duy nhất trên Facebook. [Dispatch kiểm text visibility](../handoffs/lead-p02-text-visibility-dispatch-2026-10-28.md).

Giữ runtime20188/source6361794/query/public filter,1/3starts; không đọc lặp v6. Permission UNKNOWN/benchmark OFF/verified valid0, gates giữ nguyên.
