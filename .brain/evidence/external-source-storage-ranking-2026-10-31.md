# Nguồn dữ liệu ngoài, ưu tiên nguồn và giới hạn lưu trữ — 31/10/2026

Phạm vi là bộ máy đa chủ đề, mục tiêu vận hành 1.000 bài Phù hợp tổng cộng và ưu tiên Threads 8:2/7:3. Không sửa bộ café đã giao hoặc thu thêm để đủ quota. Bản này tiếp nối bằng chứng `retained-grounded-engine-2026-10-31.md`; các con số 833 tests và giới hạn tại bản trước là lịch sử.

## Nguồn lưu sẵn ngoài thư mục mặc định

Main mở native folder picker; renderer chỉ nhận opaque source-root ID, không truyền đường dẫn tùy ý. Registry lưu canonical path và filesystem identity, kiểm tra lại khi chọn nguồn; import manifest cố định nguồn độc lập với thư mục đích. Nguồn không đọc được xuất hiện như một lỗi riêng, các nguồn khác vẫn dùng được. Resume import đã hoàn tất không cần mở lại nguồn; import dở kiểm tra đúng prefix và root đã cố định. Không hardcode đường dẫn Codex, không bỏ canonical containment.

Native smoke dùng renderer/preload/service thật và model transport giả, tại `%TEMP%/csd-external-source-native-20261031/`:

- Chọn `picked-data` bằng Windows folder picker, nguồn ngoài xuất hiện cùng nguồn local.
- Tái lọc `crawl-9a57733b-2816-409d-a5ab-ab463ed502e3`: 2 roots, 1 comment, 0 pending; UI báo `STOPPED`, 2/10 Phù hợp và nguồn đã xử lý hết. Nhãn và chi phí $0.0011 là **giả lập**, không phải accuracy hoặc chi phí API thật.
- Không browser/auth calls; `actions.jsonl` chỉ có fake planner/classifier, không `UNEXPECTED_BROWSER`. Cửa sổ/PID thử riêng 12340 đã đóng, không đóng phiên người dùng.
- Probe đọc nguồn café thật qua source-root riêng: chọn 16 Threads + 4 Facebook, giữ 43 comments và 963 observations gồm revision/capture. Không inference; 20 roots pending, không tính observations thành bài mới.
- Journal nguồn SHA-256 trước/sau đều `bab289ea96c1c5f92face8a56d16888f0b112c34d490f77c5e7004bf236bc066`. Bằng chứng đầy đủ: `external-materialization-results.json` trong thư mục smoke.

## Ranking theo CampaignPlan

New runs áp dụng `source_priority` làm tiêu chí cuối sau intent, brand fit, ngữ cảnh tham gia và freshness. Metadata không làm thay đổi nhãn hoặc loại bỏ nguồn. Thứ tự rút gọn để các loại không được nêu bằng điểm nhau. SQL sắp trước LIMIT, preview và export dùng cùng quy tắc.

`ranking-recipe.json` được cố định trước lưu campaign; Resume giữ recipe. Campaign cũ thiếu pin giữ `PROFILE > GROUP > PAGE = UNKNOWN` để không âm thầm đổi thứ tự đã giao. JSON/Excel có ranking recipe. Đây là ranking kết quả, **không phải** collector feed profile/group/page hoặc source discovery registry.

## Backpressure theo byte và dung lượng trống

Operational policy được lưu riêng trong `storage-policy.json`, không sửa tiêu chí ngữ nghĩa của người dùng. Mặc định: 1 GiB/run, chừa tối thiểu 512 MiB trống và 64 MiB cho công việc đã nhận; backlog inference 64 MiB, trần 128 jobs giữ như trước. Các ngưỡng là điểm dừng nhận thêm dữ liệu, không phải cam kết kích thước cuối cùng tuyệt đối.

Trước navigation tìm kiếm đầu tiên, query kế tiếp, scroll, lấy bài gốc từ reply và comment capture/pagination, hệ thống kiểm tra cả thư mục run và backlog UTF-8. Đo cả journal, SQLite/WAL, cache/ledger và dữ liệu collector. Hai mạng chia sẻ phép đo và giới hạn run. Backlog lớn chờ inference xử lý; chạm dung lượng run/ổ đĩa dừng lấy thêm, vẫn lưu batch đã quan sát và giữ job có thể tiếp tục. Resume đọc lại policy cũ và dung lượng thực, không đặt lại ngân sách.

Scanner có giới hạn số file/depth, không theo symlink/junction; atomic rename race dùng tối đa ba lượt đo lại. Lỗi đo không bị coi như ổ đĩa trống. Policy được publish bằng temp đã fsync + atomic hardlink không ghi đè: hai writer dùng cùng winner; crash trước/sau publish không để lại shared lock mới. File system không hỗ trợ hardlink dừng với mã rõ; legacy lock chưa rõ owner không bị tự xóa. Không tìm thấy legacy storage lock trong hai collection roots đã kiểm tra. Reserve không bảo đảm chống một ứng dụng khác làm đầy ổ đĩa hoặc một batch vượt headroom. Không tự xóa dữ liệu. **Retained import hiện chưa đi qua storage admission**, không gán bằng chứng này cho đường nhập dữ liệu đã lưu.

## Kiểm chứng và giới hạn

- Baseline trước ranking/storage: check/build và 855/855 tests PASS.
- Sau tích hợp bước đầu: 77/77 tests pipeline + search hooks + comment collector PASS; gồm dừng trước query đầu, chuyển query không scroll, giữ raw/comment khi chạm cap, chờ backlog byte, và không tăng cap qua Resume.
- Full `npm run check`, `npm run build`, `npm run test:unit` cuối cùng: **885/885 PASS**, 0 fail/skip, 37,14 giây phần test. Log `%TEMP%/csd-engine-final-{check,build,tests}-20261031.log`. Có kiểm tra kill child trước/sau publish và race hai process thật. Kiểm tra này không chứng nhận accuracy trên mạng xã hội.
- Benchmark piano/HUST 323 snapshots đã hoàn tất, hai lượt nhãn độc lập và phân xử 54 ca; frozen reference SHA-256 `11b29e82af3f82899c55b7a781c036b20a9d9d53ccf9de55a972e5d04711e66e`. Hai filter recipes dùng cùng input; tổng $0.5430968, 2.1 có 48 validation failures nên không bật mặc định. Xem [đánh giá và CI](cross-topic-paired-2026-10-31.md). Đây là tham chiếu AI, không phải human gold.
- Còn semantic gate, thêm ngành thật có comments, source/feed discovery, retention theo campaign, max-age expiry, watch 72h và live continuation. Hai ngành piano/HUST lịch sử không có captured comments nên chưa kiểm chứng chất lượng hội thoại đa ngành.
- Portable RC2 giữ nguyên; mã nguồn mới chưa được phát hành trong artifact đó. Hai dataset Downloads đã giao giữ nguyên checksum.

## Lượt thu ngành thứ ba

CLI đã có `maxRunMinutes` 1–240 cho plan chưa compile; Resume không đổi thời gian của plan đã cố định. `profiles` có thể chỉ định đúng ID account, không thay bằng tài khoản khác khi account đó không dùng được. `STARTED`/`runner.json` ghi logical và canonical runtime paths. Các điều khiển này không đổi schema UI.

Đã khởi động pilot tai nghe `crawl-4ed260d9-9a37-4f2b-9e3d-6ff2b080e329`, PID 19756 lúc 2026-10-30T18:18:53Z. Config private: `%APPDATA%/csd-desktop/data/campaigns/audio-engine-20261031/config.json`; SHA-256 `0f0d9a6a254b3602fc758962478208d1fb8c7775e7fd130cb2f08abe1a08b9c7`. Cap 300 raw, 15 phút, $1; mục tiêu pilot 100 với tỷ lệ 80:20, comments bật. Đây là kiểm thử bộ máy ở ngành mới, không thay mục tiêu sản phẩm 1.000 tổng.

Pilot đã kết thúc `FINISHED / STOPPED`, PID19756 không còn, watch tắt. 310 roots (161TH149FB),198comments (132TH66FB),98model-selected (68TH30FB),172NOT_YET40UNRELATED,0pending/failedclassification;46APIcalls/$0.2247048,unknown0. Mốc export cuối18:22:25.798Z, khoảng211,9giây từ launch. Rawcap300 dừng nhận thêm nhưng giữ batch đang nhận nên có310. Còn34root-resolutionjobs và525revisitjobs chưa kích hoạt. Commentcapture được thử trên29/310roots,27cócomments. Chất lượng ngữ nghĩa được kiểm riêng; số98 không tự là confirmed opportunities.

`launch.json` lưu hash mã đã chạy;9/9file vẫn khớp khi kiểm tra sau terminal. Actual runtime paths đều là Roaming thường. [Operational audit](C:/Users/Admin/AppData/Roaming/csd-desktop/data/benchmarks/audio-engine-20261031/operational-summary.md) và [báo cáo tiến độ theo yêu cầu dừng của người dùng](../reports/csd-progress-review-2026-10-31.md). Không khởi động lại pilot hoặc các jobs còn lại khi người dùng chưa quyết định tiếp tục.
