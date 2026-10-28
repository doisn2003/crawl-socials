# P02.02 — V9 nghiệm thu và đọc nguồn

Lead đọc source: local incomplete chỉ được bỏ qua sau traversal/normalization hoàn tất; global budget/header probe/barrier vẫn stop. Covered ngăn recheck cùng boundary. Geometry shapes giới hạn5, enum/count, không raw text/date/CSS/URL/coordinates.

Fresh compile + **71/71 candidate tests PASS** (14 owner,57 reviewer); lead native local-clip **3/3 PASS**, evidence `lead-p02-local-clip-native-2026-10-28.json`. Reviewer lượt19 đóng R-L1. **13/13 owned hashes và129/129 shared frozen entries khớp**; controller `ada22e6060613e73688e33ad6f1a85c32437e78c232a20896b8e55caf477974a`, fixed script `5f8918c463ad6d57847d5643d6c9527f4761e4bc640825fd74ca0538828e6f57`.

Đóng root22544 theo lifecycle, xác nhận kết thúc rồi mở root27448 cùng profile. Session phục hồi; không đọc `.env` hoặc nhập credentials. Source459872, query cafe Hà Nội/public filter được kiểm qua UI trước một candidate action. **LIVE v9 18:28:33.713–.766Z ngày27/10 (01:28 ngày28/10 địa phương):0samples/2015steps/7boundaries/53ms**, no cap, barriers CLEAR, fallback COMPLETE. LocalIncomplete3; xét6feed+1main. Xem [summary thật](p02-live-local-clip-v9-2026-10-28.json).

Geometry: TEMPORAL partialY/PX_1_4 count31 và BOTH/PX_1_4 count2; OTHER legacy clip6/clip-path3; thêm1invalid range. Counts là attempts, không unique bài. Cả3boundary có body còn temporal0 và header cluster0. V9 đã sửa đúng dừng batch, nhưng strict geometry + yêu cầu temporal của heuristic vẫn chưa lấy được mẫu. Không chứng minh clip1–4px là rounding hoặc Facebook block. Product contract UNBOUNDED cho published_at null; bước tiếp xét uncertainty theo trường, không nới geometry tùy tiện.

Runtime27448/source459872 giữ query/filter,1/3starts; không lặp v9. Permission UNKNOWN/benchmark OFF/verified_valid_count0, G00–G05 chưa đổi. P02.02 chưa nghiệm thu toàn task.
