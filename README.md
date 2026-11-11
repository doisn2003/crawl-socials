# FindLink Starter

Nhánh `findlink-publish-1st` có ứng dụng Starter và backend quản lý tài khoản, trial, credits, Gemini và SePay.

## Mở thử Starter trên máy này

Chạy tại thư mục dự án trên Windows. Cần Node.js theo [.node-version](.node-version) và `DATABASE_URL` trong `.env` có quyền tạo database thử.

```powershell
npm ci
npm run starter:preview
```

Nếu đã cài thư viện, chỉ cần chạy lệnh thứ hai. FindLink mở hai cửa sổ.

| Cửa sổ | Thao tác |
|---|---|
| **FindLink Starter — Bản thử** | Mục **Dùng thử FindLink** ở đầu trang hiện **100 credits**. Bấm **Lịch sử credits** để xem lần cấp và khoản đã dùng. Thử **Xem tiêu chí trước khi thu** với prompt mẫu để thấy credits giảm. |
| **Quản trị FindLink Starter — Bản thử** | Xem **Tài khoản và số dư** hoặc **Đơn hàng và hạn gói**. Dùng **Cấp mã mời**, **Ngân sách** và **Biểu giá AI** để thử thao tác quản trị. Mở lại từ menu **Bản thử → Mở quản trị**. |

Để thử mua gói, bấm **Mua Starter** trong ứng dụng. Đợi vài giây rồi bấm **Kiểm tra thanh toán**. Webhook mô phỏng xác nhận đơn và ví hiện **50.000 credits**. Quay lại quản trị, bấm **Làm mới** để thấy đơn và hạn gói.

Bản thử tạo database và AppData riêng, mô phỏng Gemini và SePay, rồi dọn dữ liệu thử khi đóng ứng dụng. Giữ tiến trình chạy trong lúc thao tác và dùng cửa sổ đang mở nếu bản thử đã chạy. Khoản tiền trên màn hình là số liệu thử. Không chuyển tiền.

## Chọn đúng bản

| Cách mở | Dùng cho |
|---|---|
| `npm run starter:preview` | Xem trial, credits, mua Starter và quản trị ngay với dữ liệu mô phỏng. |
| `npm start` hoặc bản Portable cũ | Chạy nội bộ theo cấu hình máy hiện có. Giao diện dùng USD và key nội bộ. |
| **FindLink Starter QA** | Kiểm thử bộ cài Windows. Bản QA mặc định kết nối backend ở `http://127.0.0.1:9070`. |
| **FindLink Starter phát hành** | Kết nối backend HTTPS của FindLink. Bản này cần được build và ký trên Windows. |

## Quản trị và mở bán

- **Trial.** Quản trị cấp mã theo email. Khách đăng ký rồi kích hoạt tối đa **100 credits, 14 ngày và 1.000 bài gốc**. Hết trial khóa thu thập và lọc. Khách vẫn xem và export dữ liệu đã lưu.
- **Credits và API.** **1 USD = 1.000 credits**. Backend giữ Gemini key. Trang quản trị cho bật/tạm dừng AI, đặt ngân sách, cập nhật biểu giá Gemini và đối soát chi phí.
- **Starter.** **23.000.000 ₫/năm**, gồm **50.000 credits**. Khách mua hoặc gia hạn từ ứng dụng. Webhook SePay xác nhận giao dịch. Quản trị xem hạn gói, điều chỉnh credits, tạm ngừng quyền chạy và ghi nhận tiền đã hoàn.
- **Sao lưu.** Giữ cấu hình, prompt, preset và JSON kết quả. Khách khôi phục để xem và export trên máy khác. Resume dùng checkpoint trên máy đang chạy.

Backend thử chạy trên máy. Để mở bán cần backend HTTPS, Gemini key, tài khoản nhận và webhook SePay, cùng bộ cài Windows có chữ ký. [Các bước triển khai và quản trị thật](deploy/README.md)

## Phát triển

```powershell
npm run check
npm test
npm run backend:test -- --env=.env
npm run dist:starter:qa
```

[Xem kế hoạch và trạng thái từng phần](.brain/master-plan-findlink-publish-1st.md#12-kết-quả-triển-khai-starter-mvp) · [Đặc tả lưu project](.brain/specs/project-database-v1.md) · [Tài liệu phát triển](.brain/README.md)
