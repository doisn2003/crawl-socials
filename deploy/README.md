# Triển khai FindLink Starter

FindLink Starter dùng một dịch vụ Node.js và PostgreSQL. Desktop lưu bài, phiên mạng xã hội và bản xuất trên máy. Backend quản lý tài khoản, mã mời, quyền chạy, ví credits, Gemini, SePay và sao lưu. Hệ thống thanh toán hỗ trợ Starter 23.000.000 VND mỗi năm và 50.000 credits. Gói nạp thêm 10.000 credits có giá do người vận hành cấu hình. Trial theo mã mời có 100 credits, 14 ngày và 1.000 bài gốc. Đăng ký public và SMS OTP nằm sau pilot.

## Môi trường

1. Dùng Node.js theo [.node-version](../.node-version). Chạy `npm ci` và `npm run build`.
2. Tạo file môi trường riêng theo [mẫu](../.env.example). Đặt `NODE_ENV=production` khi chạy thực tế. Dùng một hostname HTTPS, `DATABASE_URL` của backend, key Gemini của dự án dịch vụ, khóa webhook SePay, thông tin tài khoản nhận và khóa quản trị. Với PostgreSQL đi qua mạng công cộng, cấu hình xác minh chứng chỉ TLS và chỉ cho backend kết nối.
3. Tạo khóa ký lease Ed25519 và giữ private key trong kho secrets. `FINDLINK_LEASE_PRIVATE_KEY` là PKCS#8 PEM mã hóa base64. `FINDLINK_LEASE_PUBLIC_KEY` dùng khi build desktop là SPKI DER mã hóa base64. Giữ `FINDLINK_IDENTITY_SECRET` ổn định để các dấu đã nhận trial và thiết bị vẫn đối chiếu được. Khóa quản trị là 64 ký tự hex. Secret TOTP dùng Base32, HMAC-SHA1, 6 chữ số, chu kỳ 30 giây.
4. Dùng `FINDLINK_ENV_FILE` chỉ tới file cấu hình backend. Chạy `npm run backend:migrate` bằng role migration, sau đó `npm run backend:start` bằng role runtime. Migration thêm schema `findlink_control` và giữ khóa ngoại, ID và dữ liệu của `csd_backup`. Runtime cần quyền USAGE trên hai schema và quyền đọc/ghi bảng cùng sequence phục vụ ứng dụng. Role runtime có thể tách khỏi role tạo schema. Backend mặc định bind `127.0.0.1:9070`.
5. Có thể dùng [Compose](compose.yaml) với Caddy. Tạo `deploy/findlink.env` và đặt `FINDLINK_DOMAIN` cho Compose. Chạy `docker compose -f deploy/compose.yaml run --rm backend node dist/backend/index.js --migrate`, rồi `docker compose -f deploy/compose.yaml up -d --build`. Reverse proxy dùng cùng network namespace với backend. Chỉ đặt `FINDLINK_TRUST_LOCAL_PROXY=1` khi proxy tin cậy ghi đè `X-Real-IP` và backend chỉ nhận truy cập qua loopback. Kiểm tra HTTPS và `GET /healthz`.

Môi trường kiểm thử sử dụng database riêng và mock Gemini/SePay. Các yêu cầu AI và ngân sách trial khởi đầu ở trạng thái tạm dừng. Truy cập `/admin` bằng khóa quản trị và TOTP để đặt hạn mức cho tài khoản trả phí, tách hạn mức trial, và cấp mã mời. Có thể dừng cấp trial mới mà vẫn phục vụ khách đã được cấp. Chỉ bật quỹ tài trợ sau khi quyết định ngân sách vận hành.

## SePay

Cấu hình sự kiện tiền vào cho tài khoản nhận và JSON HMAC-SHA256 tại `/v1/billing/webhooks/sepay`. Đặt `FINDLINK_SEPAY_BANK` theo trường `gateway` và `FINDLINK_SEPAY_ACCOUNT` theo `accountNumber` của giao dịch nhận. Backend dùng bytes gốc và kiểm tra timestamp trước khi phân tích JSON. Nếu tạo webhook qua API SePay, dùng dạng cấu hình HMAC được SePay hỗ trợ. [Xác thực webhook](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc) · [Tích hợp webhook](https://docs.sepay.vn/tich-hop-webhooks.html)

Đơn hàng có mã riêng bắt đầu bằng `FL`. Cho phép SePay gửi giao dịch với trường `code` rỗng để backend đối chiếu mã trong nội dung chuyển khoản. Đối chiếu ngân hàng, tài khoản nhận, mã đơn, số tiền VND và thời điểm giao dịch. Mỗi SePay transaction ID được ghi một lần. Trường hợp sai số tiền, mã hoặc thời điểm vào danh sách đối soát. Gói chỉ mở khi thanh toán được áp dụng trong transaction PostgreSQL. Gia hạn trước hạn giữ credits kỳ mới đến ngày bắt đầu kỳ đó. Tác vụ hoàn tiền trong quản trị ghi nhận khoản đã hoàn và thu hồi quyền còn lại. Dùng Test Mode của SePay để thử giao dịch với cấu hình staging trước khi mở checkout thật. [Mô phỏng giao dịch SePay](https://developer.sepay.vn/en/tien-ich-khac/test-mode/mo-phong-giao-dich)

## Mã mời, thiết bị và credits

Quản trị cấp mã một lần theo email cho đăng ký, dùng thử hoặc đặt lại mật khẩu. Chuyển mã đến đúng địa chỉ đã duyệt qua kênh của doanh nghiệp. Khách cũ đăng nhập bằng mật khẩu đã dùng với `csd_backup`, rồi nhập mã mời để liên kết địa chỉ đã xác minh. Mã dùng thử chỉ cho phép kích hoạt khi quỹ còn đủ. Tài khoản dùng lại thiết bị trial chuyển sang xét duyệt. Khi đổi máy, quản trị có thể thu hồi máy cũ hoặc chuyển quyền trial sang máy đã đăng ký của cùng tài khoản. Lịch sử grant được giữ trên server.

Chủ tài khoản Starter được đăng ký tối đa hai thiết bị và chạy một lượt cùng lúc. Run lease tối đa 120 giây và gia hạn khoảng một phút. Server xét quyền và ngân sách lại trước khi gọi Gemini. Mỗi request giữ chi phí trần trong transaction. Worker đánh dấu dispatch trước khi gọi provider. Timeout hoặc crash sau mốc này giữ ngân sách cho tới khi đối soát, và tạm dừng yêu cầu AI mới của lượt đó. Quản trị ghi nhận số chi phí xác minh và bằng chứng qua mục đối soát AI. Dùng ledger provider để so sánh hóa đơn và ledger credits để giải thích debit của khách.

Backup gửi cấu hình, prompt, preset và JSON kết quả đã lưu theo manifest có checksum. Máy khác khôi phục để xem và export kết quả. Resume dùng checkpoint trên máy đang chạy. Giới hạn Starter là 5 GB dữ liệu lưu trên server, 5 project có backup đang hoạt động và 128 MiB mỗi blob. Bản desktop vẫn lưu và export dữ liệu local khi quyền chạy hết hạn hoặc backup vượt giới hạn.

## Đóng gói Windows

- Chạy `npm run dist:starter:qa` để tạo installer QA chưa ký hoặc `npm run pack:starter:qa` để tạo bản unpacked. QA dùng định danh cài đặt và AppData riêng. `FINDLINK_QA_ORIGIN` có thể trỏ tới backend cách ly. Thư mục kết quả là `release/starter-qa`. Chạy `node scripts/starter-desktop-smoke.mjs` để kiểm tra ứng dụng đóng gói với backend giả lập.
- Đặt `FINDLINK_PUBLIC_URL`, `FINDLINK_UPDATE_URL`, `FINDLINK_LEASE_PUBLIC_KEY` và `FINDLINK_SIGNING_PUBLISHER` trong môi trường build. Dùng `FINDLINK_SIGNING_CERT_SHA1` cho chứng chỉ có private key trong Windows hoặc `CSC_LINK`/ `WIN_CSC_LINK` cùng mật khẩu tương ứng do CI cung cấp. Có thể trỏ `FINDLINK_RELEASE_ENV` tới file cấu hình build riêng.
- Chạy `npm run dist:starter` trên Windows. Script tạo NSIS x64, yêu cầu ký Authenticode hợp lệ, kiểm tra gói không chứa backend hoặc file bí mật, rồi xác minh metadata cập nhật. Mặc định phiên bản Starter là 0.5.0. Đặt `FINDLINK_STARTER_VERSION` cao hơn khi phát hành bản cập nhật. Cài bản cập nhật sau khi FindLink đã dừng và lưu xong dữ liệu.
- Tải installer, blockmap và `latest.yml` lên URL feed HTTPS đã cấu hình khi phát hành. `latest.yml` được đưa lên sau các tệp nó tham chiếu. Kiểm tra cài mới, nâng cấp, chữ ký và khôi phục bản lưu trên máy QA trước khi phân phối. [Auto update electron-builder v26](https://www.electron.build/v26/docs/features/auto-update/)

## Kiểm chứng trước khi phân phối

Chạy `npm test` và `npm run backend:test -- --env=.env`. Bài tích hợp tạo database tên `findlink_it_…` riêng trên cụm PostgreSQL được cấp quyền, dùng mock provider và dọn database đó sau test. Sao lưu nhất quán cả `csd_backup` và `findlink_control` để có thể khôi phục cùng lúc dữ liệu dự án, số dư và trạng thái thanh toán. Thử khôi phục vào database cách ly. Kiểm tra cấu hình HTTPS, quyền cập nhật có chữ ký, flow SePay Test Mode, đối chiếu giá Gemini, và xác nhận các giới hạn vận hành trong quản trị trước khi bật Starter cho khách. Giữ mật khẩu, khóa ký, SePay secret và Gemini key trong kho secrets vận hành.
