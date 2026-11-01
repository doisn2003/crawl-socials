# Portable Excel RC3 — 31/10/2026

Người dùng cho phép riêng nâng cấp giao diện xuất Excel theo mẫu `CSD-cafe-1000-model-selected-20261030.xlsx`, có comments, và đóng gói exe để dùng trên máy khác. Công việc cải tiến thuật toán/benchmark lớn tiếp tục tạm dừng.

## Thay đổi

- UI: phạm vi Nhóm đang xem / Tất cả bài đã thu. Cả JSON và Excel dùng cùng phạm vi; nhóm đang xem theo tab Phù hợp/Chưa phù hợp/Không phù hợp.
- Excel giữ 4 sheet Conversations, Comments, DecisionHistory, Manifest. Giữ 12 cột đầu Conversations và cấu trúc Comments của mẫu. Metadata thời gian/phiên bản mới được bổ sung phía sau; Manifest thêm số dòng xuất và phạm vi bình luận.
- Bình luận và replies chỉ thuộc các roots đang xuất, giữ comment_id/parent_id/root_post_id/snapshot_id dạng text. Chế độ ALL giữ cả bài chưa có nhãn; legacy vẫn dùng exporter hai sheet cũ.
- Tên file mặc định có ALL/SUITABLE/NOT_YET/UNRELATED để dễ nhận diện phạm vi.
- Version 0.3.0-rc.3, Windows x64 portable; giữ RC2.

## Kiểm tra

- npm run check PASS; build PASS; 885/885 unit/contract tests PASS, 0 skip/fail. Kiểm thử workbook bổ sung xác nhận header mẫu, freeze/filter và literal text.
- npm run dist:portable PASS. ASAR version đúng; 7 file UI/main/exporter/SQLite worker/conversation collector khớp byte với dist; không có root data/browser/secrets/.env trong gói.
- Mở chính portable exe thành công, UI hiện v0.3.0-rc.3, dropdown phạm vi và mô tả 4 sheet hiển thị. Không crawl, đăng nhập hoặc gọi model. Dừng điều khiển UI khi người dùng chuyển sang ứng dụng khác.
- Module exporter nguyên byte lấy từ ASAR được chạy với dữ liệu tai nghe thật, đọc lại workbook và kiểm tra comments thuộc đúng roots:

| Scope | Posts | Comments |
| --- | ---: | ---: |
| ALL | 310 | 198 |
| SUITABLE | 98 | 26 |
| NOT_YET | 172 | 143 |
| UNRELATED | 40 | 29 |

Test outputs nằm tại `%TEMP%/csd-rc3-export-W44TuY/`. Không thay dataset café gốc hoặc nhãn nguồn. Đây là kiểm tra đóng gói/xuất dữ liệu, không phải benchmark chất lượng mới; chưa thử trên máy vật lý thứ hai.

## Artifact bàn giao

`C:/Users/Admin/Downloads/CSD-Portable-0.3.0-rc.3.exe`, 102417109 bytes.

SHA256 `80eb873267cd836bd2429d150555e0816184cc53bf1ca5484ff06b69e3c10bfa`.

Hướng dẫn `C:/Users/Admin/Downloads/CSD-0.3.0-rc.3-Huong-dan.txt`.

Máy mới cần đăng nhập tài khoản riêng và cấu hình Gemini API key. Exe không chứa dataset, key hoặc cookie từ máy này. Dữ liệu CSD lưu theo máy; bộ dữ liệu đã xuất có thể copy riêng, hoặc dùng source-root picker để tái lọc collections đã copy.
