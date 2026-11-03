# CSD 0.4.0-rebuild.1 — bàn giao ứng viên ADR-025

Ngày 03/11/2026. Mã nguồn đã triển khai; đường Không lọc có thể thử ngay. Phần đo chất lượng AI còn bị chặn bởi quyền gọi Gemini 2.5 Flash-Lite, chưa được coi là nghiệm thu toàn bộ ADR.

## Bản chạy và cách thử

- File: `release/CSD-Portable-0.4.0-rebuild.1.exe`. Đóng CSD cũ trước khi mở bản này; không chạy hai bản cùng ghi AppData.
- Chọn **Không lọc**, nhập từ khóa hoặc chọn **Dùng từ khóa đã lưu**, chọn nguồn đã đăng nhập và chỉ tiêu tổng. Bản này không gọi AI để lập kế hoạch, phân loại hoặc theo dõi trong chế độ đó. JSON/Excel ghi chưa đánh giá; cột `selection_group` phân biệt TARGET và EXTRA, giữ thứ tự `accepted_sequence`.
- Chọn tốc độ **Mở mọi từ khóa** để cho các tác vụ dùng cửa sổ riêng khi tài nguyên đủ. Chế độ tự động tăng dần theo RAM/CPU. Mỗi tác vụ mạng/hồ sơ/query có trạng thái và checkpoint riêng; Top/Recent là trạng thái trong tác vụ.
- **Tiêu chuẩn/Chất lượng:** hiện key Windows trả 404 khi sinh nội dung bằng 2.5. Khi có quyền, đặt trần cộng dồn/ngày/số lượt gọi trong giao diện trước khi dùng AI. Giá trị mặc định 0 chặn chi tiêu. Ngân sách phát triển được cấp cho agent không tự mở ngân sách chạy của người dùng.
- Để lọc dữ liệu cũ, dùng nguồn lưu và kế hoạch/preset; tạo revision mới, giữ nguồn và kết quả cũ. Cache dựa trên nội dung, mục tiêu, ngày đánh giá, model và recipe; thay counter không tạo nhu cầu gọi lại AI.

## Những thay đổi đã có

| Phần | Hành vi mới |
|---|---|
| Model và tiền | 2.5 Flash-Lite mặc định, thinking tắt; guard SQLite ngoài workspace, giữ chỗ trước mỗi HTTP attempt, trần tiền/call cộng dồn không reset theo campaign. Lỗi gián đoạn giữ dự phòng; không tự fallback |
| Thu thập | Raw được lưu và khử trùng trước checkpoint; model dừng không buộc crawler dừng. Trần bài thô/byte vẫn áp dụng |
| Chỉ tiêu | Chung mọi mạng, không tỷ lệ Facebook/Threads. Trong nhóm chờ tuyển ưu tiên tín hiệu mạnh; sau đó thứ tự hoàn tất ghi nhận bền vững. Bài vượt chỉ tiêu giữ riêng |
| Cửa sổ | Một task mỗi query/mạng/hồ sơ, lát 3 trang; mọi query được lượt đầu trước khi đào sâu. Cửa sổ lỗi không hủy anh em; giảm tải không xóa query |
| Tiêu chuẩn | Một batch quyết định gọn, nhận nhu cầu trực tiếp và tín hiệu gián tiếp hợp lý. Giữ đúng vai cung/cầu, người đại diện, nhánh HOẶC và điều kiện bắt buộc |
| Chất lượng | Tái dùng Standard, kiểm tra thêm có chọn lọc; tối đa một lượt bổ sung mỗi phiên bản. Bất đồng không tự biến thành loại bài; giữ cả lý do để xem lại |
| Tìm thêm | Tối đa một lần mở rộng có kiểm soát, thêm tối đa 4 query cùng nhánh đã chốt; ưu tiên query theo số bài mới/tỷ lệ được nhận. Không gọi tỷ lệ nhận là precision thật |

Mức Tiêu chuẩn ưu tiên tăng số bài đúng được giữ trong ngân sách, với mục tiêu độ tinh khoảng 60%. Không hiểu là giảm một nửa số call, không tự nhét bài sai cho đủ 1.000 và chưa có cơ sở tuyên bố đã đạt 60%.

## Bằng chứng kiểm thử

Sáu nguồn đã đọc và replay bằng store mới, không gọi model và không sửa AppData:

| Nguồn | Snapshot/bài gốc riêng trong nguồn | Bài OFF trong chỉ tiêu 1.000 | Phần bổ sung |
|---|---:|---:|---:|
| Phòng trọ | 557 | 557 | 0 |
| Bất động sản | 681 | 681 | 0 |
| Gà ta | 1.539 | 1.000 | 539 |
| Café | 3.001 | 1.000 | 2.001 |
| Piano lượt 1 | 522 | 522 | 0 |
| Piano lượt 2 | 428 | 428 | 0 |

Tổng 6.728 snapshot, 8.318 quan sát và 8.696 span đã đối chiếu nội dung. Hai lượt piano có 814 bài duy nhất sau khi gộp theo mạng/root; không cộng 950 thành số bài duy nhất. Đây là kiểm tra parser/lưu trữ/khử trùng, không phải kết quả phân loại mới.

- Typecheck đạt. Suite toàn bộ ở checkpoint tích hợp: **977/977 đạt**, 0 lỗi; log ở `artifacts/csd-rebuild-20261103/full-tests-final.txt`. Sau đó chỉ bổ sung UI lấy từ khóa đã lưu và chạy lại build/UI smoke/gói ASAR.
- Hồi quy policy: OFF zero call, một mạng vẫn đủ chỉ tiêu chung, phần dư/resume, budget pause vẫn thu raw, cache không lặp, người đại diện, nhánh HOẶC, vai cung/cầu, mua/thuê/mượn và bất đồng review. Mock chỉ chứng minh cơ chế xử lý verdict, không đo khả năng hiểu của model thật.
- UI Electron đạt: hỏi làm rõ không chọn sẵn, hai nhóm verdict, pending riêng, slider ba mức, OFF hiện bài chưa đánh giá, phần dư và trần tiền ban đầu 0.
- Module main/preload/renderer trong **ASAR đã đóng gói** khởi động, lưu/đọc config và chặn planner OFF thành công. Worker SQLite trong ASAR nhập được bản ghi. Dữ liệu và tài khoản chi phí test cách ly.
- 16 cửa sổ thật, 8 trên mỗi mạng mô phỏng bằng localhost: nội dung/observer riêng, session cùng hồ sơ, đóng một cửa sổ không phá request anh em. Thời gian tải 1,82 giây; probe renderer trung bình 1,20 ms, cao nhất 3,44 ms. Tổng working set của 16 renderer khoảng 2.098 MiB, có thể gồm vùng bộ nhớ dùng chung; không phải RAM riêng của mỗi Facebook/Threads. CPU hệ thống tại mẫu cuối khoảng 89%, là bằng chứng cần điều phối tải, không phải lý do bỏ query.

## Thử model thật và phần còn thiếu

Người dùng cấp **Gemini 2.5 Flash-Lite, 25 lần gọi, 0,10 USD cộng dồn** cho một phép đo 100 bài + preflight. File cấp quyền và ledger nằm ngoài Git tại `%USERPROFILE%/.csd/spending`; không reset khi chạy lại hoặc đổi key.

Đã thử **1 request preflight**, HTTP **404 MODEL_NOT_AVAILABLE**. **0 USD theo ledger, 0 USD giữ chỗ, 0 bài mẫu đã đánh giá.** Không retry liên tục, không chuyển 3.1/3.5. GET model metadata vẫn 200 nên không dùng metadata để kết luận API sinh nội dung hoạt động. [Google giới hạn truy cập 2.5 cho người đã sử dụng trước đó](https://aistudio.google.com/docs/models/gemini-2.5-flash-lite); cần giải quyết quyền của key/project hoặc quyết định model khác.

Đã khóa mẫu ngẫu nhiên 100 bài, tách ca hồi quy phụ huynh đã biết; đọc nội dung trước dự đoán candidate. Nhãn tham chiếu ban đầu: 25 phù hợp, 68 không phù hợp, 7 chưa rõ. **Đây là nhãn do một coding agent đọc, chưa được khách hàng xác nhận**, không phải điểm số của Standard/Quality. Các ca chưa rõ phải báo riêng, không âm thầm gán âm.

Script `scripts/benchmark/rebuild-evaluate.mjs` mặc định dry-run. Khi quyền truy cập thay đổi, `--live --retry-access` dùng lại cùng mẫu, ngân sách và bộ đếm. Quality dùng lại Standard; báo precision, recall, số nhận/chờ, bất định trên mẫu, giá/1.000 đầu vào và giá/bài đúng. Không dùng mẫu này vừa chỉnh prompt vừa tự báo điểm độc lập.

Còn phải đo: precision/recall thực, token/bài, chi phí/bài đúng và lợi ích Quality trên Standard; throughput/RAM khi tải mạng xã hội thật. Không tuyên bố đủ 1.000 bài phù hợp hay độ tinh trên 60% trước những phép đo đó.

## Git

R1–R5 có commit và nhánh riêng: `codex/csd-r1-cost` (`0ca9421`), `codex/csd-r2-raw` (`c021076`), `codex/csd-r3-windows` (`8f3340e`), `codex/csd-r4-standard` (`bc94dcb`), `codex/csd-r5-quality` (`2c94782`). R6 đóng gói và kiểm tra trên `codex/csd-r6-candidate`, hợp vào `codex/csd-rebuild` bằng merge commit.

Mốc `csd-rebuild-candidate-20261103` là **ứng viên đã kiểm tra offline, AI còn chặn quyền**, không phải tag hoàn tất R6 hay bản production. RC7 và các nhánh dài hạn cũ giữ nguyên; không push remote, không đưa AppData/key/export/binary vào commit. Có thể cải tiến bộ lọc trên nhánh mới từ rebuild mà không bỏ phần crawler và cost guard.

[Bằng chứng tổng hợp và hash binary](../evidence/csd-rebuild-candidate-20261103.json). Log, ảnh UI, mẫu và nhãn đầy đủ nằm trong `artifacts/csd-rebuild-20261103/` tại máy này.
