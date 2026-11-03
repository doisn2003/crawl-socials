# ADR-024 — Crawl nhiều cửa sổ và điều phối Gemini

- Ngày: 03/11/2026, Asia/Bangkok.
- Nhánh triển khai: `codex/crawl-throughput`, nền RC4; giữ độc lập với `codex/ai-foundation` theo ADR-023.
- Người dùng yêu cầu tìm song song các từ khóa đã phân rã và khai thác quota Gemini 3.5 Flash Lite đã nâng Tier 1.

## Quyết định

Tách giới hạn của nguồn xã hội và giới hạn inference. Mỗi nguồn có 1–3 collector, một cửa sổ Electron và một observer riêng cho mỗi collector. Các cửa sổ của cùng hồ sơ chia sẻ Session đăng nhập; hồ sơ khác vẫn cách ly. Không nhân bản tài khoản/cookie sang hồ sơ khác. Khi đóng một cửa sổ, không đóng kết nối Session nếu cửa sổ khác còn dùng.

Chia truy vấn theo vòng tròn thành các nhóm cố định trong mỗi lượt chạy. Cách này giữ được frontier/độ sâu/pagination hiện tại của từng collector, có thể Stop/Resume mà không đổi cách chia giữa chừng. Mỗi nhóm có thư mục và checkpoint riêng dưới `workers/worker-N`; một coordinator ghi kho bài thô tổng của nền tảng. Bộ lọc vẫn nhận mọi quan sát, kể cả bằng chứng cập nhật trên ID đã gặp; khử trùng bài thô không loại bỏ quan sát mới.

Nếu gặp rào cản tài khoản thì dừng các collector cùng hồ sơ, đợi hoàn tất ghi/flush rồi mới trả quyền điều khiển. Không tự vượt rào cản hoặc thử lại bằng tài khoản khác. User Stop, deadline, ngân sách, lưu trữ và backpressure vẫn áp dụng. Các trang đã được nhận có thể làm số bài thô vượt mốc dừng một số bài; lưu bằng chứng đang nhận thay vì cắt bỏ lô giữa chừng.

## Mức vận hành

| Mức | Cửa sổ mỗi mạng | Worker phân loại | Yêu cầu Gemini đồng thời tối đa |
|---|---:|---:|---:|
| Nhẹ | 1 | 1 | 1 |
| Cân bằng (mặc định) | 2 | 4 | 8 |
| Nhanh | 3 | 8 | 16 |

Hai mạng cùng được chọn: Cân bằng có tối đa 4 cửa sổ collector. Không đủ truy vấn thì dùng ít cửa sổ hơn. Cửa sổ đăng nhập đang mở riêng không tính là collector. AI không nhất thiết dùng hết số slot: các bước kiểm chứng phụ thuộc kết quả trước vẫn tuần tự.

Không tăng batch vượt 8 hội thoại. Không sửa prompt, schema, mức suy nghĩ, ngưỡng nhãn, thứ tự kiểm chứng hoặc cắt bình luận/ngữ cảnh để đổi lấy tốc độ. Kết quả LLM vẫn có thể biến động do nhóm batch và mô hình; kiểm thử transport không chứng minh chất lượng ngữ nghĩa tăng.

## Điều phối quota và chi phí

Quota người dùng cung cấp cho Gemini 3.5 Flash Lite: 4.000 RPM, 4.000.000 input TPM, 150.000 RPD. Số bên trái dấu `/` là usage hiện tại, không phải cấu hình giới hạn. Dùng 80% làm ngưỡng điều phối: 3.200 RPM, 3,2 triệu input TPM, 120.000 yêu cầu/ngày. Không coi đây là quota chung của mọi project/model Tier 1. Model legacy giữ mức vận hành bảo thủ riêng.

Một scheduler chung trong main process cho mỗi model, dùng bởi planner/clarification/classifier/review, không một limiter cho mỗi cửa sổ hay mỗi key. Bộ đếm của ứng dụng lưu trong `data/rate-limits/<model>.json`, ngày reset theo Pacific như nhà cung cấp. Không lưu key vào bộ đếm. Đây là usage CSD biết; ứng dụng khác dùng cùng project vẫn có thể làm quota cạn sớm.

Trước transport, giữ chỗ RPM và input token bằng ước lượng bảo thủ từ byte UTF-8, rồi đối soát usage thực. 429/503 làm cả hàng đợi cùng chờ, giảm concurrency, tôn trọng `Retry-After` dạng giây/ngày HTTP và Gemini RetryInfo, kể cả >60 giây. Job đang xử lý được gia hạn lease mỗi 30 giây trong lúc chờ quota; worker khác không nhận lại công việc còn sống chỉ vì cooldown dài. Hàng đợi hủy ngay khi Stop; cache và coalescing vẫn tránh gọi trùng. Sau chuỗi hoàn tất tăng concurrency dần trở lại. Giới hạn USD của campaign và sổ chi phí được giữ nguyên, có đặt chỗ đồng bộ cho các yêu cầu song song.

## Tương thích và giới hạn

- Run cũ không có `parallelWorkers` tiếp tục đi đường một cửa sổ; không sửa manifest cũ để ép chạy nhiều cửa sổ.
- Resume run mới giữ số cửa sổ/nhóm truy vấn đã lưu. Chọn mức khác trước lượt mới để đổi số cửa sổ.
- Các nhóm cố định chưa có cơ chế cửa sổ rảnh nhận lại truy vấn từ nhóm đang chậm. Đây là đánh đổi để giữ frontier đã kiểm chứng.
- Tốc độ thực còn phụ thuộc nguồn, CPU/RAM, độ sâu bình luận, lượng dữ liệu thiếu và số vòng kiểm chứng. Quota cao không phải lý do chạy hàng trăm cửa sổ.
- Không chỉnh sửa các bộ dữ liệu AppData dùng để đánh giá RC6.
- Phát hiện Git ignore `secrets/` từng bỏ sót hai file **mã nguồn** SecretStore. Đã khôi phục đúng nội dung đang có ở worktree chính và thêm ngoại lệ riêng cho `.ts`; dữ liệu key/cookie vẫn không vào Git.

## Kiểm chứng

Unit tests bao gồm bounded concurrency, lưu/khôi phục quota, Pacific reset, TPM/RPM độc lập, hủy trong hàng đợi, cache, ngân sách song song, Stop/barrier/Resume từng collector, khử trùng tổng và 40 hội thoại phân loại song song không sót/trùng.

`scripts/parallel-window-smoke.mjs` dùng Electron thật và localhost, hồ sơ tạm riêng; xác nhận điều hướng độc lập, chia sẻ Session đúng hồ sơ, không nhận nhầm observer, đóng một cửa sổ không hủy request của cửa sổ kia, vô hiệu owner cũ khi mở lại, shutdown đóng đủ webContents.

`scripts/benchmark/throughput-gemini.mjs` gọi tối đa 8 yêu cầu nhỏ có dữ liệu tổng hợp, ngân sách $0,20 chung. Lần đo 03/11: 4 tuần tự 3.359 ms; 4 song song 1.165 ms, 8/8 hợp lệ, không retry/cache hit. Ước tính theo usage $0,0004085. Đây chỉ là phép đo transport, không phải benchmark crawl hay độ chính xác bộ lọc.

Evidence cục bộ: `artifacts/parallel-crawl-20261103/`. Bản kết hợp AI + crawl được kiểm thử riêng ở `codex/csd-next`; không merge production hoặc push khi chưa có yêu cầu.

Tài liệu gốc: [Google rate limits](https://aistudio.google.com/docs/rate-limits), [Electron sessions](https://www.electronjs.org/docs/latest/api/session), [Electron windows](https://www.electronjs.org/docs/latest/api/browser-window).
