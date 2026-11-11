# Vận hành FindLink Starter

Dùng [bản thử](../README.md#mở-thử-starter-trên-máy-này) để xem credits, trial và mua Starter trên máy trước. Các bước dưới đây dành cho backend bán hàng qua HTTPS.

## 1. Chuẩn bị backend

Tạo một tệp cấu hình riêng theo [.env.example](../.env.example). Cất các giá trị thật trong kho secrets của máy chủ.

| Phần | Cấu hình |
|---|---|
| Database | `DATABASE_URL` của PostgreSQL, chỉ backend kết nối. |
| Địa chỉ | `FINDLINK_PUBLIC_URL` là địa chỉ HTTPS của backend. Backend mặc định nghe tại `127.0.0.1:9070` sau reverse proxy. |
| Gemini | `FINDLINK_GEMINI_API_KEY` là khóa của dự án dịch vụ. Khi đổi khóa, cập nhật trên server và khởi động lại backend. |
| SePay | `FINDLINK_SEPAY_WEBHOOK_SECRET`, `FINDLINK_SEPAY_BANK`, `FINDLINK_SEPAY_ACCOUNT`, `FINDLINK_SEPAY_ACCOUNT_NAME`. Bank và số tài khoản khớp `gateway` và `accountNumber` trong webhook. |
| Quản trị | `FINDLINK_ADMIN_TOKEN` gồm 64 ký tự hex. Thêm `FINDLINK_ADMIN_TOTP_SECRET` dạng Base32 vào trình xác thực TOTP, chu kỳ 30 giây, 6 chữ số, HMAC-SHA1. |
| Quyền chạy | `FINDLINK_IDENTITY_SECRET` là khóa hex ổn định để đối chiếu thiết bị và trial. `FINDLINK_LEASE_PRIVATE_KEY` là khóa Ed25519 PKCS#8 PEM mã hóa base64. Giữ private key ở server và cung cấp public key SPKI DER mã hóa base64 cho máy build Windows. |
| Gói nạp thêm | Đặt `FINDLINK_TOPUP_PRICE_VND` nếu bán thêm gói 10.000 credits. |

Chạy build và migration một lần cho mỗi phiên bản. Trỏ `FINDLINK_ENV_FILE` tới tệp cấu hình đã tạo và dùng `NODE_ENV=production` khi chạy backend thật.

```powershell
npm ci
npm run build
npm run backend:migrate
npm run backend:start
```

Migration thêm `findlink_control` vào database. Giữ và sao lưu nhất quán hai schema `csd_backup` và `findlink_control`. Nếu tách role, dùng role migration để tạo schema và role runtime có quyền USAGE, đọc/ghi bảng và sequence liên quan.

Có thể dùng [Compose](compose.yaml) với Caddy. Đặt `FINDLINK_DOMAIN` và tạo `deploy/findlink.env`. Chạy migration rồi khởi động dịch vụ.

```powershell
docker compose -f deploy/compose.yaml run --rm backend node dist/backend/index.js --migrate
docker compose -f deploy/compose.yaml up -d --build
```

Bật `FINDLINK_TRUST_LOCAL_PROXY=1` khi proxy ghi đè `X-Real-IP` và backend chỉ nhận truy cập qua loopback. Kiểm tra HTTPS và `GET /healthz` trước khi mở trang quản trị.

## 2. Cấp trial và quản lý credits

Mở đường dẫn **/admin** trên địa chỉ backend HTTPS. Đăng nhập bằng khóa quản trị và mã TOTP. Chính sách mới khởi đầu với AI và cấp trial tạm dừng.

1. Mở **Ngân sách và quyền dùng thử**. Đặt ngân sách AI riêng cho trial và Starter, giới hạn trial mỗi ngày và tổng credits tài trợ. Bật phần quyền cần mở rồi bấm **Lưu ngân sách**.
2. Mở **Mã mời** và chọn **Tài khoản và dùng thử**. Tạo mã cho email đã duyệt và gửi mã riêng cho đúng khách. Mỗi mã dùng một lần. Khách chọn **Đăng ký** trong FindLink rồi bấm **Kích hoạt 100 credits dùng thử**.
3. Mở **Tài khoản và số dư** để kiểm tra gói, credits và hạn. Mục **Tài khoản và thiết bị** cho tạm ngừng quyền chạy, thu hồi trial và xử lý đổi máy. Mục **Xét duyệt trial** xử lý thiết bị đã nhận dùng thử.
4. Mở **Biểu giá Gemini 3.1 Flash-Lite** để lưu phiên bản giá theo triệu token. Lượt chạy đã cấp quyền giữ biểu giá của lượt đó. Khi phí một yêu cầu chưa rõ, backend giữ dự phòng đến khi có bằng chứng để ghi ở **Đối soát phí AI**.

Phiên bản này dùng Gemini 3.1 Flash-Lite. Khóa API nằm trong cấu hình server. Trang quản trị thay bảng giá, ngân sách và quyền sử dụng cho model này. DeepSeek nằm ở chặng sau.

## 3. Bán và gia hạn Starter qua SePay

Starter hiện có giá **23.000.000 ₫/năm** và **50.000 credits**. Hai giá trị là điều khoản cố định của phiên bản này. Trang quản trị theo dõi từng đơn, hạn gói và số dư. Mục **Điều chỉnh credits Starter** cấp thêm credits hoặc hoàn debit AI có lý do.

1. Cấu hình SePay gửi giao dịch tiền vào bằng JSON HMAC-SHA256 tới `/v1/billing/webhooks/sepay`. Dùng Test Mode kiểm tra trước. [Xác thực webhook](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc) · [SePay Test Mode](https://developer.sepay.vn/en/tien-ich-khac/test-mode/mo-phong-giao-dich)
2. Khách bấm **Mua Starter** hoặc **Gia hạn Starter** trong ứng dụng và chuyển đúng số tiền với mã đơn `FL…`.
3. Backend xác thực chữ ký, tài khoản nhận, mã đơn, số tiền và thời điểm. Giao dịch hợp lệ cấp quyền và credits một lần. Mục **Đơn hàng và hạn gói** hiện ngày bắt đầu và hết hạn. Gia hạn sớm mở credits mới từ đầu kỳ mới.
4. Dùng **Đối soát SePay** cho giao dịch ngoại lệ. Sau khi đã hoàn tiền qua ngân hàng, ghi nhận trong quản trị để thu hồi quyền và credits còn lại.

## 4. Phát hành Windows

- `npm run dist:starter:qa` tạo bộ cài thử chưa ký trong `release/starter-qa`. Địa chỉ backend mặc định là `http://127.0.0.1:9070`. Có thể đặt `FINDLINK_QA_ORIGIN` khi build.
- Đặt `FINDLINK_PUBLIC_URL`, `FINDLINK_UPDATE_URL`, `FINDLINK_LEASE_PUBLIC_KEY` và `FINDLINK_SIGNING_PUBLISHER` trong môi trường build chính thức. Dùng `FINDLINK_SIGNING_CERT_SHA1` hoặc `CSC_LINK` cùng mật khẩu chứng chỉ từ kho secrets.
- Chạy `npm run dist:starter` trên Windows. Đưa installer và blockmap lên feed HTTPS trước `latest.yml`. Thử cài mới và cập nhật với bản đã ký. [Cập nhật tự động electron-builder v26](https://www.electron.build/v26/docs/features/auto-update/)

Trước khi mở bán, kiểm tra `npm test`, `npm run backend:test -- --env=.env`, luồng SePay Test Mode, giá và hạn mức Gemini, cài mới/cập nhật có chữ ký, và khôi phục dữ liệu trên máy QA. Bài tích hợp trong repo dùng PostgreSQL cách ly và dịch vụ mô phỏng.
