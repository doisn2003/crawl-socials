# R13 — theme sáng và bắt đầu thu thập trong một thao tác

Người dùng yêu cầu thêm bản vá trên nền R12 (`9b98e4a`, rebuild.5.1): giao diện
sáng có màu, trạng thái đăng nhập xanh, thông báo lỗi đỏ tự cuộn tới, và một nút
vừa lập kế hoạch vừa bắt đầu thu thập với loading animation. Yêu cầu mới thay
theme trắng/đen của R10, giữ font và các phần đơn giản hóa còn lại.

Nhánh riêng: `codex/csd-r13-light-ui`. Phiên bản: **0.4.0-rebuild.5.2**.
Không lấy phần QUALITY v2 đang phát triển trên nhánh R11.

## Thanh gạt

Theo ảnh tham chiếu: dải tím xanh có điểm sáng, đậm dần theo vị trí, nút kéo trắng,
hiện số phần trăm và đánh dấu chế độ đang chọn. Bước 1%, toàn dải 0–100.
Người dùng đã chốt khoảng ban đầu còn thiếu 21–30 thuộc Tiêu chuẩn:

| Vị trí | Chế độ |
| --- | --- |
| 0–20% | Không lọc / OFF |
| 21–80% | Tiêu chuẩn / STANDARD |
| 81–100% | Chất lượng / QUALITY |

Lưu `UserConfig.filterPercent` là số nguyên tùy chọn. Cấu hình cũ tiếp tục đọc
được; nếu chưa có vị trí thì lấy 0/50/100 theo mode đã lưu. Nếu vị trí và mode
không khớp, giữ mode thật và dùng vị trí mặc định tương ứng. Không thay model,
thinking, ngân sách hoặc classifier theo từng phần trăm. OFF vẫn không gọi AI.

## Giao diện và thao tác

- Nền sáng xanh xám, thẻ trắng bo góc với viền/bóng nhẹ, nút chính xanh lam,
  tải Excel xanh lá, dừng màu đỏ nhạt. Giữ Cascadia Code / Consolas.
- Trạng thái đã đăng nhập có nền xanh lá; nguồn đang chọn có nền/viền xanh lam.
- Lỗi cấu hình, tài khoản, kết nối, thao tác và lỗi từ lượt thu có khối đỏ.
  Focus và cuộn tới lỗi mới; polling lại cùng một lỗi không kéo màn hình lặp lại.
  Có hỗ trợ reduced motion và thông báo accessibility.
- Start lưu cấu hình → lập kế hoạch nếu cần → dùng đúng reference mới để Start.
  Chặn bấm đúp và hiện spinner cùng nhãn theo giai đoạn. Kế hoạch hợp lệ có sẵn
  được dùng lại, không gọi planner thêm. OFF đi thẳng tới thu thập.
- Dùng cấu hình đã được main chuẩn hóa khi đọc reference mới; khoảng trắng đầu/
  cuối prompt không làm luồng một nút dừng nhầm ở bước kế hoạch. Smoke host chuẩn
  hóa đầu vào như backend thật để kiểm tra trường hợp này.
- Nếu cần làm rõ, dừng trước Start và hiện câu hỏi. Gửi câu trả lời sẽ tự tiếp tục
  khi yêu cầu và nguồn vẫn khớp. Đổi cấu hình/nguồn hủy ý định tự Start cũ.
- Nút “Chỉ xem kế hoạch” là lựa chọn riêng, không tự bắt đầu thu thập.
- Giữ bản vá khôi phục từ khóa R12, dữ liệu, recipe, ledger, trần tiền và cửa sổ ẩn.

## Kiểm chứng

- `npm run check`: đạt.
- `npm test`: **1.005 đạt, 0 lỗi**. Sáu kiểm thử mới kiểm tra chuỗi Start, dùng
  lại draft, OFF, chặn Start khi lỗi/chưa rõ, toàn bộ 101 vị trí và việc giữ trần tiền.
- Sau bổ sung đường thông báo lỗi nguồn đã lưu: 16 kiểm thử planner UI đạt.
- `scripts/light-ui-smoke.mjs`: giao diện Electron thật, host giả có giữ phản hồi
  để xác minh loading từng giai đoạn; theme, badge xanh, các ngưỡng phần trăm và
  lưu 57% qua reload, một click/không bấm đúp, đỏ + scroll/focus khi lỗi, tự tiếp
  tục sau câu trả lời, preview không Start và sửa yêu cầu hủy tự Start đều đạt.
  Đã chạy lại trên **renderer từ ASAR đóng gói**, không có renderer error.
- `scripts/semantic-dialogue-ui-smoke.mjs`: đạt; làm rõ, sửa tiêu chí, nhóm kết
  quả và cả ba chế độ còn hoạt động.
- `scripts/rebuild-app-smoke.mjs`: main/preload/renderer ASAR đạt; cấu hình thật
  lưu/đọc được, trần tiền cũ giữ nguyên, mặc định BALANCED/VIETNAMESE/$3, OFF $0,
  technical controls vẫn ẩn, không có cooler hoặc cửa sổ phụ.
- `scripts/planner-hotfix-smoke.mjs`: bản R12 vẫn khôi phục 11 từ khóa từ lỗi
  `target_roles` đã báo; hash recipe planner lịch sử giữ nguyên.
- Đã xem ảnh theme/slider/loading/lỗi; sửa độ đầy slider để bám ngay nút kéo.
  Nút đang loading giữ nền xanh/chữ trắng ngay lập tức để bảo đảm độ rõ.

Bằng chứng cục bộ: `artifacts/r13-light-ui/` của worktree này. Toàn bộ kiểm tra
dùng dữ liệu cô lập và phản hồi giả: **0 lần inference thật, 0 USD API**. Không
đo lại precision/recall hoặc chạy một lượt Facebook/Threads thật cho thay đổi UI.

## Bàn giao

File portable: `C:\OwnProject\crawl-socials\release\CSD-Portable-0.4.0-rebuild.5.2.exe`.
Đóng bản cũ rồi mở bản mới bằng cùng tài khoản Windows; dữ liệu và key trên máy
vẫn được dùng lại. Bản vá giữ ở nhánh riêng, không tự merge vào R11/production.
