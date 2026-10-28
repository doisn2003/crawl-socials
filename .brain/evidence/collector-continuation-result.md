# Collector Facebook tiếp nối — sử dụng được; benchmark chưa PASS

2026-10-28, Asia/Bangkok. Thực hiện theo yêu cầu mới `collector-continuation-prompt.md` và ADR-019; không phục hồi worker/heartbeat cũ. Quyền sử dụng phiên do user cấp; quyền nền tảng Meta vẫn UNKNOWN. Không push/publish.

## Kết quả nghiệm thu

**Đã có collector chạy bằng một lệnh, tự search/cuộn/đọc response/lưu batch, Stop/resume/dedup/export.** Lưu **1.156 bài có ID và URL duy nhất**, tất cả mới so với 5 bài bàn giao. 1.155 bài có audience PUBLIC ở chính Story; 1 UNKNOWN, 0 PRIVATE. Export sau audit nguồn: **447 PAGE, 703 GROUP, 3 PROFILE, 3 UNKNOWN**. Ba bài PROFILE thuộc hai nguồn có header tên/URL khớp, số bạn bè và Add Friend; không suy từ GraphQL User.

**Chưa đạt nghiệm thu 1.000 bài công khai hợp lệ đúng chủ đề/24h.** Đã vượt 1.000 link ứng viên thật nhưng chưa có quyết định chất lượng tổng hợp cho toàn bộ dataset. Search có noise; toàn văn chưa được chứng minh; không reopen từng permalink. Không nâng G02 hoặc tuyên bố toàn dự án DONE.

Nhánh `feature/facebook-collector` từ main `7bbc231`. Checkpoint đầu `936853fdd73c6d1581d806700dbbab7321d0469c`; code hoàn thiện `fe1754a` (lifecycle, source audit, CLI, export). Quyết định: giữ nhánh và tích hợp code hữu dụng vào main; các nhánh thử cũ vẫn giữ. Tài liệu này được commit riêng sau code. Không nhập script thí nghiệm cũ vào luồng chạy mới.

## Dataset và bằng chứng ngoài Git

Thư mục: `C:/Users/Admin/AppData/Roaming/csd-desktop/data/collections/coffee-20261028/`.

| File | Vai trò |
| --- | --- |
| `posts.jsonl` | 1.156 quan sát đầu tiên, append-only; SHA-256 `658bae192a66072a6d8d3d08286d076fed463b1bbea6ba23c255ca59651ecb53` |
| `posts.json` | Export đầy đủ, có phân loại PROFILE từ bằng chứng nguồn; sửa nhãn transport của pilot bằng provenance batch |
| `summary.json` | Counts của export; có 3 PROFILE và 3 UNKNOWN |
| `quality-summary.json` | Counts quan sát gốc: 447 PAGE/703 GROUP/6 UNKNOWN; 16 query; lịch sử run và lỗi |
| `batches.jsonl` | 2.437 quan sát đã parse, 1.281 lần gặp trùng, 1.156 bài mới; request ID, operation, hash response, batch/query/scroll và new IDs |
| `runs/<runId>/` | Manifest/config, checkpoint, events, status, receipt và verification JSON |
| `source-audits.jsonl` | Header nguồn đã quan sát; căn cứ export phân loại, không thay privacy của bài |
| `audit-sample.json`, `audit-review.json` | Mẫu 36 bài được đọc/gán nhãn, có hash và lý do; không ngoại suy thành precision toàn tập |
| `audit-sample-658bae192a66.json` | Mẫu deterministic từ snapshot cuối, chưa gán nhãn riêng |

Dataset 5 bài cũ vẫn nguyên hash `f4dd99c0c5ecab24678dd6fa78d904a767a20f5e59e5f27963dffaaddc6c4623`, overlap theo ID/URL = 0. Không credentials, cookies, headers, raw network dump hoặc nội dung cá nhân thô trong Git. Các bản sao tài liệu user trước chỉnh sửa ở `.../data/collector-handoff-20261028/`.

## Các run thật

Thời gian dưới đây là UTC; cộng 7 giờ để ra Asia/Bangkok.

| Run | Thời gian | Bài mới | Kết quả |
| --- | --- | ---: | --- |
| pilot-a | bắt đầu 04:04:18; thu khoảng 45 giây | 19 | 2 query, 2 continuation batch có bài mới; phát hiện lifecycle auto-exit trước receipt |
| pilot-b | 04:06:49–04:08:52 | 120 | Stop tại tổng 97, restart đọc lại 97, kết thúc tổng 139; 21 continuation batch mới |
| scale-c | 04:13:46–04:25:48 | 1.001 | 12 query, 184 scroll do code, 178 continuation batch có bài mới; TARGET_REACHED |
| coffee-20261028043056463 | 04:30:56–04:31:10 | 16 | Chạy qua launcher CLI thực; 3 scroll, TARGET_REACHED, session_flush OK |

Scale-c được cấu hình tối đa 45 phút, 18 query, 18 scroll/query, 1.000 bài mới; dừng sau khoảng **12 phút 1 giây**. Target được kiểm giữa các batch nên có thể vượt một batch. Tổng thời gian từ mở pilot-a đến hoàn tất CLI cuối khoảng 26 phút 52 giây, gồm phát triển/kiểm tra giữa các run; không ngoại suy throughput thành benchmark.

Không có thao tác computer-use thu từng bài, không có thao tác tài khoản từ user trong lượt này. Agent dùng lệnh Stop/resume một lần để kiểm restart. Không có account barrier/HTTP deny/rate limit được phát hiện trong các run. Source audit có một lần launcher bị kẹt trước app ready do top-level await; đã chấm dứt đúng process chẩn đoán chưa mở browser và sửa sang async main. Không coi lỗi này là Facebook chặn.

## Bằng chứng continuation và giới hạn

Operation đọc thực đã quan sát: `SearchCometResultsPaginatedResultsQuery`. Browser tự phát request sau khi code cuộn phần tử đúng. Ví dụ `scale-c-2`, query index 0, scroll index 1, request `27920.791`: 5 ID mới, 0 trùng; body SHA-256 `669affee04df8e4044fbf35827604b8a90fe2ac6cb606d2a1782992e71b105a4`. Đây là batch tiếp trong **cùng query**, không phải đổi keyword.

Toàn tập: 1.084 bài mới đầu tiên từ response mạng, 72 từ JSON nhúng. 58 ID có tiền tố nội dung đã chuẩn hóa (tối đa 40 ký tự) khớp snapshot DOM lúc kiểm. Các batch response thường được đọc trước khi render; không tuyên bố toàn bộ 1.156 bài đã khớp DOM. Raw bodies chỉ trong bộ nhớ; hash/projection không thay cho raw replay. Chưa reopen từng permalink hoặc kiểm full text.

**Không chứng minh direct request replay không render.** Phương pháp thành công dùng Electron có render, tự cuộn bằng code, thu JSON qua CDP. Không hardcode doc_id/cursor, không gửi lại mutation. Những mutation do Facebook tự phát được thấy thụ động trong log tên operation, collector không replay chúng. Cần desktop session phù hợp; chạy hidden từ tiến trình nền không phải chế độ đã được nghiệm thu.

## Chất lượng và trường thiếu

Không thiếu text, publication time hoặc source URL trong 1.156 bài. Thiếu reactions_total: 1; love_count: 414; comments_count: 11; shares_count: 1. Null có lý do, 0 được giữ nguyên; love khác reactions_total. Không thấy love lớn hơn total, ngày đăng sau thời gian thu, numeric ID sai kiểu hoặc duplicate ID/URL trên dataset. Text completeness vẫn UNKNOWN.

Mẫu diagnostic 36 bài: **28 relevance ACCEPT, 4 REJECT, 4 UNVERIFIED**; trong 28 ACCEPT có 5 bài sang nhượng café cụ thể được giữ theo scope user. 27/28 có PUBLIC trong quan sát đầu tiên; điều này vẫn không là tổng hợp benchmark ACCEPT. Mẫu chọn theo query/loại nguồn và trường bất nhất, không ngẫu nhiên; không dùng để ngoại suy. Noise thực gồm cho thuê căn hộ nhắc café, thiết bị, nhà hàng lẩu và nhà cung cấp dù. Ứng viên và nội dung tuyển dụng/sang nhượng được giữ, không loại sạch theo category. Nhãn mẫu là sidecar; trường relevance trong quan sát gốc vẫn UNVERIFIED.

Parser chỉ hỗ trợ các shape đã thấy, giữ skipped/candidate reasons. Các rendering strategy khác, nội dung chỉ ảnh, video/permalink khác và locale khác có thể thiếu coverage. PROFILE rule hiện nhận header cá nhân có friend count/Add Friend; professional profile hoặc chỉ follower vẫn UNKNOWN. Một audience UNKNOWN của pilot cũ được giữ nguyên dù parser mới đã xử lý icon custom đúng hơn.

## Lifecycle, dữ liệu bền vững và hồi quy

- Append/fsync records trước batch receipt/checkpoint; checkpoint dùng rename. Dedup ID và URL qua query/restart. Torn tail được backup trước sửa; lỗi completed row không bị bỏ im lặng.
- Pilot-b resume đọc tổng 97 và tiếp tục đến 139, không đếm lại bài cũ. Resume phát lại query đang dở, không lưu/replay secret cursor. Giữ deadline ban đầu, config hash bất biến. Run hoàn tất trả ALREADY_COMPLETE; đã kiểm trên CLI cuối, dataset hash không đổi.
- Sửa đóng cửa sổ cuối làm Electron thoát trước session flush/export. Vì lỗi này pilot-a thiếu receipt; không tạo receipt giả hồi tố. Các run sau ghi receipt và kết thúc đúng; CLI cuối session_flush OK.
- Bounded timeout navigation/execute/shutdown, record/query/scroll/deadline caps, Stop file, account barrier, source exhausted và no-progress riêng. Không retry vô hạn. Lỗi capture/storage/flush trả exit lỗi; barrier trả 3.
- Export của các pilot cũ chuẩn hóa `extraction_method` theo `first_observation.method` (1.072 dòng); source audit bổ sung PROFILE trong export. Không sửa append-only observations hoặc che lịch sử parser.
- Build/typecheck main, renderer, tests đạt; 29 hồi quy parser/store/source-header/observer đạt. Chúng bảo vệ invariant, **không** là bằng chứng collector LIVE. Kiểm full P00 config cũng đạt, không nâng gate từ tests.

## Chạy lại

Đóng CSD khác dùng cùng profile. Từ workspace:

```powershell
npm run collect:facebook -- --query "cafe Hồ Tây" --query "review cafe Hà Nội" --target 100 --minutes 30 --scrolls 20
```

Lệnh in config và output ngoài repo. `--output` cho phép tiếp tục cùng collection để dedup; run ID mới có budget mới. Có thể truyền config JSON rõ bằng `--config`.

```powershell
npm run collector:control -- --config "C:/.../run.json" --stop
npm run collect:facebook -- --config "C:/.../run.json" --resume
npm run collector:control -- --config "C:/.../run.json" --export
.\node_modules\.bin\electron.cmd scripts/audit-facebook-sources.mjs --collection "C:/.../collection" --limit 5
node scripts/summarize-facebook-collection.mjs "C:/.../collection"
```

Chạy audit sau khi collector dừng. Profile mặc định `CSD Facebook`, session Electron đã đăng nhập; không cần đưa mật khẩu vào lệnh. Cấu hình các run đã nghiệm thu nằm trong collection thật. `.env`, Chromium profile, secrets và dataset ngoài Git được giữ.

## Quyết định tiếp theo

Nghiệm thu mức **collector tự động hữu dụng + pilot + stop/resume/export + đo tải thực**, tích hợp main. Giữ G02 chưa PASS. Nút thắt hiện chuyển từ không có batch mới sang relevance/coverage và xác minh tổng hợp; bước phát triển tiếp là lọc/đánh dấu noise có version, kiểm tập mẫu độc lập và lấy thêm query ưu tiên venue/review, rồi benchmark hợp lệ riêng. Không lấy count ứng viên hoặc phần trăm task để báo tiến độ. Khi kết thúc bàn giao không còn Electron collector, worker hay automation do lượt này chạy nền.
