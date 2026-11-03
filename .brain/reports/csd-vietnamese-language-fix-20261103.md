# R8 — sửa phạm vi ngôn ngữ cho bộ lọc CSD

Ngày 03/11/2026. Bản chạy **0.4.0-rebuild.3**. Người dùng đã xác nhận: **nội dung tiếng Việt, kể cả người Việt ở nước ngoài**.

Đã sửa cấu hình và bộ lọc trong app, đồng thời tạo bản sửa của toàn bộ tập R7 bằng dữ liệu đã có. Cả bốn bài tiếng Nhật được báo đều chuyển thành `NOT_SUITABLE / CONTENT_LANGUAGE_MISMATCH`. Không gọi lại LLM, không crawl thêm và không phát sinh phí AI.

## Tại sao bốn bài đã lọt?

Kế hoạch R7 có `languages: []`; bộ lọc xét chủ đề/vai nhưng không có điều kiện tiếng Việt bắt buộc. Đây là thiếu sót ở việc chốt và thực thi phạm vi. Lý do ngắn đã lưu trong kết quả, theo thứ tự bốn bài người dùng gửi:

| Bài | Lý do model đã lưu | Vấn đề |
|---|---|---|
| Giáo viên kể việc học sinh luyện ở nhà | Câu chuyện về học viên và quảng bá lớp piano; DIRECT | Không kiểm tra ngôn ngữ trước khi nhận |
| Bài về Hanon/Czerny và luyện căn bản | Chia sẻ kiến thức, thảo luận luyện piano; Standard PLAUSIBLE, Quality DIRECT | Phù hợp nhánh thảo luận theo phạm vi cũ, nhưng ngoài ngôn ngữ người dùng muốn |
| Chuyện biểu diễn salon | Nghệ sĩ kể chuyện biểu diễn piano; DIRECT | Nhánh câu chuyện được nhận mà chưa giới hạn ngôn ngữ |
| Workshop samba | Model nói có cả người chơi piano muốn học nhịp điệu; DIRECT | Suy diễn thêm liên hệ piano từ bài workshop nhạc cụ gõ; còn có lỗi ngữ nghĩa ngoài vấn đề ngôn ngữ |

Ba bài được gán DIRECT và không có cờ nghi vấn đã đi qua Quality mà không cần đọc lại. Bài thứ hai được review và nâng DIRECT. Thêm vòng review khi cùng thiếu một ràng buộc không giải quyết được thiếu sót đó.

Lượt sửa này chặn cả bốn bằng ngôn ngữ. Nó chưa chứng minh đã chữa mọi lỗi suy diễn chủ đề kiểu bài workshop nếu lỗi tương tự xuất hiện trong một bài tiếng Việt.

## Cơ chế đã sửa

- Giao diện có lựa chọn ngôn ngữ rõ ràng, mặc định **Tiếng Việt — kể cả người Việt ở nước ngoài**. Lựa chọn đi vào kế hoạch, bản nháp, preset và khóa kiểm tra cấu hình. Bản nháp cũ chưa giới hạn ngôn ngữ không được coi là đã khớp lựa chọn mới.
- Trước khi gọi model, kiểm tra văn bản bài và từng bình luận bằng thư viện chạy cục bộ, chữ viết và dấu hiệu ngôn ngữ. Nếu tất cả đều rõ là ngôn ngữ khác, loại mà không mất tiền API. Nếu chưa xác định được, giữ PENDING.
- Sau đánh giá, kể cả kết quả từ cache, kiểm tra **đúng tác giả/đối tượng được chọn và đoạn bằng chứng được trích**. Một bình luận tiếng Việt có thể phù hợp dưới bài nước ngoài; văn bản tiếng Việt của người khác hoặc đoạn không được dùng làm bằng chứng không hợp thức hóa bài nước ngoài.
- Không suy quốc tịch hoặc địa điểm từ tên. Giữ khả năng nhận tiếng Việt không dấu, câu ngắn rõ nghĩa và nội dung song ngữ có đoạn tiếng Việt làm bằng chứng. Hashtag, email, URL, tên tài khoản không tự chứng minh ngôn ngữ.
- OFF vẫn giữ dữ liệu thô, không gọi AI để lọc. Kết quả lịch sử được giữ làm hồ sơ; bản sửa có ID chiến dịch, phiên bản phạm vi và liên kết đến quyết định cũ riêng.

Thành phần nhận diện là `franc-min@6.2.0`, chạy trên máy. Tài liệu của thư viện lưu ý dễ nhầm khi văn bản ngắn; vì vậy không dùng điểm xếp hạng của nó như xác suất đúng và không tự nhận ca chưa rõ. [Tài liệu franc](https://github.com/wooorm/franc).

## Kết quả xuất lại

Áp điều kiện mới lên toàn bộ 1.356 / 1.005 bài đã được nhận, gồm cả phần dư, theo thứ tự tuyển bền vững cũ:

| Kết quả | Tiêu chuẩn | Chất lượng |
|---|---:|---:|
| Được nhận theo phạm vi cũ | 1.356 | 1.005 |
| Loại do ngôn ngữ | 215 | 135 |
| Chuyển chờ vì chưa xác định được ngôn ngữ | 161 | 51 |
| **Còn được nhận và đã xuất** | **980** | **819** |
| Thiếu so với chỉ tiêu 1.000 | **20** | **181** |

Không gọi tất cả ca chờ là bài nước ngoài: nhiều bài quá ngắn, chỉ có tên bản nhạc/tag hoặc thiếu ngữ cảnh để xác nhận. Tập sửa có thể còn bỏ sót tiếng Việt ở nhóm này; cần xem lại có mục tiêu, không tự nhận cho đủ số lượng.

- [Excel Tiêu chuẩn — 980 bài](C:/Users/Admin/AppData/Roaming/csd-desktop/data/comparisons/piano-vietnamese-20261103/CSD-piano-STANDARD-VI-980.xlsx)
- [Excel Chất lượng — 819 bài](C:/Users/Admin/AppData/Roaming/csd-desktop/data/comparisons/piano-vietnamese-20261103/CSD-piano-QUALITY-VI-819.xlsx)
- [Bản chạy CSD 0.4.0-rebuild.3](C:/OwnProject/crawl-socials/release/CSD-Portable-0.4.0-rebuild.3.exe)

Có JSON tương ứng trong cùng thư mục. Bản xuất mới ghi đúng số dòng thực tế; dữ liệu R7 không bị sửa để che lịch sử. Thư mục R7 có `LATEST-LANGUAGE-CORRECTION.json` trỏ tới bản thay thế. **Không sử dụng lại precision 82,2%/88,6% và recall của R7 làm điểm số cho bản sửa**, vì phạm vi ngôn ngữ đã đổi và chưa có phép đo độc lập mới.

## Xác minh và Git

Kiểm thử bao gồm: chặn tiếng Nhật/Anh/Pháp; không lấy tên Việt trong văn bản tiếng Anh làm bằng chứng; giữ tiếng Việt ở Tokyo/Paris và tiếng Việt không dấu; bình luận Việt dưới bài Nhật; cache không vượt điều kiện ngôn ngữ; trích đoạn nước ngoài không được mượn một đoạn tiếng Việt khác để vượt kiểm tra. Draft/preset giữ điều kiện `vi` mà không tự thêm quốc gia.

Đã chạy typecheck, **987/987 unit tests đạt** và kiểm tra main/preload/renderer trong ASAR với AppData cách ly, không gọi model thật. Kiểm tra bản xuất xác nhận số dòng, ID duy nhất, phiên bản chiến dịch, đối tượng và bằng chứng. Bốn ID người dùng báo đều bị loại ở cả hai mode. Sổ DEVELOPMENT vẫn 1.071 attempts / 1,253847023 USD / 0 USD dự phòng, bằng trước lượt sửa.

Nhánh chặng `codex/csd-r8-vietnamese-scope`, hợp vào `codex/csd-rebuild`, mốc `csd-rebuild-r8-20261103`. Giữ R7 để đối chiếu; chưa promote production. [Bằng chứng và hash](../evidence/csd-vietnamese-language-fix-20261103.json).
