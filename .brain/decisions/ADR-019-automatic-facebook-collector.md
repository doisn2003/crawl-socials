# ADR-019 — Tiếp tục collector tự động từ nguồn đã quan sát

2026-10-28, 10:58:33 Asia/Bangkok. User trực tiếp yêu cầu thực hiện collector-continuation-prompt.md. Chỉ thị mới thay trần 2 search/2 scroll/5 continuation/60 phút của ADR-018; không khởi động worker/automation cũ. Meta permission vẫn UNKNOWN.

Nhánh mới feature/facebook-collector từ main 7bbc231. Kế thừa có chọn lọc parser 89c844f; bảo toàn các tài liệu user đang sửa và dataset 5 bài cũ. Bộ thu ưu tiên JSON nhúng + response do browser tạo; code tự tìm/cuộn theo yield. Chỉ dùng request continuation khi operation/cursor thực được quan sát và xác minh là đọc; không đoán doc_id.

Mỗi run có config và output riêng, deadline, query/scroll/record cap, concurrency 1; stop khi account barrier, lỗi persistence, hết deadline, hết nguồn hoặc không tiến bộ. Pilot đầu giới hạn 15 phút/2 query/6 scroll mỗi query, rồi điều chỉnh theo dữ liệu mới để hướng tới 100 và kiểm 1.000/24h khi ổn định. Không retry vô hạn hoặc mua/đổi account/proxy. Persist batch trước checkpoint, dedup từ file qua restart; null có lý do, source khác author, platform permission khác chất lượng dữ liệu.

Nghiệm thu theo link/metadata thật, tự chạy và resume; tests chỉ kiểm hồi quy. Không nhận những kết quả đa query là bằng chứng continuation cùng query. Nếu chưa đủ tiêu chí, giữ checkpoint/evidence, quay main và rebuild đúng main. Không push/publish.
