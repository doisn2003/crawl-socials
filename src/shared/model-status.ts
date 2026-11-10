/** User-facing causes shared by action errors and the persisted run status. */
export function modelPauseMessage(code: string): string | null {
  if (/MODEL_NETWORK_USAGE_UNKNOWN/.test(code)) return 'Kết nối tới Gemini bị gián đoạn nên chưa nhận được kết quả AI. Kiểm tra Internet rồi thử lại thao tác; không cần xóa dữ liệu. Chi phí chưa xác nhận vẫn được dự phòng trong hạn mức.';
  if (/MODEL_CALL_LIMIT_REACHED/.test(code)) return 'Lượt này bị dừng bởi giới hạn số lần gọi AI của bản cũ. Bản hiện tại đã bỏ giới hạn đó; chọn Tiếp tục lượt này để lọc dữ liệu đã lưu trong ngân sách còn lại.';
  if (/MODEL_GLOBAL_BUDGET_EXHAUSTED/.test(code)) return 'Đã dùng hết giới hạn chi phí đã đặt trên máy này. Giới hạn này tính cả những lượt trước. Bài chưa lọc vẫn được lưu; Google chưa báo hết tiền.';
  if (/MODEL_BUDGET_BUSY/.test(code)) return 'Đang chờ xác nhận chi phí của phần đang xử lý. Hãy thử tiếp tục sau ít phút; FindLink chưa kết luận đã hết tiền.';
  if (/MODEL_BUDGET_EXHAUSTED/.test(code)) return 'Đã dùng hết giới hạn chi phí của lượt này. Các bài chưa lọc vẫn được lưu.';
  if (/MODEL_SPEND/.test(code)) return 'Chưa đọc được giới hạn chi phí trên máy. Hãy mở lại FindLink; bài đã tìm được vẫn được lưu.';
  if (/MODEL_BILLING/.test(code)) return 'Google báo vấn đề thanh toán hoặc số dư tài khoản. Bài đã tìm được vẫn được lưu; có thể tiếp tục sau khi tài khoản được xử lý.';
  if (/MODEL_DAILY_QUOTA|MODEL_QUOTA|MODEL_HTTP_429/.test(code)) return 'Google đang giới hạn lượng xử lý của tài khoản. Hãy tiếp tục khi dịch vụ sẵn sàng; bài đã tìm được vẫn được lưu.';
  return null;
}
