# R14 — toggle bình luận và sửa đối chiếu bằng chứng xuống dòng

Ngày 04/11/2026, người dùng yêu cầu thêm toggle thu bình luận, cảnh báo vàng
chỉ khi bật, và bỏ ba thẻ tên chế độ dưới slider. Công việc sửa lỗi planner
được yêu cầu trước đó tiếp tục trong cùng bản vá.

Nền: R13 `9943864`. Nhánh: `codex/csd-r14-comments-toggle`.
Phiên bản bàn giao: **0.4.0-rebuild.5.3**. Không lấy QUALITY v2 của R11.

## Bình luận

- Bộ thu bình luận riêng đã có ở `scripts/conversation-collector.mjs`;
  `opportunity-pipeline` điều phối công việc thu, giải quyết root và quay lại.
  Phần phân loại AI dùng chung ngữ cảnh bài viết/bình luận, không phải một
  sản phẩm lọc bình luận hoàn toàn độc lập.
- Giao diện đọc/ghi `OpportunityConfig.commentsEnabled` hiện có. Giữ lựa chọn
  đã lưu, nhớ qua restart, khóa lúc đang lập kế hoạch hoặc thu thập. Chọn trước
  khi bắt đầu lượt mới; Resume giữ cấu hình đã chốt của lượt cũ.
- Tắt: bỏ comment handoff và cửa sổ đọc bình luận cuối lượt; không nhập reply/
  comment vào kho đánh giá của lượt posts-only. Không xóa dữ liệu lịch sử hoặc
  bản ghi nguồn đã lưu độc lập với bộ lọc.
- Bật: dùng bộ thu hiện có với giới hạn trang/bình luận/thời gian/lưu trữ hiện có.
  OFF + bật bình luận cho phép lưu bình luận thô, không tạo suy luận trả phí.
- Dòng màu vàng chỉ hiện khi bật và có đúng nội dung:

  “Thời gian thu thập có thể lâu hơn vì AI cần phân tích các bình luận phù hợp”

- Xóa ba thẻ Không lọc/Tiêu chuẩn/Chất lượng. Không thêm nội dung thay thế và
  không sửa ngưỡng slider 0–20 / 21–80 / 81–100 hoặc bước 1%.

## Lỗi planner được xác minh và phạm vi sửa

Bản R12 chỉ khôi phục được danh sách từ khóa có cấu trúc rất cụ thể; không phải
bản sửa mọi lỗi `CAMPAIGN_SEMANTIC_VALIDATION_FAILED`. Việc thông báo đã sửa lỗi
chung trước đây vượt quá bằng chứng đã có.

Đã tìm thấy 6 phản hồi lỗi thật trong hai lượt cục bộ dùng prompt piano nhiều
nhu cầu (biến thể có thêm thuê đàn và context chủ cửa hàng). Quote có đủ chữ,
nhưng AI thay xuống dòng trong prompt bằng dấu cách. Bộ kiểm tra trước đây chỉ
chấp nhận substring đúng định dạng nên bác target_roles, include và topics.

- `canonicalIntentQuote` chỉ cho phép khác biệt khoảng trắng và NFC; trả lại
  chính span liên tục trong nguồn để kế hoạch lưu quote đúng nguyên văn.
  Không bỏ qua đổi dấu câu/case, thiếu từ, thêm từ hay nối các đoạn rời.
- Chuẩn hóa trên bản sao, giữ nguyên phản hồi model và ledger gốc. Giữ vai trò
  CONFIRMED được chứng minh trong prompt; không biến nhu cầu tìm người thành
  tìm chủ đề không giới hạn.
- Với cùng intent, generation, model và allocation, retry kiểm tra lại phản hồi
  đã lưu trước khi gọi mới. Chỉ dùng lại phản hồi qua validator và projection
  hiện tại. Ghi `RECORDED_VALIDATED_RESPONSE`; giữ invocation/hash/cost đã có.
- Phản hồi thực sự không hợp lệ vẫn bị chặn và giữ giới hạn một lượt sửa.
  Bản vá không bảo đảm mọi phản hồi AI hoặc mọi prompt đều hợp lệ.

## Kiểm chứng

- `npm run check`: đạt; build main/renderer cũng kiểm tra kiểu sau thay đổi UI.
- Kiểm thử tập trung: **41 đạt**.
- `npm test`: **1.011 đạt, 0 lỗi** sau cập nhật fixture kiểm tra comment để bật
  xử lý comment rõ ràng. Không thay các kỳ vọng chất lượng của fixture đó.
- Kiểm tra ma trận 3 mode × bật/tắt: posts-only không capture hoặc đưa text
  comment vào model; ON capture được; OFF luôn 0 suy luận, Stop vẫn được tôn trọng.
- Service posts-only không truyền comment handoff hoặc mở cửa sổ bình luận cuối.
- Phát lại 6 phản hồi thật: 6 qua kiểm tra/projection, raw response không đổi,
  các quote vai trò đều là span thật trong prompt; **0 lần gọi API**. Kết quả có
  3–5 nhánh và 6–8 query tùy phản hồi; đây không phải số đo đủ phủ hay precision.
- Unit test dùng đúng prompt mới được người dùng gõ (không có thuê đàn) với
  phản hồi giả: giữ các nhánh học/chơi/cafe/mượn/giá rẻ/trung tâm và vai trò.
- `planner-hotfix-smoke` trên ASAR: tạo lỗi xuống dòng bằng bản 5.2 với mock,
  rồi dùng 5.3 retry cùng allocation. Không có mock request mới, giữ nguyên số
  attempt và tiền đã ghi. Đồng thời kiểm tra bản vá danh sách từ khóa R12.
- `light-ui-smoke` trên renderer ASAR: toggle lưu/đọc lại, dòng vàng chỉ khi ON,
  ba thẻ biến mất, slider/one-button/loading/error scroll của R13 còn hoạt động.
- `rebuild-app-smoke`: main/preload/renderer ASAR đạt, dữ liệu và ledger tạm cô
  lập, giữ trần tiền/mặc định/cửa sổ ẩn và chặn planner khi OFF.
- Đã xem ảnh toggle ON/OFF và slider không còn ba thẻ.

Bằng chứng cục bộ: `artifacts/r14-comments/` trong worktree. Không commit dữ
liệu AppData hoặc phản hồi thật. **0 inference thật, 0 USD API phát triển**.
Chưa chạy một lượt crawl/AI thật trên máy khác hoặc đánh giá lại precision/recall.

## Bàn giao

`C:\OwnProject\crawl-socials\release\CSD-Portable-0.4.0-rebuild.5.3.exe`

Đóng bản cũ, mở bản mới cùng tài khoản Windows. Dữ liệu/key/chi phí không reset.
Các commit planner và bình luận được tách riêng; không tự merge vào R11 hay
production, không thay baseline đã được duyệt.
