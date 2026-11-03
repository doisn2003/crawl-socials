# CSD rebuild — bảng thực hiện

Ngày cập nhật: 03/11/2026. Quyết định chi tiết: [ADR-025](decisions/ADR-025-cost-controlled-csd-rebuild.md).

Người dùng chọn Gemini 2.5 Flash-Lite. Nhánh tích hợp hiện hành là `codex/csd-rebuild`; nền RC7 giữ ở tag `csd-next-rc7-20261103`.

| Chặng | Trạng thái | Nhánh khi bắt đầu | Đầu ra |
|---|---|---|---|
| R0 | COMPLETE | codex/csd-rebuild | Kế hoạch, Git, baseline, metadata model |
| R1 | IMPLEMENTED — offline verified | codex/csd-r1-cost | 2.5 mặc định; sổ SQLite dùng chung USER/DEVELOPMENT, dự phòng bền vững, trần tiền/ngày/call; 23 kiểm thử gateway/guard đạt, 0 gọi API thật |
| R2 | IMPLEMENTED — offline verified | codex/csd-r2-raw | OFF không khởi tạo model; mục tiêu chung, thứ tự nhận bền vững và phần vượt; AI dừng không chặn crawl mới; 47 kiểm thử pipeline/config đạt |
| R3 | IMPLEMENTED — offline verified; profiling nguồn thật còn chờ | codex/csd-r3-windows | Mỗi query có task/window/checkpoint, lát 3 trang, pool chung đo RAM/CPU; 12 kiểm thử điều phối/frontier đạt, gồm 8 query × 2 mạng |
| R4 | IMPLEMENTED — policy/cache offline verified; precision chưa đo | codex/csd-r4-standard | Một batch ngắn, nhận DIRECT/PLAUSIBLE, chứng cứ bắt buộc, cache theo nội dung/mục tiêu/model; một mở rộng query có kiểm soát; cảnh báo thiếu chỉ tiêu; 21 kiểm thử liên quan đạt |
| R5 | PLANNED — sau R4 | codex/csd-r5-quality | Kiểm định chọn lọc, xử lý bất đồng |
| R6 | PLANNED — sau R3/R5 | Nhánh ứng viên tạo khi cần | Đo chất lượng/chi phí và bàn giao người dùng thử |

Ngân sách inference phát triển hiện được phép trong lượt kế hoạch: **0 USD**. Các hạn mức live thử nhỏ trong ADR là đề xuất chưa được cấp. GET metadata trả 200, nhưng generation access/billing chưa được thử.

Ưu tiên bàn giao đường thu miễn phí ở R2 trước. Không chờ đủ toàn bộ engine mới cho người dùng dùng crawler. UI ba mức lọc không dùng chung ý nghĩa với ba mức tốc độ của RC7.

Không bỏ dữ liệu gốc, không phân bổ tỷ lệ theo mạng, không tự tăng model khi lỗi, không dùng số lượng tests PASS để thay cho chất lượng bài thu được.
