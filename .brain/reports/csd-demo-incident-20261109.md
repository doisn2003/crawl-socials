# Sự cố demo cafe trên máy khách và bản sửa 5.4

Ngày phân tích: 09/11/2026. Nhánh: `production-v2`.

## Kết luận có bằng chứng

Hai lượt Quality không bắt đầu thu thập vì kẹt ở khâu cấp lượt mở cửa sổ. Đây là lỗi điều phối tài nguyên của CSD, xảy ra trước parser và bộ lọc. Với đúng hai mẫu RAM đã lưu, bộ điều phối cũ không thể cấp cửa sổ đầu tiên; kiểm thử hồi quy tái hiện thất bại trước khi sửa và vượt qua sau khi sửa.

Một lượt Standard còn ghi nhận hai lỗi vận chuyển yêu cầu tới Gemini. Lần thử lại sau đó tạo kế hoạch thành công. Không có `run-state.json` hoặc checkpoint thu thập cho lượt Standard này; không suy diễn rằng bộ lọc Standard đã loại hết bài.

Gói log chỉ chứa bốn lượt sau khi người dùng xóa dữ liệu. Không có bằng chứng đủ để kết luận nguyên nhân của lần demo đầu tiên, của lượt 500 bài trước đó, hoặc rằng thêm tài khoản chưa đăng nhập trực tiếp làm hỏng phiên. Không yêu cầu người dùng xóa dữ liệu để phục hồi.

## Dữ liệu đối chiếu

Nguồn: `CSD-logs-20261109-080030-de29b5.zip` (259.804 byte), 119 file chẩn đoán, không có mục bị lược do lỗi đọc/kích thước. SHA-256:

`b1d23f2f9e1f03b08be1d3898a93aa844f6699a2fec5e87abb0dd1d06a375cc9`

Các thời điểm bên dưới là giờ Việt Nam/Asia/Bangkok ngày 08/11/2026.

| Lượt | Thời điểm | Bằng chứng |
| --- | --- | --- |
| Consistent, mục tiêu 100 | 15:10:12–15:14:03 | Hoàn tất, 287 bài gốc trong pipeline; 101 bài được AI nhận, mục tiêu tính 100 và dư 1. 185 bài không phù hợp, 1 chờ xác định ngôn ngữ. Chi phí có usage $0,128280. |
| Standard, mục tiêu 100 | 15:16:41–15:17:39 | Hai lần `MODEL_NETWORK_USAGE_UNKNOWN`; lần ba HTTP 200 và kế hoạch trạng thái DRAFT/SUCCEEDED. Đo được $0,00463375; $0,0795785 là dự phòng chưa biết usage, không phải tiền thực thu đã xác nhận. Không có lượt crawl được ghi nhận. |
| Quality, mục tiêu 20 | 15:29:16–15:34:53 | 63 từ khóa × 2 nguồn; cả 126 tác vụ có `attempts=0`. 0 bài thô. Người dùng dừng sau khoảng 5 phút 37 giây. Chỉ có 2 lời gọi lập/mở rộng kế hoạch, không có lời gọi phân loại bài. |
| Quality, mục tiêu 20, prompt sửa nhẹ | 15:35:16–15:37:48 | 96 từ khóa × 2 nguồn; cả 192 tác vụ có `attempts=0`. 0 bài thô. Người dùng dừng sau khoảng 2 phút 32 giây. Chỉ có 3 lời gọi lập/mở rộng kế hoạch. |

Số bài ở bảng trên là trạng thái hệ thống/nhãn AI, không phải đo độ hữu ích do con người kiểm định. Tổng bản ghi nguồn ở lượt Consistent là 314; pipeline chuẩn hóa về 287 bài gốc. Không cộng hai loại đếm này thành một.

Gói có hai hồ sơ Facebook/Threads, không có marker phục hồi phiên dang dở. Nhãn `accountBinding.UNVERIFIED` là cấu trúc hồ sơ mặc định, không phải bằng chứng chưa đăng nhập.

## Điểm nghẽn RAM

Máy báo tổng RAM 12.674.457.600 byte. Quy tắc cũ yêu cầu RAM trống tối thiểu:

`max(512 MiB, tổng RAM × 12%) + 384 MiB = 1.923.588.096 byte`

Hai checkpoint cuối của các lượt Quality có RAM trống 1.532.497.920 và 1.709.322.240 byte, CPU bận khoảng 15,12% và 3,75%, không có cửa sổ tìm kiếm hoạt động. Cả hai đều nằm dưới ngưỡng mở cửa sổ đầu tiên. Hàng chờ không có thời hạn riêng khi thiếu RAM; giao diện tiếp tục báo đang thu thập dù chưa có tác vụ nào được cấp lượt.

Checkpoint là ảnh chụp cuối lượt, không phải chuỗi đo RAM liên tục cả phiên. Kết luận dựa trên checkpoint, toàn bộ `attempts=0`, không có log collector con và tái hiện quy tắc cũ với đúng số liệu đã lưu. Không khẳng định CSD là nguyên nhân chiếm hết RAM, vì gói không có thống kê bộ nhớ theo tiến trình.

## Những thay đổi

- Giữ phần dự phòng theo tỷ lệ để quyết định chạy song song; khi phần đó chặn mọi cửa sổ, cho chạy tối đa một cửa sổ nếu vẫn đủ 512 MiB dự phòng hệ điều hành cộng 384 MiB cho cửa sổ. Chế độ FAST cũng không vượt giới hạn một cửa sổ trong trường hợp này. Ngưỡng là chính sách cấp lượt, không phải cam kết một trang Facebook chỉ dùng 384 MiB.
- Sửa trường hợp giới hạn cửa sổ bị giữ ở 0 sau khi RAM đã hồi phục vào dải 12–20% tổng RAM.
- Nếu không đủ mức tối thiểu và không có cửa sổ hoạt động, chờ tối đa 60 giây rồi dừng với mã `RESOURCE_MEMORY_WAIT`; dữ liệu và checkpoint vẫn còn để tiếp tục.
- Phát trạng thái tài nguyên định kỳ trong lúc chờ. Hiển thị “Đang chờ RAM”, hướng dẫn đóng bớt ứng dụng và tiếp tục. Khi chưa có bài thô, hiển thị “Chờ bài viết để lọc”.
- Tác vụ chưa chạy bị dừng do người dùng, đạt mục tiêu hoặc thiếu RAM được ghi là STOPPED; không ghi lẫn thành FAILED.
- Lỗi kết nối Gemini được giải thích riêng, vẫn giữ kế toán dự phòng và số lần retry cũ. Bổ sung mã transport đã kiểm soát như lỗi DNS/connect-timeout cho log sau này; không ghi URL, headers hay thông báo lỗi có thể chứa bí mật. Log cũ không đủ để phân biệt DNS/TLS/proxy/mạng.
- Tăng phiên bản nội bộ thành `0.4.0-rebuild.5.4`; giữ thay đổi giao diện đã có trên nhánh. Không đổi độ chặt bộ lọc, không tự chi tiền inference và không xóa AppData/ledger.

## Kiểm chứng

- Trước sửa: hai kiểm thử với số RAM thực từ log đều thất bại vì không cấp cửa sổ.
- Sau sửa: 1.110/1.110 kiểm thử hồi quy qua, gồm luồng chạy liên tiếp, 63/96 từ khóa trên hai nguồn, tài khoản chưa đăng nhập không được chọn, nhiều tài khoản chia lượt, chờ RAM có giới hạn và tiếp tục cùng checkpoint. Các collector/model trong hồi quy được giả lập, không phải crawl mạng xã hội thật.
- Renderer Electron thật: tài khoản đã/chưa đăng nhập, thông báo chờ RAM, thông báo tạm dừng, bốn chế độ, xuất dữ liệu và giữ vị trí đọc đều qua; 0 lỗi renderer, 0 yêu cầu mạng/model.
- Main/preload/renderer lấy trực tiếp từ `release/win-unpacked/resources/app.asar`: khởi động phiên bản 5.4, bốn chế độ và giới hạn đã lưu hoạt động; AppData và ledger thử nghiệm tách biệt, 0 lời gọi model.
- Các bằng chứng cục bộ ở `artifacts/demo-incident-20261109`: gói nhận vào, `incident-summary.json`, `regression.log`, `ui-smoke`, `packaged-smoke` và `build.log`. Chúng không nằm trong commit.

Không có kiểm thử crawl Facebook/Threads thật trên máy khách trong đợt sửa này. Bản sửa xử lý lỗi đã tái hiện; không chứng minh mọi sự cố đăng nhập, mạng hay thay đổi của nền tảng đều đã được xử lý. Không mở lại bất kỳ hạn mức DEVELOPMENT đã đóng nào.

## Sử dụng bản sửa

File: `release/CSD-Portable-production-v2-20261109-hotfix1.exe`, 102.539.851 byte, phiên bản `0.4.0-rebuild.5.4`, chưa ký Authenticode.

SHA-256: `2931746760149DAB1EB8D400A68C43156BB1A0885847B0FD4FD5991AE7CBF7C0`.

Đã trích xuất `resources/app.asar` và `CSD.exe` từ chính portable, xác nhận khớp từng byte bằng SHA-256 với bản unpacked đã kiểm tra. Không chạy portable vào AppData thật, không phát hành lên dịch vụ bên ngoài.

Đóng CSD cũ, chạy bản hotfix mới trên cùng tài khoản Windows rồi chọn **Tiếp tục lượt này**. Giữ nguyên `%APPDATA%/csd-desktop` và `%USERPROFILE%/.csd/spending`. Với một lượt Standard chỉ còn kế hoạch DRAFT, bắt đầu thu thập từ kế hoạch hoặc chọn Thử lại kế hoạch nếu giao diện báo lỗi kết nối; không xóa dữ liệu.
