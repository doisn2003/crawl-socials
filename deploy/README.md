# Vận hành FindLink Starter

Dùng [bản thử](../README.md#mở-thử-starter-trên-máy-này) để xem credits, trial và mua Starter trên máy trước. Các bước dưới đây dành cho backend bán hàng qua HTTPS.

## 1. Mở trang quản trị

- **Staging** dùng tài khoản và thanh toán thử. [Quản trị staging](https://findlink-api-staging.up.railway.app/admin)
- **Production** dùng tài khoản khách hàng. [Quản trị production](https://findlink-api-production.up.railway.app/admin)

Mở service `findlink-api` trong dự án Railway `findlink-starter`. Lấy `FINDLINK_ADMIN_TOKEN` từ **Variables**. Thêm `FINDLINK_ADMIN_TOTP_SECRET` vào ứng dụng tạo mã TOTP với chu kỳ 30 giây, 6 chữ số, HMAC-SHA1. Dùng token và mã TOTP để đăng nhập. [Dự án Railway](https://railway.com/project/6f372a6d-ca74-4786-aa20-25f8f0b48a6a)

## 2. Cấu hình và cập nhật backend

Tạo một tệp cấu hình riêng theo [.env.example](../.env.example). Cất các giá trị thật trong kho secrets của máy chủ.

| Phần | Cấu hình |
|---|---|
| Database | `DATABASE_URL` của PostgreSQL, chỉ backend kết nối. |
| Địa chỉ | `FINDLINK_PUBLIC_URL` là địa chỉ HTTPS của backend. Backend mặc định nghe tại `127.0.0.1:9070` sau reverse proxy. |
| AI dùng thử | `FINDLINK_TRIAL_GEMINI_API_KEY` cho Gemini 3.1 Flash-Lite, `FINDLINK_TRIAL_DEEPSEEK_API_KEY` cho DeepSeek Flash. Cập nhật biến và redeploy khi đổi khóa. |
| SePay | `FINDLINK_SEPAY_MODE` nhận `disabled`, `test` hoặc `live`. Cấu hình secret HMAC, bank, số tài khoản và tên chủ tài khoản qua `FINDLINK_SEPAY_WEBHOOK_SECRET`, `FINDLINK_SEPAY_BANK`, `FINDLINK_SEPAY_ACCOUNT`, `FINDLINK_SEPAY_ACCOUNT_NAME`. Bank và số tài khoản khớp `gateway` và `accountNumber` trong webhook. |
| Quản trị | `FINDLINK_ADMIN_TOKEN` gồm 64 ký tự hex. Thêm `FINDLINK_ADMIN_TOTP_SECRET` dạng Base32 vào trình xác thực TOTP, chu kỳ 30 giây, 6 chữ số, HMAC-SHA1. |
| Quyền chạy | `FINDLINK_IDENTITY_SECRET` là khóa hex ổn định để đối chiếu thiết bị, trial và dẫn xuất khóa mã hóa API Starter. Giữ giá trị này khi chuyển database sang máy chủ khác. `FINDLINK_LEASE_PRIVATE_KEY` là khóa Ed25519 PKCS#8 PEM mã hóa base64. Giữ private key ở server và cung cấp public key SPKI DER mã hóa base64 cho máy build Windows. |
| Gói nạp thêm | Đặt `FINDLINK_TOPUP_PRICE_VND` nếu bán thêm gói 10.000 credits. |

Trong trình duyệt Codex, mở service `findlink-api` ở môi trường staging. Khi nhánh `findlink-publish-1st` đã có trên GitHub, dùng **Settings → Source → Connect Repo** và chọn nhánh đó. Railway dùng `Dockerfile` ở gốc repo. Trong **Settings**, đặt **Pre-deploy Command** là `node dist/backend/index.js --migrate`, **Healthcheck Path** là `/healthz` và thời gian chờ là 120 giây. [Nguồn triển khai Railway](https://docs.railway.com/services#service-source) · [Lệnh trước deploy](https://docs.railway.com/deployments/pre-deploy-command) · [Cấu hình hạ tầng trong repo](../.railway/railway.ts)

Trong Railway, đặt `PORT=9070` cho healthcheck và `FINDLINK_PORT=9070` cho tiến trình Node. Đặt `FINDLINK_BIND=0.0.0.0` và chọn target port `9070` cho public domain. Khi migration đã chạy nhưng deployment chưa phục vụ HTTPS, đối chiếu các giá trị này trong **Variables** và **Networking**, rồi đọc **Deploy Logs**. Triển khai bản đã qua kiểm tra staging lên production với database và secrets của môi trường production. [Cổng healthcheck của Railway](https://docs.railway.com/deployments/healthchecks#configure-the-healthcheck-port)

Khi chạy trên máy khác, trỏ `FINDLINK_ENV_FILE` tới tệp cấu hình đã tạo và dùng `NODE_ENV=production` cho backend HTTPS.

```powershell
npm ci
npm run build
npm run backend:migrate
npm run backend:start
```

Migration tạo schema `findlink_control` và nâng lên phiên bản 2 để thêm dấu cài đặt Windows cho trial. Giữ và sao lưu nhất quán hai schema `csd_backup` và `findlink_control`. Nếu tách role, dùng role migration để cập nhật schema và role runtime có quyền USAGE, đọc/ghi bảng và sequence liên quan.

Có thể dùng [Compose](compose.yaml) với Caddy. Đặt `FINDLINK_DOMAIN` và tạo `deploy/findlink.env`. Chạy migration rồi khởi động dịch vụ.

```powershell
docker compose -f deploy/compose.yaml run --rm backend node dist/backend/index.js --migrate
docker compose -f deploy/compose.yaml up -d --build
```

Bật `FINDLINK_TRUST_LOCAL_PROXY=1` khi proxy ghi đè `X-Real-IP` và backend chỉ nhận truy cập qua loopback. Kiểm tra HTTPS và `GET /healthz` trước khi mở trang quản trị.

## 3. Quản lý model, trial và credits

Chính sách mới khởi đầu với AI và cấp trial tạm dừng. Trang quản trị dùng credits cho ngân sách và biểu giá.

1. Mở **Ngân sách và quyền dùng thử**. Đặt ngân sách AI riêng cho trial và Starter, giới hạn trial mỗi ngày và tổng credits tài trợ. Bật phần quyền cần mở rồi bấm **Lưu ngân sách**.
2. Mở **Mã mời** và chọn **Tài khoản và dùng thử**. Tạo mã cho email đã duyệt và gửi mã riêng cho đúng khách. Mỗi mã dùng một lần. Khách chọn **Đăng ký** trong FindLink rồi bấm **Kích hoạt 100 credits dùng thử**.
3. Mở **Tài khoản và số dư** để kiểm tra gói, credits và hạn. Mục **Tài khoản và thiết bị** cho tạm ngừng quyền chạy, thu hồi trial và xử lý đổi máy. Mục **Xét duyệt trial** xử lý thiết bị đã nhận dùng thử.
4. Mở **Khóa AI Starter**. Chọn ID tài khoản, nhà cung cấp và nhập khóa API riêng đã tạo ở nhà cung cấp. Bảng **Tài khoản và số dư** hiển thị nhà cung cấp đã gán. Khi khách mới mua và đang chờ gán khóa, app báo trạng thái chờ cấu hình AI. Thu thập ở chế độ OFF, xem và xuất dữ liệu vẫn dùng được khi gói còn hạn.
5. Mở **Model và biểu giá**. Chọn **Starter** hoặc **Dùng thử**, chọn model đã có khóa cho gói đó và nhập giá theo credits trên một triệu token. Bấm **Áp dụng cho lượt mới**. Lượt đã cấp quyền giữ model và biểu giá của lượt đó. Khi phí chưa rõ, ghi bằng chứng tại **Đối soát phí AI** để xử lý khoản giữ.

FindLink mã hóa khóa API Starter trong PostgreSQL và dùng khóa theo tài khoản, nhà cung cấp. Form quản trị hỗ trợ gán, thay và thu hồi khóa. Việc tạo khóa vẫn thực hiện tại nhà cung cấp. Khi đổi model Starter sang nhà cung cấp khác, gán khóa cho các tài khoản cần chuyển trước khi áp dụng biểu giá. Khi thu hồi một khóa, yêu cầu đang chờ chưa gửi sẽ dừng và giải phóng credits đã giữ.

Khi khách kích hoạt trial, FindLink băm dấu cài đặt Windows ngay trên máy và backend lưu thêm dưới dạng HMAC trong 90 ngày. Cài lại FindLink trên cùng bản Windows có thể đưa tài khoản mới vào **Xét duyệt trial**. Hồ sơ đi theo tài khoản khi đổi khóa thiết bị. Duyệt hồ sơ vẫn áp dụng giới hạn cấp trial và ngân sách đã đặt. Các lượt đã cấp trước migration chỉ có dấu thiết bị lưu từ trước.

Gemini 3.1 Flash-Lite là model mặc định. DeepSeek Flash có giá theo khung giờ. Dùng giá cao nhất khi cần một mức dự phòng cố định. Sổ chi phí ghi usage theo phiên bản biểu giá đã chọn và dùng hóa đơn nhà cung cấp để đối soát. [Giá Gemini](https://ai.google.dev/gemini-api/docs/pricing) · [Giá DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/)

## 4. Bán, gia hạn Starter và nạp credits qua SePay

Starter hiện có giá **23.000.000 ₫/năm** và **50.000 credits**. Hai giá trị là điều khoản cố định của phiên bản này. Trang quản trị theo dõi từng đơn, hạn gói và số dư. Mục **Điều chỉnh credits Starter** cấp thêm credits hoặc hoàn debit AI có lý do.

1. Cấu hình SePay Test Mode gửi tiền vào bằng JSON HMAC-SHA256 tới `/v1/billing/webhooks/sepay` của staging. Tạo mẫu tiền tố `FL`, hậu tố đúng 12 ký tự **Số và chữ**. Chọn đúng tài khoản nhận, bật **Chỉ gửi khi có mã thanh toán** và lọc riêng tiền tố `FL`. Sau khi thử thành công, áp dụng cùng phạm vi cho tài khoản nhận đã được duyệt trong SePay Live và dùng khóa HMAC production riêng. [Cấu hình mã thanh toán](https://developer.sepay.vn/vi/sepay-webhooks/cau-hinh-ma-thanh-toan) · [SePay Test Mode](https://developer.sepay.vn/vi/sepay-webhooks/test-mode/bat-dau-nhanh)
2. Khách mở **Gói dịch vụ** và chọn **Mua Starter**, **Gia hạn Starter** hoặc **Nạp credits**. Đặt `FINDLINK_TOPUP_PRICE_VND` để mở gói nạp 10.000 credits. Khách chuyển đúng số tiền với mã đơn `FL…` rồi chọn **Kiểm tra giao dịch**.
3. Backend xác thực chữ ký, tài khoản nhận, mã đơn, số tiền và thời điểm. Giao dịch hợp lệ cấp quyền và credits một lần. Mục **Đơn hàng và hạn gói** hiện ngày bắt đầu và hết hạn. Gia hạn sớm mở credits mới từ đầu kỳ mới.
4. Dùng **Đối soát SePay** cho giao dịch ngoại lệ sau khi xác minh tiền tệ và chứng từ trong SePay. Với chuyển khoản sai mã bị bộ lọc bỏ qua, kiểm tra trực tiếp lịch sử giao dịch SePay. Sau khi đã hoàn tiền qua ngân hàng, ghi nhận trong quản trị để thu hồi quyền và credits còn lại.

## 5. Phát hành Windows

- `npm run dist:starter:qa` tạo bộ cài thử chưa ký trong `release/starter-qa`. Địa chỉ backend mặc định là `http://127.0.0.1:9070`. Có thể đặt `FINDLINK_QA_ORIGIN` khi build.
- Đặt `FINDLINK_PUBLIC_URL`, `FINDLINK_UPDATE_URL`, `FINDLINK_LEASE_PUBLIC_KEY` và `FINDLINK_SIGNING_PUBLISHER` trong môi trường build chính thức. Lấy `leasePublicKey` từ `/v1/config` của chính backend production. Dùng `FINDLINK_SIGNING_CERT_SHA1` hoặc `CSC_LINK` cùng mật khẩu chứng chỉ từ kho secrets.
- Chạy `npm run dist:starter` trên Windows. Lệnh kiểm chữ ký của FindLink và installer, kiểm publisher trong `app-update.yml`, rồi tạo `release/starter-feed/<version>` chứa installer, blockmap và `latest.yml`. Dùng phiên bản cao hơn khi phát hành bản sửa.
- Đưa hai tệp theo phiên bản lên feed HTTPS trước, rồi đưa `latest.yml` lên sau. Với Caddy trong repo, đặt tệp vào `deploy/downloads/windows` và dùng `https://<domain>/downloads/windows/` cho `FINDLINK_UPDATE_URL`.
- Chạy `npm run verify:starter-feed` bằng cấu hình build để so tệp HTTPS với gói đã ký và kiểm tra HTTP Range. Thử cài mới và cập nhật từ phiên bản trước trên máy QA. [Cập nhật tự động electron-builder v26](https://www.electron.build/v26/docs/features/auto-update/)

Trước khi mở bán, kiểm tra `npm test`, `npm run backend:test -- --env=.env`, luồng SePay Test Mode, giá và hạn mức Gemini, cài mới/cập nhật có chữ ký, và khôi phục dữ liệu trên máy QA. Bài tích hợp trong repo dùng PostgreSQL cách ly và dịch vụ mô phỏng.
