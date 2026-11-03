# R10 — giao diện đơn giản và thu thập chạy nền

Người dùng duyệt chức năng hiện tại ngày 2026-11-04, yêu cầu giữ một baseline
trước khi thay giao diện. Baseline: **e671af2**, tag
**csd-approved-baseline-20261104**, phiên bản **0.4.0-rebuild.4**.
Commit này ghi nhận sự chấp nhận để phát triển tiếp, không khẳng định bộ lọc
chính xác tuyệt đối hoặc cấp thêm ngân sách thử AI.

## Thay đổi trong 0.4.0-rebuild.5

- Giữ Cascadia Code / Consolas / SFMono-Regular; nền trắng, chữ đen.
- Xóa cửa sổ Make it cooler, toggle Ultra Thinking, preload và IPC liên quan.
- Ẩn tốc độ, ngôn ngữ, ngân sách, giới hạn tiền trên máy, key và bộ lọc đã lưu.
  Lượt mới từ giao diện dùng BALANCED, tiếng Việt và $3; Không lọc dùng $0.
  Các giới hạn tiền đã lưu vẫn được giữ; máy chưa có giới hạn dùng $3 cộng
  dồn / $3 mỗi ngày. Không xóa lịch sử chi phí hoặc tăng trần đã đặt.
- Ưu tiên key trong môi trường Windows. Key mã hóa đã lưu vẫn là dự phòng
  nếu môi trường chưa có key; không đưa key ra giao diện hoặc log.
- Viết lại câu chữ, giữ số bài, số bài chưa kiểm tra, chi phí và lý do dừng.
  Bỏ trạng thái hàng đợi AI, danh sách cửa sổ/từ khóa và bản xem trước JSON.
  Mỗi mạng hiển thị số bài; mục tiêu chung chỉ nằm ở phần tổng kết.
- Tìm kiếm theo từ khóa và đọc bình luận dùng cửa sổ ẩn, không nằm trên
  taskbar, không tự giành focus. Tắt background throttling cho cửa sổ thu.
  Chỉ nút đăng nhập mới hiện cửa sổ; bắt đầu thu ẩn cửa sổ đăng nhập của
  tài khoản đó. Giữ phiên đăng nhập, việc riêng theo từ khóa và lịch thu cũ.
- Không sửa tiêu chí phân loại, prompt model, cách nhận bài hoặc dữ liệu đã thu.

## Kiểm tra

- `npm run check`: đạt.
- `npm test`: **994 đạt, 0 lỗi**.
- `scripts/semantic-dialogue-ui-smoke.mjs`: đạt; hỏi lại khi mơ hồ, gửi câu
  trả lời, xem/sửa từ khóa, hai nhóm kết quả và ba mức lọc hoạt động.
- `scripts/parallel-window-smoke.mjs`: **24 cửa sổ Electron thật**, 12 mỗi
  nền tảng, đọc các trang localhost độc lập trong khi đều ẩn. Đóng một cửa
  sổ không phá cửa sổ khác; mở lại không hiện cửa sổ thu. Kiểm tra đăng nhập
  chủ động và ẩn lại trước cả tìm kiếm lẫn đọc bình luận đạt.
- `scripts/rebuild-app-smoke.mjs`: main/preload/renderer của **ASAR đóng gói**
  đạt. Kiểm tra nền/chữ/font, các mục ẩn, mặc định của ba mức lọc, ưu tiên
  giữ trần tiền cũ, không còn cooler và không hiện từ khóa cửa sổ.
  Trạng thái kết quả dùng dữ liệu giả, bao gồm bài ngoài chỉ tiêu và bài chờ.
- Đã xem ảnh giao diện từ bản đóng gói. Bằng chứng cục bộ:
  `artifacts/r10-simple-ui/`; không commit ảnh, dữ liệu hay executable.

Tất cả kiểm tra dùng thư mục tạm riêng. **0 lần gọi AI trả phí, $0 chi phí AI**.
Không chạy lại Facebook/Threads thật hoặc đo lại chất lượng phân loại trong
chặng giao diện này. Kết quả thử cửa sổ là kiểm tra cơ chế chạy nền, không
phải số đo tốc độ hoặc độ phủ trên mạng xã hội thật.

## Mốc bàn giao

Nhánh công việc: `codex/csd-r10-simple-interface`; đưa vào `codex/csd-rebuild`
bằng fast-forward sau khi kiểm tra. Baseline trước thay đổi giữ nguyên.
File bàn giao: `release/CSD-Portable-0.4.0-rebuild.5.exe`.
Giữ nguyên bản xuất chưa được Git theo dõi của người dùng và các file AppData.
