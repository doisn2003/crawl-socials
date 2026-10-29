# Threads — đã thu 1.004 post không trùng

Ngày 2026-10-29, Asia/Bangkok. Hoàn thành mục tiêu lấy dữ liệu của phiên này theo [ADR-020](../decisions/ADR-020-threads-collector.md). User yêu cầu tập trung thu post, **chưa đánh giá nội dung**. Không tính số lượng này thành benchmark relevance của Facebook hay hoàn thành toàn dự án.

## Kết quả và dữ liệu

**1.004 ID, shortcode và permalink duy nhất**, có caption, tác giả, thời gian đăng và metadata tương tác. 900 bài mới lấy từ response phân trang `BarcelonaSearchResultsRefetchableQuery`; 104 từ JSON nhúng khi mở trang. Không cần computer-use để mở từng bài. Không replay request/cursor.

Collection ngoài Git: `C:/Users/Admin/AppData/Roaming/csd-desktop/data/collections/threads-coffee-20261029/`.

| File | Nội dung |
| --- | --- |
| `posts.jsonl` | 1.004 bản ghi quan sát đầu tiên, append-only |
| `posts.json` | Bản xuất JSON dễ đọc, 1.004 post |
| `summary.json` | Tổng, query, phương thức và trường thiếu |
| `validation.json` | Kiểm định danh, URL, batch provenance và thống kê run |
| `batches.jsonl` | 129 batch, 1.159 quan sát đã parse, 155 lần gặp trùng |
| `configs/*.json` | Cấu hình hai run, không có credentials |
| `runs/<runId>/` | Manifest/config hash, checkpoint, events, verification và receipt |

SHA-256 của `posts.jsonl`: `41972f7d1dd1b120ed5d0674f1d3ffadd3d7ea9bbdcd566d99d33556d66fd475`. Export và gọi resume trên run đã đạt mục tiêu trả `ALREADY_COMPLETE`, giữ nguyên hash.

| Truy vấn ở lần đầu gặp post | Post mới |
| --- | ---: |
| quán cafe đẹp | 406 |
| cafe Hà Nội | 25 |
| địa điểm hẹn hò Hà Nội | 319 |
| cafe học bài | 14 |
| địa điểm học bài | 14 |
| cafe yên tĩnh | 226 |
| **Tổng** | **1.004** |

330 post ở Top, 674 ở Recent. Đây là phân bổ first-observation sau dedup, không phải toàn bộ số kết quả mỗi truy vấn có thể trả. Đã tìm qua đủ sáu query; khi đạt target thì dừng nên không dùng bảng này để so sánh coverage hay chất lượng keyword.

## Các lượt chạy thật

Giờ dưới đây là Asia/Bangkok (UTC+7), cùng ngày 29/10/2026.

| Run / invocation | Bắt đầu → kết thúc | Tổng trước → sau | Kết quả |
| --- | --- | ---: | --- |
| `threads-20261029094649620` | 16:46:49 → 16:47:27 | 0 → 58 | Pilot target 50, vượt một batch |
| `threads-20261029094853662`, lần 1 | 16:48:53 → 16:51:03 | 58 → 104 | Agent Stop để sửa tải tiếp khi cửa sổ bị che |
| Cùng run, resume 1 | 16:53:33 → 16:58:24 | 104 → 741 | Phân trang trở lại; Stop để kiểm resume và nạp sửa đếm invocation |
| Cùng run, resume 2 | 16:59:05 → 17:01:12 | 741 → 1.004 | `TARGET_REACHED`, session flush OK |

Khoảng từ START đầu tới STOP cuối: **14 phút 23 giây**, gồm thời gian dừng/chẩn đoán. Tổng thời gian các invocation collector hoạt động khoảng **9 phút 46 giây**. Không bao gồm thời gian phát triển trước pilot; không phải benchmark tốc độ chuẩn hóa.

Lượt scale lưu tổng 946 post mới ngoài 58 pilot; invocation cuối lưu 263 post mới. Hai Stop được agent tạo bằng control CLI; data và checkpoint bền vững, resume đọc lại 104 rồi 741 bản ghi. Mọi invocation đều session flush OK. Khi bàn giao không còn process Electron collector/probe chạy; không tạo worker hoặc automation.

## Bằng chứng kỹ thuật

- Validation: 0 duplicate ID/shortcode/URL, 0 bản ghi sai trường bắt buộc, 0 thiếu tham chiếu batch, 0 ngày đăng sau ngày thu.
- 978 ID có permalink xuất hiện trong snapshot DOM, 754 có tiền tố caption khớp DOM tại lúc kiểm. Parser dùng PK chuỗi, username và shortcode do Threads trả về để lập permalink. Không reopen toàn bộ 1.004 permalink; snapshot chỉ đối chiếu một phần nội dung đang render.
- 153 lượt cuộn bằng code; 900 post mới từ continuation trong cùng query. Raw network bodies chỉ trong bộ nhớ; trên đĩa giữ projection post và hash/provenance.
- 1.004 tác giả có `text_post_app_is_private=false`; lưu nhãn **PUBLIC_PROFILE**, không suy thành bằng chứng audience PUBLIC riêng của từng post.
- Không thiếu thời gian đăng, likes, replies hoặc quotes. Thiếu reposts: 4; shares: 551. Giữ null, không thay bằng 0. Chưa kiểm completeness của caption hoặc đọc nội dung để đánh giá relevance.
- Không phát hiện HTTP/GraphQL account barrier trong các run. Observer có 2 BODY_UNREADABLE và 4 REQUEST_TIMEOUT; có rotation/stop bình thường. Không che các lỗi này hoặc suy rằng đã đọc mọi response của website.
- Ban đầu cuộn khi cửa sổ bị che không kích hoạt tải tiếp. Đưa cửa sổ ra trước làm tăng scroll height và tải bài; sửa collector dùng `backgroundThrottling:false` lúc tạo view cùng switch `disable-backgrounding-occluded-windows` của process. Sau sửa lấy thêm đều tới target. Chưa nghiệm thu chế độ desktop khóa hoặc headless.
- Login bootstrap dùng phiên Threads có sẵn tại lúc collector chạy. Helper đọc `.env` đúng phần Threads đã được kiểm với dữ liệu giả; không tuyên bố đã kiểm end-to-end đăng nhập từ profile trắng bằng helper này.

## Code, cửa sổ và kiểm thử

- CLI: `scripts/run-threads-collector.mjs`, `scripts/threads-collector.mjs`, `scripts/threads-login.mjs`; kiểm dataset: `scripts/summarize-threads-collection.mjs`.
- Parser/store mới ở `src/infrastructure/browser/threads-search-parser.ts` và `threads-collector-store.ts`. Stop, deadline, trần cuộn, no-progress, export và dedup qua restart.
- Hồ sơ có platform Facebook/Threads, một cửa sổ theo platform, cookie/localStorage riêng. Profile cũ thiếu platform vẫn là Facebook, không đổi ID. UI tạo phiên chọn mạng xã hội; probe/menu Facebook không chọn profile Threads.
- `npm run build`, `npm run check`, `npm test`: đạt; **410 unit tests**, contract P00 đạt. Native session smoke **3 process / 14 checks**, gồm cửa sổ Facebook/Threads riêng, cookie/storage isolation, restart, logout/crash và encrypted session backup: [report](threads-platform-session-smoke-2026-10-29.json).
- Code invocation cuối SHA-256: `18e5aae29f951ec14b5e7ae95ccd952ab8f6d1f0c1c793e7262d60a6b03275b6`. Hash parser/store/host/login trong START event cuối. Không push/publish; giữ nguyên các thay đổi người dùng đã có trước phiên.

## Chạy lại

```powershell
npm run collect:threads
```

Mặc định tìm sáu query, target tổng collection 1.000, 90 phút. Dùng `--output` ngoài repo để tiếp tục loại trùng cùng collection; tăng `--target` nếu collection đã đủ 1.000. Xem [README](../../README.md) cho Stop/resume/export. Lệnh thu đã nghiệm thu dùng cửa sổ Electron có render, không cần thao tác thủ công từng post.
