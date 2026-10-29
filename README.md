# CSD — Crawl Socials Data

Ứng dụng desktop Windows thu bài viết theo từ khóa từ Facebook và Threads, lưu JSON và xuất một workbook Excel gồm `Facebook Posts` và `Thread Posts`.

## Nhánh phát triển được chọn

Từ ngày **29/10/2026**, người dùng chọn **`codex/csd-production`** làm nền phát triển tiếp theo. Bản này kế thừa bộ thu Facebook/Threads hiện có và thay màn hình PoC bằng luồng sử dụng thật. Xem [.brain/decisions/ADR-021-production-branch.md](.brain/decisions/ADR-021-production-branch.md). Các kế hoạch thử nghiệm cũ được giữ làm lịch sử, không còn điều khiển ứng dụng.

## Chạy ứng dụng

Cần Node.js theo `engines` trong `package.json` và Windows x64.

```powershell
npm ci
npm start
```

1. Nhập từ khóa, **mỗi dòng một từ khóa**. Rời ô để lưu tự động.
2. Nhập mục tiêu tối thiểu (1–3.000 bài). Rời ô để lưu. **Mỗi mạng được chọn có mục tiêu riêng**; ví dụ nhập 1.000 và chọn cả hai thì mục tiêu là 1.000 Facebook + 1.000 Threads.
3. Đăng nhập tài khoản trong cửa sổ của từng mạng. Chỉ nguồn có phiên đăng nhập mới được tick chọn.
4. Bấm **Bắt đầu thu thập**. Facebook và Threads mở hai cửa sổ riêng và **chạy song song**, mỗi mạng có tiến độ và mục tiêu riêng. Một mạng xong hoặc gặp lỗi không chặn mạng còn lại. Nút **Dừng** dừng cả hai, chờ lưu dữ liệu rồi cho phép xuất số bài đã thu được.
5. Bấm **Xuất Excel .xlsx** hoặc **Xuất JSON**, chọn nơi lưu. Workbook có hai sheet kể cả khi một mạng không có kết quả; hàng tiêu đề xanh, bộ lọc, cố định hàng đầu, ID dạng chuỗi, link bấm được. Giá trị thiếu để trống, không đổi thành 0.

Giao diện không có dữ liệu mẫu, campaign nháp, offline-check, source-probe hoặc công tắc thử nghiệm. TikTok, Instagram, X, Reddit là badge mờ chưa thể chọn.

Mục tiêu là số bài thô không trùng trong từng lượt, không phải cam kết chắc chắn đạt được: dữ liệu nguồn, phiên hết hạn, mạng, giới hạn 4 giờ/mạng, 50 lần cuộn/từ khóa Facebook và 100 lần cuộn/từ khóa Threads có thể kết thúc lượt sớm. Ứng dụng báo chưa đạt nếu nguồn kết thúc trước mục tiêu. Không tự đánh giá mức liên quan của nội dung. Có thể vượt mục tiêu một batch hoặc khi đi qua các từ khóa.

## Make it cooler

Bật toggle ở góc dưới bên phải để mở cửa sổ terminal khi bắt đầu thu thập. Hai thanh Facebook/Threads cố định phía trên hiển thị tiến độ thật, nền nhị phân xanh hacker chạy nhẹ bên dưới. Bật khi đang thu cũng mở terminal; tắt hoặc đóng terminal không dừng lượt thu. Tùy chọn được lưu qua lần mở ứng dụng tiếp theo. Hiệu ứng dừng khi thu xong, cửa sổ bị ẩn hoặc hệ điều hành yêu cầu giảm chuyển động.

## Phiên và dữ liệu

- `%APPDATA%/csd-desktop/data/user-config.json`: cấu hình thật, ghi nguyên tử; lần đầu danh sách từ khóa trống.
- `data/browser-profiles.json`: giữ nguyên ID và nền tảng của profile cũ.
- `browser/`: partition Chromium `persist:csd-v1-<id>` riêng cho mỗi tài khoản.
- `secrets/`: bản sao session cookie mã hóa bằng Windows safeStorage, không có plaintext fallback.
- `data/collections/crawl-<uuid>/facebook/` và `threads/`: `posts.jsonl`, `posts.json`, config và nhật ký lượt chạy.
- `results.json`: kết quả kết hợp của lượt; `data/latest-run.json`: trạng thái lượt gần nhất. Sau khi đóng bất thường, mở lại sẽ báo gián đoạn và giữ dữ liệu đã ghi; không tự chạy lại.

Đóng ứng dụng hoặc cửa sổ tài khoản không xóa đăng nhập. Facebook/Threads vẫn có quyền hết hạn hoặc thu hồi phiên; lúc đó phải đăng nhập lại. Ứng dụng chỉ đưa trạng thái phiên ra UI, không đưa cookie hay mật khẩu qua IPC. Khi checkpoint/challenge xuất hiện, bộ thu dừng; người dùng xử lý trực tiếp trong cửa sổ đăng nhập.

## CLI

```powershell
npm run collect:facebook -- --query "từ khóa của bạn" --target 1000
npm run collect:threads -- --query "từ khóa của bạn" --target 1000
```

CLI yêu cầu từ khóa hoặc config rõ ràng, không tự nạp bộ từ khóa mẫu. Đóng ứng dụng trước khi dùng CLI với cùng profile. Điều khiển lượt CLI bằng `collector:control` / `threads:control -- --config <path> --stop` hoặc `--export`; tiếp tục CLI bằng `collect:facebook` / `collect:threads -- --config <path> --resume`. Luồng UI không đọc mật khẩu từ `.env`; helper đăng nhập CLI Threads trước đây chỉ dùng khi chạy CLI.

## Phát triển và đóng gói

```powershell
npm run check
npm test
npm run pack:dir
npm run dist:portable
```

`src/main/index.ts` chỉ có composition root production. `src/application/production-service.ts` quản lý config, đăng nhập, lượt thu và kết quả. `scripts/*-collector.mjs` dùng chung bộ thu đã có cho CLI và UI. `src/infrastructure/export/social-workbook.ts` xuất Excel bằng ExcelJS. `src/renderer/` chỉ gọi bridge hẹp trong preload, không có Node hoặc truy cập tài khoản trực tiếp.

Build xóa output cũ rồi chỉ biên dịch dependency production, copy hai bộ thu và tài nguyên UI; không đóng gói dữ liệu mẫu, fixture, bootstrap hoặc probe. Unit fixtures và các kiểm tra hồi quy cũ chỉ phục vụ phát triển, không xuất hiện trong ứng dụng. Hướng dẫn cho AI Agent bắt đầu ở [.brain/README.md](.brain/README.md).
