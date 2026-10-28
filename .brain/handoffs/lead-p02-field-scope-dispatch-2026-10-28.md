# P02.02 — Uncertainty theo trường, v10

Đọc ADR-012 và LIVE v9. Owner CSD agent giữ source/owner tests/isolated build; csd_adapter reviewer test/report/output riêng. Lead giữ shared dist/runtime27448/source459872/master/gates. Không worker UI/credentials.

1. Thêm đường ứng viên diagnostic thiếu temporal theo ADR-012: direct public+heading cùng cụm header không có body, single body/text độc lập và boundary đã hoàn tất. Metadata/missing reason rõ, không giả temporal/date. Temporal geometry unknown chỉ invalidate temporal record, không invalidate cả candidate nếu nhánh mới đủ proof. Body/negative/publicity/boundary vẫn bảo thủ.
2. Hỗ trợ **chỉ** CSS clip có mô hình chính xác, ưu tiên legacy rect vùng rỗng và clip-path inset vùng rỗng như native accessible-only labels. Chưa biết string CSS trên Facebook thật; không assume tất cả clip là empty. Native repro chứng minh normal text/zero clipping/partial or unsupported cases. Nếu phần này cần diagnostic bổ sung, giữ metadata tối thiểu và freeze phần có evidence; không cào raw DOM.
3. Không cần cố đọc ngày bằng epsilon hoặc pixel heuristic. V9 có temporalY/BOTH1–4px, không đủ chứng minh rounding. Giữ full-text classifier, không substring hoặc ghép bỏ whitespace; date null vẫn có ích để đọc thử body.
4. Reviewer kiểm positives optional-time+public header+single body; negatives private/ads/mixed wrappers/quote/sidebar/body public/no header cluster; unknown body/clip unsupported không leak; temporal partial không thành matched date. Kiểm schema malicious/missing enums và global/lifecycle guards. Có thể cập nhật kỳ vọng test thuộc contract temporal-mandatory cũ, nhưng ghi rõ và không sửa fixture khó để xanh.
5. Freeze source/build/hashes, handoff ngắn và reviewer kết luận để lead nạp và chạy ngay. Không mở task UI/DB/scale. Mục tiêu bước này là lấy ứng viên thật có nội dung và báo đúng trường thiếu, chưa phải benchmark.

## Review v10 lúc 01:43 ngày28/10
Reviewer63/64 PASS; R-F1/P2 visible Friends/Bạn bè trong header link/control không aria-label bị nhận optional candidate. Lead đã chạy frozen targeted case và tái hiện cả3case sai; không nạp LIVE. Owner nhận sửa main visible text/pending-control negative signals, giữ body/quote scope; reviewer chờ fix-ready để chạy lại. Failed snapshot/report lượt21 xác định hash, không gán kết quả cho source sau sửa. Runtime vẫnv9/1start.
