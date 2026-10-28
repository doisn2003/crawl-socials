# Facebook Search — bằng chứng giao diện từ người dùng

2026-10-27, lead `/root`. Đây là khảo sát do người dùng thao tác, không phải CSD tự thu bài hoặc benchmark. Observer/crawler vẫn OFF.

## Bằng chứng đã kiểm

Người dùng cung cấp ảnh `C:/Users/Admin/Downloads/bo-loc-fbSearch.png`; lead đã mở xem trực tiếp. File42076bytes, SHA-256 `9911496ccde345b62269e9e7e3413f2d3e5122e9a7ef218b4cbc7f367b1a4503`. Chỉ giữ tham chiếu/hash, không copy ảnh hoặc dữ liệu người dùng vào repo.

Ảnh có tiêu đề cửa sổ **CSD — Phiên CSD Facebook**, ô tìm kiếm **cafe Hà Nội**, heading **Kết quả tìm kiếm**, locale tiếng Việt. Các control đang hiển thị:

| Control | Quan sát trực tiếp | Chưa biết |
| --- | --- | --- |
| Bài viết mới đây | Toggle, hiển thị tắt | Tác động đến thứ tự/khoảng thời gian chưa thử |
| Bài viết bạn đã xem | Toggle, hiển thị tắt | Chưa thử bật/lọc |
| Ngày đăng | Control mở danh sách | Chưa mở danh sách, chưa biết các giá trị |
| Bài viết của | Control mở danh sách; các lựa chọn đã thấy trong ảnh bổ sung bên dưới | Chưa thử tác động của từng lựa chọn hoặc xác minh đầy đủ ba loại nguồn |
| Vị trí được gắn thẻ | Control chọn vị trí | Không đồng nghĩa bộ lọc địa lý của mọi bài hoặc vị trí thật của quán |

Sidebar có nhãn Tất cả, Mọi người, Thước phim, Marketplace, Trang, Nhóm, Sự kiện. Nhãn Tất cả xuất hiện cùng bộ lọc liên quan bài viết; **không dùng ảnh này để kết luận người dùng tìm sai entity**. Ảnh chưa cung cấp URL/selected route hoặc label Posts riêng.

Khung phải trong ảnh trống. Lead đã hỏi đúng điểm này; người dùng xác nhận: **“Có bài viết; ảnh chủ yếu chụp bộ lọc.”** Vì vậy, không coi vùng trống là lỗi render/zero results. Câu hỏi khảo sát trước đã được trả lời; không hỏi lại có bài/login/API.

## Kết luận và giới hạn

- **Đã xác nhận qua người dùng:** phiên CSD đăng nhập được và thao tác tìm cafe Hà Nội có bài viết hiển thị.
- **Đã quan sát trực tiếp qua ảnh:** query, locale, control labels và trạng thái toggle ở trên.
- Chưa xác minh PUBLIC/source types ở cấp record, đếm unique/relevant, thử filter, continuation, schema response hoặc yield. Ảnh bổ sung có card bài viết nhưng không phải dataset. Không có bằng chứng đủ Page/nhóm công khai/trang cá nhân công khai. Không cho capability SUPPORTED chỉ từ control hiển thị.
- Source driver/parser/writer LIVE vẫn chưa triển khai; G00/disposition automated route vẫn chưa được giải quyết. Khảo sát này gỡ phần thiếu bằng chứng UI, không là grant hoặc benchmark. P02.02 chưa DONE.

Metadata đọc cùng lượt có3540events,3412old drops/444priority drops; phần priority còn giữ chỉ WSS Facebook deny. Không còn trace đầy đủ để kết luận tác động của mọi request, và **không có lỗi kết quả trống cần sửa theo xác nhận người dùng**. Không tự mở WSS hoặc sửa policy thêm vì sự kiện deny tồn tại.

Phạm vi thử nguồn đầu theo lead review vẫn1query/1batch/≤5candidates/≤5phút/≤3actions, chưa Start. Không tạo framework hoặc yêu cầu người dùng cung cấp cookie/token để vượt khoảng trống source.

## Ảnh bổ sung — menu theo người đăng

Người dùng cung cấp `C:/Users/Admin/Downloads/bo-loc-theo-nguoi-dang.png`; lead đã mở xem. File457981bytes, SHA-256 `b1a2383ce14eda76edeca134324b2acfcb028ed8353dbd2c01bee830dad94c51`. Ảnh có bài viết, tên/ảnh tài khoản và ảnh nội dung; không copy vào repo, không chép nội dung bài hoặc định danh cá nhân vào ghi chú.

Menu **Bài viết của**, ô hiển thị **Chọn một nguồn...**, đang mở với đúng các nhãn:

1. Mọi người
2. Bạn
3. Bạn bè của bạn
4. Nhóm và Trang của bạn
5. Bài viết công khai

**Bài viết công khai** là lựa chọn quan sát được, phù hợp để ưu tiên thử cho workload PUBLIC_DISCOVERY khi chạy bước tiếp theo. Ảnh chưa thể hiện đã chọn/apply mục này: không ghi filterApplied=true hoặc public=true cho mọi kết quả đang thấy. Cần kiểm trạng thái sau áp dụng và publicity từng record khi nghiệm thu dữ liệu.

**Nhóm và Trang của bạn** là một mục gộp theo quan hệ tài khoản; ảnh không chứng minh có thể tách riêng Page/Group hoặc tìm tất cả nhóm công khai. Không coi mục này là quyền thu nhóm riêng tư hoặc bằng chứng P11 đã hoạt động. Menu không có lựa chọn riêng mang nhãn Trang cá nhân công khai; độ bao phủ nguồn cá nhân còn cần thử.

Ảnh lần này cho thấy trực tiếp card bài viết trong kết quả cafe Hà Nội, với header bối cảnh nhóm, dòng tác giả/thời gian/biểu tượng hình địa cầu, nội dung và ảnh. Có control **Xem thêm**, nên không giả toàn bộ text đang hiển thị đã đầy đủ. Đây là UI evidence; chưa có permalink/post ID, full timestamp hoặc kiểm chứng source/publicity để tính một valid record.

Ghi chú cho driver sau này: label **Mọi người** có thể xuất hiện ở các control khác nhau; cần nhận diện trong đúng menu Bài viết của và kiểm trạng thái chọn, không click bằng text toàn trang. Giữ query gốc cafe Hà Nội; không bật Bài viết mới đây mặc định vì workload cho phép bài cũ. Không đổi endpoint, capability, task hoặc gate chỉ từ screenshot.
