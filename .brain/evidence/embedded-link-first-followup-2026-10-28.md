# Bước thay thế sau request pagination PARTIAL

2026-10-28; bắt đầu 10:21:56 Asia/Bangkok, giới hạn 30 phút bổ sung. Không thêm nguồn LIVE.

Căn cứ: 5 permalink/text/metadata thật đã được trích từ application/json của trang search, cả 5 khớp snapshot DOM đã lưu. CDP chưa cho request phân trang quan sát được; không dùng cursor nhúng để tự đoán request. Bước thay thế là pure parser cho dữ liệu nhúng đã quan sát, không tiếp tục sửa trang trí timestamp hoặc dựng queue/UI.

Nhánh `experiment/facebook-embedded-link-first` chứa `src/infrastructure/browser/facebook-search-embedded-parser.ts` và test cấu trúc đã làm sạch. Chỉ duyệt envelope require/__bbox/result/data.serpResponse.results; chỉ đọc SearchRichPostRenderingStrategy. Identity dài giữ string; permalink có ID số phải khớp root; message phải ràng buộc cùng Story; không lấy ID từ media/comment/attached story. Group publication thắng loại tác giả; Page cần same-Story evidence khớp actor/post; GraphQL User không tự thành PROFILE. Metadata thiếu/conflict là null với lý do; love riêng reactions; cursor không được xuất hay sử dụng. Có cận số block, depth, nodes, edges, text và dedup trong một lần parse.

Kiểm tập trung: schema đã quan sát với identity/text tổng hợp, metadata thiếu, số 0 thật, tổng reaction khác love, nguồn Group có Page author, nested identity mismatch, numeric permalink mismatch, loại rendering chưa hỗ trợ, duplicate, context và giới hạn. TypeScript main/tests được kiểm. Đây là kiểm hồi quy/offline; không phải chứng minh collector LIVE.

Không giữ nguyên raw response vì quy tắc dữ liệu của đợt thử; không tái dựng projection rồi gọi đó là replay native payload. Dataset thật vẫn là 5 bản ghi của nhánh trước, không tăng từ tests. Parser này chưa nối app bootstrap hoặc nhận source mới. Giữ nhánh để thử tiếp trong một ngân sách nguồn mới nếu được giao; không merge code này vào main trong lượt hiện tại.
