/** User-facing causes shared by action errors and the persisted run status. */
export function managedPauseMessage(code: string): string | null {
  if (/AUTH_REQUIRED/.test(code)) return 'Đăng nhập bằng tài khoản FindLink để bắt đầu.';
  if (/INVITE_REQUIRED|INVITE_INVALID/.test(code)) return 'Cần mã mời hoặc mã đặt lại hợp lệ do FindLink cấp.';
  if (/TRIAL_EXPIRED|TRIAL_EXHAUSTED|TRIAL_REVOKED/.test(code)) return 'Lượt dùng thử đã kết thúc. Bạn vẫn có thể xem và xuất dữ liệu đã lưu.';
  if (/TRIAL_CREDITS_HELD/.test(code)) return 'Credits dùng thử đang được giữ để xác nhận chi phí.';
  if (/MODEL_USAGE_UNKNOWN/.test(code)) return 'FindLink đang đối soát một yêu cầu AI của lượt này. Dữ liệu đã thu vẫn được lưu.';
  if (/TRIAL_FUNDING_PAUSED/.test(code)) return 'FindLink đang tạm dừng lượt dùng thử.';
  if (/TRIAL_REVIEW_REQUIRED|TRIAL_ALREADY_CLAIMED|TRIAL_DEVICE_MISMATCH/.test(code)) return 'Quyền dùng thử cần được FindLink kiểm tra. Liên hệ hỗ trợ nếu bạn đổi thiết bị hoặc dùng chung máy.';
  if (/TRIAL_PROJECT_LIMIT|PROJECT_LIMIT_REACHED/.test(code)) return 'Đã đạt số project được phép xử lý trong gói này.';
  if (/SUBSCRIPTION_REQUIRED|ENTITLEMENT_REVOKED/.test(code)) return 'Cần quyền dùng thử hoặc gói Starter còn hạn để chạy. Dữ liệu cũ vẫn xem và xuất được.';
  if (/RUN_LEASE_BUSY/.test(code)) return 'Tài khoản đang chạy trên một lượt hoặc thiết bị khác.';
  if (/RUN_LEASE_|ENTITLEMENT_UNAVAILABLE|BACKEND_UNAVAILABLE/.test(code)) return 'FindLink chưa xác nhận được quyền chạy. Kiểm tra kết nối rồi thử lại.';
  if (/CHECKOUT_UNAVAILABLE/.test(code)) return 'Thanh toán Starter đang tạm thời chưa khả dụng.';
  if (/RATE_LIMITED/.test(code)) return 'Thao tác quá thường xuyên. Hãy thử lại sau.';
  return null;
}

export function modelPauseMessage(code: string): string | null {
  const managed = managedPauseMessage(code);
  if (managed) return managed;
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
