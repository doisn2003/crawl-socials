# CSD 0.2.2 — Facebook và Threads thu đồng thời

Ngày: 29/10/2026. Nhánh tiếp tục phát triển: `codex/csd-production`.

## Yêu cầu có hiệu lực

Người dùng yêu cầu sửa cách Facebook chạy xong mới tới Threads: bấm Bắt đầu phải mở cả hai cửa sổ và crawl song song. Đây là quyết định hiện hành, thay mô tả tuần tự trong bản triển khai 0.2.0. Mục tiêu tối thiểu vẫn áp dụng riêng cho mỗi mạng như đã xác nhận.

## Thay đổi

- `production-service.ts` khởi chạy các nguồn được chọn đồng thời; `Promise.allSettled` chờ toàn bộ collector và bước hoàn tất của từng nguồn. Lỗi ở một nguồn không kết thúc lượt hoặc mở khóa lượt mới khi nguồn kia vẫn chạy.
- Mỗi nguồn giữ profile, cửa sổ, config, thư mục dữ liệu, callback tiến độ và target riêng. Chỉ đối chiếu dữ liệu bền vững của nguồn đã kết thúc; không đặt lại số đếm của nguồn còn chạy. JSON tổng hợp được tạo khi cả hai đã kết thúc; dữ liệu JSONL vẫn được khôi phục sau gián đoạn.
- Stop gửi tín hiệu tới cả hai. Có kiểm tra lại tín hiệu sau bước xác minh phiên, tránh mở bộ thu nếu vừa bị dừng. Shutdown chờ cả hai hoàn tất trước khi host chung đóng. Kết thúc một nguồn không tắt cửa sổ nguồn còn lại.
- Hai bộ thu kiểm tra `webContents.isDestroyed()` trước khi lấy debugger để gỡ listener. Trước đây cleanup ngoài cùng lấy lại debugger sau `host.close`, có thể ghi đè kết quả hợp lệ bằng lỗi `Object has been destroyed`, UI rút gọn thành `COLLECTION_FAILED`.

## Bằng chứng và xác minh

- Đọc metadata lượt người dùng đã chạy, không sửa dữ liệu: receipt Facebook là `TARGET_REACHED`, session flush `OK`, 202 bài; Threads là `USER_STOP`, flush `OK`, 271 bài. UI trước sửa báo `COLLECTION_FAILED` cho cả hai. Không đưa nội dung bài, tài khoản hay cookie vào repository.
- Kiểm tra native trên Electron 44.10.0 bằng cửa sổ `about:blank` cô lập: sau sự kiện `destroyed`, `isDestroyed()` trả true và getter `debugger` ném đúng `Object has been destroyed`. Không dùng tài khoản hoặc kết nối mạng xã hội trong kiểm tra này.
- `npm run check`: PASS. `npm test`: build PASS, **453/453 tests PASS**, không skip.
- `npm run dist:portable`: PASS, tạo `release/CSD-Portable-0.2.2.exe`. Đã kiểm tra ASAR chứa phiên bản 0.2.2, bộ điều phối song song và guard cleanup của cả hai collector.
- Hồi quy service chứng minh cả hai đã vào collector trước khi nhả bất kỳ nguồn nào; thử cả hai thứ tự hoàn thành; giữ tiến độ của nguồn còn chạy; không export/start mới sớm; lỗi nguồn độc lập; Stop trong lúc kiểm tra phiên và setup; shutdown chờ cả hai; lỗi đọc kết quả không mở khóa sớm.
- Hồi quy lifecycle chạy **hai runner thật với host/observer cục bộ thay thế**, xác nhận mở hai profile cùng lúc và đóng Facebook không gỡ listener/đóng Threads. Double webContents ném lỗi khi truy cập debugger đã hủy để kiểm tra đúng lỗi cleanup.
- Log phát triển: `artifacts/parallel-qa/tests.log`; chương trình kiểm tra native: `artifacts/parallel-qa/debugger-lifecycle.cjs` (gitignored, không đóng gói).

## Giới hạn kiểm chứng

Chưa chạy một lượt crawl LIVE mới sau thay đổi. Các bài trên là metadata lượt cũ của người dùng, không phải kết quả do bản sửa thu mới. Bản CSD đang mở phải đóng và mở lại để nạp bộ điều phối 0.2.2; không tự dừng hay thay tiến trình ứng dụng người dùng đang mở.
