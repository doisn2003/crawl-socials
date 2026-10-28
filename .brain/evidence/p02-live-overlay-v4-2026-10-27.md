# P02.02 — LIVE v4 đã qua preflight, thiếu tín hiệu thời gian

Ngày 2026-10-27. Runtime 2460, main 1511526, source mới 6492758. Không rebuild hoặc lặp tests trên snapshot đã nghiệm thu. Sau một lần lỗi capture `no screenshot targets found`, lead chọn lại cửa sổ và lấy được trạng thái đúng; các thao tác tiếp theo quan sát được bình thường. Profile CSD Facebook tự khôi phục, không nhập credentials. Query `cafe Hà Nội`, bộ lọc **Bài viết công khai** đã áp dụng; UI có bài và ngày giờ trong header, không có challenge/dialog/deny nhìn thấy. Không lưu ảnh hay nội dung bài trong repo.

## Kết quả thật

- Run `candidate-138260b6-e014-4180-822d-0aafad399196`, schema 4, LIVE, 2026-10-27T16:28:40.654Z → .723Z (69 ms), actions 1.
- **NO_PUBLIC_CANDIDATE**, 0 ứng viên. Đã vượt preflight: barriers CLEAR, inspected 2, hidden 2, visible 0, không overflow. Đây là evidence v4 trên lần chạy này; không chứng minh chính hai node này gây v3 dừng trước đó vì DOM/kết quả đã thay đổi.
- MAIN_FALLBACK / SEARCH_TOP_MIXED, visited 1151, examined 7 (6 feed +1 main article), pruned 164; không chạm node/time/candidate/boundary cap.
- Rejection: NO_HEADER 4, **NO_TEMPORAL 3**. Ba vùng có heading/message; hai vùng có public label. Message alias đã gộp, không AMBIGUOUS_BOUNDARY. Header clusters 0, ancestorLimits 3; temporal hints đều 0.
- Summary nguyên bản đã làm sạch: [JSON](p02-live-overlay-v4-2026-10-27.json), SHA256 `3240d22e0fd3a9b561633771872019dd3aed264f25e8fe1d2966855093d0a6fa`. Payload rỗng nằm ngoài repo, không đọc/dump; SHA256 `9bf24631b57ea6860a40a00236d22ccb056f1830c2a23af8f25eb4e887875312`.
- Fixed script `55eb05c71a39f90f9a350ea122258b23bfe98ec0c6f86edde5173f74466c699e`; compiled controller `fdff7e8783f82b663a47d67afc05ae30750e9370a628ff63c8589edb5412feba` khớp snapshot nghiệm thu.

## Chẩn đoán và bước tiếp

Code hiện nhận TIME/ABBR hoặc A có aria-label/title temporal; text temporal chỉ được nhận nếu **parent trực tiếp là A**. Nested span/text split hoặc role-link là những khoảng trống có thể tái hiện bằng fixture. Đồng thời BUTTON/role=button bị prune trước kiểm temporal. Chưa biết trường hợp nào là DOM thật của ngày giờ đang nhìn thấy; không ghi chúng thành kết luận nguồn. `header.ancestorLimit` cũng chưa chứng minh cần tăng cap.

Giao [sửa temporal trong header và đo shape tối thiểu](../handoffs/lead-p02-header-temporal-dispatch-2026-10-27.md). Giữ source hiện tại, 1/3 starts đã dùng, không đọc lặp build v4. Permission UNKNOWN, benchmark OFF, verified valid 0, G00–G05 chưa đánh giá; không continuation.
