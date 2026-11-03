/** User-facing causes shared by action errors and the persisted run status. */
export function modelPauseMessage(code: string): string | null {
  if (/MODEL_CALL_LIMIT_REACHED/.test(code)) return 'Lượt này bị dừng bởi giới hạn số lần gọi AI của bản cũ. Bản hiện tại đã bỏ giới hạn đó; chọn Tiếp tục lượt này để lọc dữ liệu đã lưu trong ngân sách còn lại.';
  if (/MODEL_GLOBAL_BUDGET_EXHAUSTED/.test(code)) return 'Đã chạm trần tiền AI cộng dồn hoặc trong ngày của CSD. Kiểm tra Giới hạn tiền AI trên máy này. Đây không phải thông báo hết tiền từ Google; các bài chưa lọc vẫn được lưu.';
  if (/MODEL_BUDGET_BUSY/.test(code)) return 'Ngân sách AI đang được dự phòng cho yêu cầu chưa xử lý xong. Chờ quyết toán trước khi tiếp tục; CSD chưa kết luận đã hết tiền.';
  if (/MODEL_BUDGET_EXHAUSTED/.test(code)) return 'Đã chạm ngân sách AI của lượt này. Các bài chưa lọc vẫn được lưu; CSD không tự tăng ngân sách.';
  if (/MODEL_SPEND/.test(code)) return 'Chưa có cấu hình ngân sách AI hợp lệ. Kiểm tra Giới hạn tiền AI trên máy này; dữ liệu đã thu vẫn được giữ.';
  if (/MODEL_BILLING/.test(code)) return 'Google báo vấn đề thanh toán hoặc số dư của project. Dữ liệu đã thu vẫn được giữ để tiếp tục khi dịch vụ sẵn sàng.';
  if (/MODEL_DAILY_QUOTA|MODEL_QUOTA|MODEL_HTTP_429/.test(code)) return 'Google đang giới hạn số yêu cầu hoặc token của project. Đây không phải giới hạn số lần gọi do CSD đặt; dữ liệu đã thu vẫn được giữ.';
  return null;
}
