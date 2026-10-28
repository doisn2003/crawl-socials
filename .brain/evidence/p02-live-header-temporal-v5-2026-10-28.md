# P02.02 — LIVE v5 vẫn thiếu temporal, đã có dấu vết giới hạn cụ thể

Ngày 28/10/2026 giờ Asia/Bangkok. Người dùng đã nhường chuột/bàn phím để tiếp tục. Cửa sổ main được tool báo minimized; lead restore qua API rồi mở profile đã lưu. Facebook tự khôi phục session, không nhập credentials. Runtime6680/main2557138, source mới724678. Query `cafe Hà Nội`, public filter đã áp dụng; UI hiển thị post, ngày đăng và biểu tượng công khai. Không challenge/auth/deny nhìn thấy.

- Run `candidate-9e5f7b31-726a-45d6-920e-978dce8c0f54`, schema5/LIVE, UTC 2026-10-27T17:13:39.244Z → .304Z (60ms; địa phương 00:13:39 ngày28/10).
- **NO_PUBLIC_CANDIDATE**, 0 ứng viên; barriers CLEAR, inspected2/hidden2/visible0. Đã dùng1action và1/3starts của runtime.
- MAIN_FALLBACK/SEARCH_TOP_MIXED, visited2108/examined7/pruned138; không chạm global node/time/boundary/candidate cap. NO_HEADER4, NO_TEMPORAL3. Header clusters0/ancestorLimits3.
- Temporal: roleLinks5/links0, matches0/unmatched5, **textLimits2, ancestorLimits4**, controlSkipped24/probeNodes0. Hai vùng có heading +public +message nhưng không temporal. Các counters là attempts, không unique bài hoặc lý do chi tiết từng record.
- V5 đã cho thấy giới hạn local đang gặp trên nguồn thật; `textLimits` hiện trộn giới hạn record/chars/text nodes nên chưa biết nhánh nào đã kích hoạt. Không kết luận ngày thật chắc chắn bị cap16 nodes, cũng không kết luận Facebook chặn hoặc hết dữ liệu.
- Đối chiếu accessibility có giới hạn theo chuỗi ngày trên UI không tìm được một node chứa nguyên chuỗi; chỉ ghi count0, không dump tree/labels. Không suy từ AX sang DOM cụ thể.

[Summary nguyên bản](p02-live-header-temporal-v5-2026-10-28.json), SHA256 `25dc2f0f233ce5cc04e659be7b390ed591df7f7999b2e50cf797ab23079dae08`. Payload rỗng không đọc/dump, SHA256 `387f749f07add3d0ffba969131ac3cc4f45f14c4f98986e6561d762fcede3a0d`. Script `31ace7d597525c40bcba193762109f5e308a8d7d3774b57b4589f3786f7260c2`, compiled controller `76cbbb7e632eb8388d0ac0d6e89ba5e450e7bdb74e3ccb18b6edc9510276469b` khớp bản nghiệm thu.

Code có sẵn WeakMap temporalScopes đi theo traversal nhưng `collectTemporal` vẫn dùng tối đa8ancestor để tìm record, chỉ dùng scope map để vô hiệu record khi tìm không tới. Có thể dùng chính scope đã xác định trong walk để thu sâu mà không chạy ancestor search mới hoặc nới global cap. Đây là hướng sửa có căn cứ code; chưa xác nhận đủ giải quyết timestamp thật. Xem [dispatch](../handoffs/lead-p02-temporal-scope-dispatch-2026-10-28.md).

Giữ runtime/source/query/public filter, không chạy lại buildv5. Permission UNKNOWN/benchmark OFF/valid0, gates giữ nguyên, chưa continuation. Nội dung bài đầu là dạng tuyển dụng liên quan quán; không coi keyword hit là bài đã đạt yêu cầu relevance.
