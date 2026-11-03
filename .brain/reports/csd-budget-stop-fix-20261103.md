# R9 — Sửa CSD dừng AI khi còn ngân sách

Ngày: 03/11/2026. Ứng viên: **0.4.0-rebuild.4**. Phạm vi: sửa cơ chế vận hành, không thay model hoặc tiêu chí Standard/Quality.

## Nguyên nhân đã xác nhận

Lượt tiếng Anh/IELTS `crawl-b1f86961-3486-4f6d-b0a2-b41cbfa941ab` dừng AI ở giới hạn USER 3 lần gọi. Chi phí đo được chỉ 0,0059655/3 USD. Ba lần gồm một lần Gemini 2.5 cũ chi phí 0, một planner 3.1 và một batch phân loại 8 bài. CSD tiếp tục thu tới 3.003 bài gốc; trạng thái cuối là 2 phù hợp, 5 không phù hợp và 2.996 chưa lọc xong. Một trong 8 bài được đánh giá có phiên bản mới nên cần đánh giá lại.

Đã đối chiếu giao diện, progress, model ledger và SQLite. Không có căn cứ kết luận model kém hoặc bộ lọc quá chặt từ lượt chỉ đánh giá 8 bài. Chưa có nhật ký xác định ai hoặc thao tác nào đã đặt `maxCalls=3`.

## Thay đổi

- USER không bị chặn bởi số lần gọi cộng dồn. Cấu hình cũ được đọc tương thích, giữ các trần tiền và bỏ `maxCalls` khỏi cấu hình chuẩn hóa. DEVELOPMENT vẫn có giới hạn số lần gọi theo cấp phép.
- Ngân sách từng lượt, ngân sách tổng/ngày, khoản dự phòng chưa rõ chi phí, tốc độ gọi và giới hạn thử lại được giữ. Không xóa ledger hoặc tăng ngân sách của người dùng.
- Giao diện bỏ ô tổng số lần gọi; ghi riêng “bài chưa lọc xong” và “yêu cầu chờ gửi”. Nguyên nhân dừng được giải thích, không chỉ hiện mã lỗi.
- Tiếp tục một lượt đã đạt trần dữ liệu sẽ xử lý hàng chờ từ dữ liệu cũ mà không khởi động lại tìm kiếm hoặc phân rã prompt.
- Thu bình luận có giới hạn tiếp tục được khi AI dừng vì ngân sách/quota. Không vượt qua Dừng, hạn mức lưu trữ, chặn tài khoản hoặc lỗi quyền xử lý công việc. Lỗi trình duyệt xảy ra sau đó không che mất nguyên nhân AI tạm dừng.

## Kiểm chứng

- Typecheck đạt; toàn bộ **993/993** kiểm thử đạt. Kiểm thử hồi quy bao gồm vượt mốc 3 lần gọi USER, bảo toàn số tiền/call sau restart, chặn đúng trần ngày/tổng, khoản dự phòng không được xóa và DEVELOPMENT vẫn chặn theo số lần được cấp.
- Kiểm thử service/pipeline thật với model giả: tái mở hàng chờ từng bị `MODEL_CALL_LIMIT_REACHED`, xử lý hết bài đã lưu, không chạy lại collector và không lập lại kế hoạch.
- Kiểm thử riêng: AI dừng nhưng vẫn thu bình luận trong giới hạn; lỗi trình duyệt không che nguyên nhân dừng AI; lệnh Dừng vẫn có hiệu lực.
- Gói portable được tạo thành công; kiểm tra main/preload/renderer và worker từ ASAR bằng AppData/sổ chi phí cô lập đạt. Không còn ô giới hạn số lần gọi; cấu hình cũ được chuẩn hóa; OFF từ chối planner; không có lỗi renderer.
- Bằng chứng cục bộ: `artifacts/r9-budget-check.log`, `artifacts/r9-budget-focused.log`, `artifacts/r9-budget-unit-tests.log`, `artifacts/r9-budget-package.log`.
- Không gọi AI thật. Ledger trước/sau: USER 3 lần, 0,0059655 USD, dự phòng 0; DEVELOPMENT 1.071 lần, 1,253847023 USD, dự phòng 0. Không sửa dữ liệu nguồn của lượt người dùng.

Các kiểm thử này xác nhận việc điều phối và kiểm soát tiền; không phải phép đo độ chính xác phân loại. Lượt tiếng Anh chưa được chạy lại bằng Gemini.

## Bàn giao

- Executable: `release/CSD-Portable-0.4.0-rebuild.4.exe` (không đưa binary vào Git).
- SHA-256: `4569837819DB5C220242360778CA1F340AC109551CAC3268B7569245053EF47B`.
- Kiểm tra gói: `artifacts/r9-budget-packaged/app-smoke.json` và `main-ui.png`.
- Cần đóng hẳn phiên CSD cũ rồi mở bản mới. Không tự bấm tiếp tục hay gọi API trong phiên người dùng; dữ liệu nguồn được giữ nguyên.
