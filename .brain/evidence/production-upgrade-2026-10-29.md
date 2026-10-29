# CSD production upgrade — 29/10/2026

> Báo cáo này ghi nhận bản triển khai ban đầu. Cơ chế chạy lần lượt đã được thay bằng **crawl song song ở 0.2.2** theo yêu cầu người dùng; xem [kiểm chứng cập nhật](parallel-collection-2026-10-29.md).

## Quyết định và phạm vi

Người dùng chọn nhánh mới làm nền phát triển; nhánh được tạo là **`codex/csd-production`**, từ working tree đang có Facebook/Threads. Người dùng xác nhận **mục tiêu tối thiểu được áp dụng riêng cho mỗi mạng**. Quyết định gốc: [ADR-021](../decisions/ADR-021-production-branch.md).

Đã triển khai giao diện dark terminal, font monospace và inline SVG logo; cấu hình keywords/target Save on Blur; login mặc định mở được không cần CLI flag; chỉ nguồn có phiên đăng nhập mới được tick; hai collector chạy thật qua UI với Stop và kết quả bền vững; xuất JSON kết hợp và Excel `Facebook Posts` + `Thread Posts` theo ảnh tham chiếu. TikTok/Instagram/X/Reddit mờ, không chọn được.

Không nạp data mẫu, cấu hình cà phê, offline-bootstrap hoặc probe vào entrypoint. Build dọn output cũ, biên dịch tập dependency production, copy hai collector. Fixture, historical diagnostics và các phép thử developer không nằm trong gói ứng dụng. Dữ liệu thật cũ và ID/partition tài khoản được giữ.

## Xác minh đã chạy

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run check` | PASS: main, preload, renderer, unit test types |
| `npm test` | **446/446 PASS**, không skip |
| Exporter XLSX | 4 ca roundtrip: ID dài giữ string, Unicode/formula-like text là literal, null/0, hyperlinks, filter, freeze, 2 sheet, sheet trống, giới hạn ô |
| Production service + config | 17 ca: auth gate, target riêng, hai nguồn, concurrency start/login, Stop giữ JSON, recovery gián đoạn, lỗi ghi đĩa, session flush |
| Collector lifecycle | 14 ca: import không bootstrap/exit, cleanup observer, chỉ đóng profile sở hữu, early Stop, navigation failure, session-flush retry/failure |
| Native Electron UI | PASS: entrypoint thật, renderer/preload/main; chưa có dữ liệu thì empty state; không tick khi chưa login |
| Save on Blur | PASS: từ khóa và target được ghi disk, target không hợp lệ không thay bản đã lưu |
| Native restart | PASS: config và encrypted session cookies giữ qua hai process, không mở website trong test |
| Native export UI | PASS: nút XLSX/JSON qua IPC và save-dialog result tới file, đọc lại đủ 2 mạng; Cancel không sửa nguồn; text HTML không thực thi |
| Giao diện | PASS: ảnh desktop và 800px không tràn ngang, không renderer exception |
| Package contents | PASS: kiểm `app.asar`, không fixture/bootstrap/probe/campaign data; có secret store và exporter |
| Bản Windows đóng gói | PASS: CSD 0.2.0 chạy từ `release/win-unpacked/CSD.exe`, runtime Electron 44.10.0; nhận lại Facebook + Threads đang đăng nhập trên appData thật, không lỗi persistence/renderer, không bắt đầu crawl |
| Dependencies | Electron cập nhật **44.10.0**, ExcelJS 4.4.0 + override uuid 11.1.1; **`npm audit`: 0 vulnerabilities** |

Bản Electron 44.7.0 ban đầu có advisory chứng thư TLS; đã lên bản vá cùng major. Nguồn: [Electron advisory](https://github.com/electron/electron/security/advisories/GHSA-jr5w-w6x2-84p9), [release 44.10.0](https://releases.electronjs.org/release/v44.10.0). Sau cập nhật đã chạy lại check và cả hai bài native UI/restart/export, đều PASS. Cookie names Threads đã đối chiếu metadata local (`sessionid` + `ds_user_id` trên `.threads.com`), không đọc hoặc xuất giá trị.

Bằng chứng cục bộ (ignored): `artifacts/production-qa/` chứa ảnh desktop/narrow/results, report JSON, output kiểm tra và gói log. Data kiểm tra chỉ ở thư mục temp riêng `csd-production-ui-*`, không ghi vào appData thật hay gói phát hành. Trong lượt này **không thực hiện thêm crawl LIVE** và không đánh giá relevance của dataset cũ.

## Giới hạn cần hiểu đúng

- Badge đăng nhập dựa trên session cookie của đúng origin, thời hạn cục bộ và trạng thái barrier đã thấy; server vẫn có thể thu hồi. Bộ thu phát hiện challenge/login rồi dừng và yêu cầu đăng nhập lại.
- Phiên persistent không phải hứa vượt thời hạn của nền tảng. Snapshot session cookie được mã hóa; lỗi lưu phiên được báo dù số bài đã đạt target.
- Target UI hiện 1–3.000, riêng từng mạng; mỗi nguồn tối đa 4 giờ và số lần cuộn đã ghi trong README. Kết thúc sớm không được báo đạt target. Bài thô có thể chưa được đánh giá liên quan.
- Khi app đóng bất thường, mở lại báo INTERRUPTED và phục hồi dữ liệu JSONL đã ghi, bỏ riêng dòng cuối bị cắt; không tự crawl tiếp. Bắt đầu lượt mới không xóa thư mục lượt cũ.
- Excel giữ số liệu đúng nghĩa từng mạng. Chuỗi vượt giới hạn ô Excel làm xuất báo lỗi và hướng dẫn JSON; không lặng lẽ cắt dữ liệu.

## Bàn giao

Mọi phát triển tiếp tục từ nhánh `codex/csd-production`. `.brain/README.md`, master plan, branch plan và các prompt handoff cũ đã được cập nhật hiệu lực theo ADR-021. Không quay lại UI thử nghiệm hoặc tự chạy worker/dispatch cũ. Chất lượng nội dung và các ý tưởng mở rộng vẫn là công việc độc lập, không biến thành gate chặn luồng sản phẩm mà người dùng vừa chọn.
