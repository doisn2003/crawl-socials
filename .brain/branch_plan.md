# Kế hoạch nhánh hiện hành — 03/11/2026

RC7 đã tích hợp crawl nhiều cửa sổ và điều phối Gemini để thử cùng AI RC6. Xem [báo cáo](evidence/parallel-crawl-rc7-2026-11-03.md). Tag bàn giao: `csd-next-rc7-20261103`; production/remote chưa được cập nhật.

Theo quyết định người dùng giao agent thực hiện, dùng [ADR-023](decisions/ADR-023-ai-candidate-and-crawl-branches.md):

- `codex/csd-production`: mốc sản phẩm; hiện giữ runtime RC4.
- `codex/ai-foundation`: ứng viên RC6, gồm phân rã prompt/hỏi ngược và bộ lọc hai nhãn.
- `codex/crawl-throughput`: crawl nhiều cửa sổ và scheduler băng thông, xuất phát độc lập từ nền RC4.
- `codex/csd-next`: nhận hai nhánh để thử kết hợp; workspace gốc mở nhánh này.

Tag cố định: `csd-pre-ai-rc4-20261102` và `csd-ai-candidate-rc6-20261102`. Sửa AI trên nhánh AI rồi merge vào bản kết hợp; không quay lùi nhánh có tính năng crawl mới. Xem ADR để biết worktree và cách nhận từng phần khi phát hành.

---

> **LỊCH SỬ — đã được thay từ 29/10/2026.** Người dùng chọn `codex/csd-production` để phát triển CSD dùng thật. Đọc [ADR-021](decisions/ADR-021-production-branch.md) và phần Hiện hành 2.0 của [master plan](master_plan.md). Prompt/dispatch/gate thử nghiệm bên dưới không còn là chỉ dẫn thực thi; không tự chạy lại.

# CSD Branch Plan — Kiểm chứng phân trang qua request mạng

Ngày: 28/10/2026, Asia/Bangkok. Phiên bản đề xuất: 1.0.

**Trạng thái: chỉ lập phương án; dự án và hai worker vẫn dừng, automation đã xóa.** Tài liệu này hoàn tất yêu cầu viết branch_plan.md, cập nhật theo câu hỏi mới về việc có cần cuộn giao diện hay không. Không thực thi code, nguồn thật hoặc mở lại quyền điều phối qua đêm. Master plan vẫn giữ trạng thái task/gate; không đánh dấu task hoàn thành từ bản kế hoạch này.

## 1. Quyết định cần kiểm chứng

Ưu tiên đánh giá **request mạng với continuation/cursor thực**, giữ Electron làm nơi quản lý phiên và quan sát luồng ban đầu. DOM và cuộn giao diện là đường dự phòng hoặc dùng để khám phá/đối chiếu, không mặc định là động cơ thu dữ liệu lâu dài.

Chưa thể gọi đây là phương án ưu việt nhất cho Facebook hiện tại: CSD chưa ghi nhận request/response search thật để chứng minh có continuation dùng được theo cách này. Phép thử cần trả lời thẳng: **có lấy được batch tiếp theo chứa bài mới bằng code, không cần cuộn/render batch đó, rồi lưu link và metadata hay không?**

Không có mức tiền nạp thêm nào bảo đảm câu trả lời. Không gán chi phí ước tính hoặc hứa thời gian hoàn thành sản phẩm khi chưa đo. Ngân sách thời gian bên dưới là điều kiện kết thúc phép thử, không phải báo giá hoặc cam kết thành công.

## 2. Làm rõ các hướng khác nhau

| Hướng | Thao tác để nhận batch mới | Ưu điểm có thể có | Giới hạn chưa giải quyết |
| --- | --- | --- | --- |
| DOM + UI | Trình duyệt cuộn/tải trang rồi đọc card | Bám sát thứ người dùng nhìn thấy; đã có một mẫu DOM thật | Render/DOM biến động; link có thể hydrate muộn |
| Quan sát response thụ động | UI tạo request, observer đọc response | Tránh bóc text từ mọi node giao diện nếu response đủ dữ liệu | Vẫn cần UI kích hoạt batch; chưa chứng minh payload Facebook đủ trường |
| **Request + cursor quan sát được** | Code gửi request đọc batch kế tiếp trong đúng phiên | Có thể bỏ render/cuộn cho từng batch, parser và lưu trữ chạy độc lập | Phải kiểm operation, ngữ cảnh phiên, continuation, lỗi và schema thực; không chỉ chép một cURL rồi giả định chạy bền |
| API/provider có endpoint được hỗ trợ | Gọi endpoint và continuation của dịch vụ | Contract rõ hơn nếu đáp ứng đúng nguồn | Khả năng phủ nguồn, quyền, chi phí và giới hạn riêng; không tự mua hoặc đổi provider |

GraphQL có chuẩn phân trang cursor, nhưng điều đó **không chứng minh Facebook Search của phiên này dùng đúng tên field hoặc cho gửi tiếp độc lập**. Chỉ dùng schema/request thật sau khi quan sát. [Relay Cursor Connections](https://relay.dev/graphql/connections.htm).

Một hoặc hai thao tác UI để khám phá request phân trang khác với việc agent điều khiển desktop cho mọi bài. Giảm thao tác desktop không tự chứng minh nhiều dữ liệu hơn hoặc không bị giới hạn server.

## 3. Tận dụng code hiện có

- `src/infrastructure/browser/response-observer.ts`: đã có Network.enable/getResponseBody, ownership, byte/time limits. Cần nối source thật có phạm vi; không viết lại observer.
- `src/main/electron-probe-driver.ts`: hiện chỉ fixture driver. `src/main/index.ts:87` chưa cấp production network driver.
- Profile và session Electron đã đăng nhập; không tạo trình duyệt mới hoặc chuyển cookie ra tool khác cho phép thử này.
- Fixed DOM reader dùng đối chiếu mẫu và nguồn công khai; không mở lại vòng bổ sung từng CSS/SVG/ARIA để cho phép đọc bài.
- Parser/normalizer và writer nhỏ là phần cần làm sau khi có mẫu thực. Chưa dựng distributed queue, nhiều tài khoản hoặc dashboard.

Electron có debugger/CDP và Chromium network transport. Bản type declaration cục bộ có Session.fetch; việc dùng Session.fetch hay fetch trong context trang phải kiểm trên request thật. Cùng cookie không bảo đảm cùng ngữ cảnh origin/referrer/CSRF hoặc application state. [Electron Debugger](https://www.electronjs.org/docs/latest/api/debugger). Khả năng chạy script/quan sát navigation có trong [webContents](https://www.electronjs.org/docs/latest/api/web-contents).

## 4. Một phép thử, tối đa 60 phút tổng

Ngân sách tính từ khi người dùng cho khởi động phép thử, gồm coding, kiểm, build và LIVE; không reset mỗi lần sửa. Không tự bật heartbeat. Một worker triển khai, lead kiểm phần thay đổi và kết quả. Worker thứ hai vẫn dừng; không lặp toàn bộ suite ở cả hai phía.

### B00 — Quan sát request/response thật, trần tích lũy 20 phút

1. Gắn observer đúng webContents trước thao tác tìm kiếm. Dùng một query thuộc workload đã chốt và filter đã xác minh.
2. Đối chiếu response với vài card đang hiển thị, xác định nhánh record chứa bài và liên kết. Không parse mọi response có chữ GraphQL.
3. Nếu cần, một thao tác cuộn có giới hạn để quan sát request lấy batch tiếp theo và response tương ứng. Phải biết request là đọc kết quả, không mutation/social action.
4. Ghi cấu trúc cần thiết: operation nhận diện được, query/filter, biến continuation và phạm vi phiên; không giả định doc_id/tên field/token ổn định hay lấy từ internet. Secrets chỉ trong bộ nhớ phiên, không log request đầy đủ/headers/HAR vào repo.
5. Báo đúng lý do nếu observer bỏ dữ liệu vì MIME, kích thước, thời điểm attach, stream chưa kết thúc, source error hoặc không có record phù hợp.

**Đầu ra bắt buộc:** ít nhất một record Facebook thật với URL bài quan sát được và thông tin hữu ích, cùng bằng chứng chỉ ra request/response nào tạo nó. Nếu không có, kết thúc nhánh ở mốc này, không xây parser giả để tiếp tục.

### B01 — Chứng minh continuation không cần cuộn, trần tích lũy 40 phút

1. Từ operation đọc đã quan sát, thử đúng continuation của cùng query/filter/profile; dùng cursor như opaque value, không đoán/sửa ID hoặc suy cursor là số trang.
2. Trước hết so sánh một batch có UI baseline để biết code gửi đúng luồng. Sau đó, nếu còn continuation, thử batch kế tiếp chưa cần render. Không xem HTTP 200 là thành công: phải parse được đúng record/schema và phát hiện lỗi ứng dụng.
3. Chỉ xác nhận thành công khi batch mới có ít nhất một identity/link mới ngoài tập trước đó, nội dung đúng truy vấn và provenance liên tục. Batch trả lại trang đầu hoặc chỉ lặp record là chưa đạt.
4. Không chia cursor giữa account/query/filter; không đổi account/proxy để vượt lỗi. Auth/challenge/deny/rate limit thật thì dừng run. Lỗi kỹ thuật chỉ được một lượt sửa có căn cứ trong ngân sách; không retry vòng lặp.

**Đầu ra bắt buộc:** file batch A/B, số unique tăng, evidence request tiếp nối và thời gian. Nếu continuation không chạy thì báo hạn chế cụ thể; chưa được gọi là request-first collector hoạt động.

Scope này rộng hơn các ADR DOM/passive-only trước đó. Khi được khởi động, lead phải ghi rõ quyết định phạm vi mới cho việc gửi request đọc được quan sát; không âm thầm coi ADR-010/017 đã cho phép. Việc nghiên cứu này không tự thay platform permission UNKNOWN.

### B02 — Lưu dataset nhỏ, trần tích lũy 60 phút

- Mục tiêu thử: 20 URL bài khác nhau có metadata đọc được. Đây là mục tiêu để kết luận pilot, không ép đủ bằng cách bỏ giới hạn hoặc đổi workload.
- Tổng tối đa 2 lượt search/filter do UI, 2 thao tác cuộn khám phá và 5 request continuation do CSD phát sinh; một request tại một thời điểm. Đây là giới hạn thao tác ứng dụng, không phải tất cả HTTP request nền của Facebook.
- Dừng sớm khi hết continuation, cursor lặp, hai batch liên tiếp không có link mới, chạm deadline/budget hoặc có barrier. Phân biệt hết nguồn với lỗi phân trang/parser.
- Ghi JSONL ngay theo batch. Chỉ lưu checkpoint sau dữ liệu batch đã ghi thành công; restart đọc lại file/identity set, duplicate không tăng count. Khi có volume thật mới bổ sung SQLite transaction theo master plan.
- Xuất bảng số: records đọc được, link duy nhất, thiếu trường nào, đã xác minh public/nguồn/relevance bao nhiêu, số lần can thiệp và nguyên nhân kết thúc.

**Kết thúc bắt buộc:** dataset mở kiểm được hoặc báo cáo thất bại cụ thể. Không tiếp tục tự động sang mốc 100/1.000 hoặc kéo dài qua đêm.

## 5. Record tối thiểu và cách xử lý metadata

Link đã quan sát là đầu ra bắt buộc của bản ghi ứng viên. Không chặn persist chỉ vì ngày đăng/counter còn thiếu. Không tự dựng permalink từ ID chưa xác minh.

| Trường | Cách lưu |
| --- | --- |
| observed_post_url, post_id | URL thực nhận, ID dạng string nếu xác lập được; giữ alias/provenance để dedup |
| text/snippet | Phần nội dung đúng bài; ghi truncated/unknown khi cần |
| source_type, visibility | PAGE/GROUP/PROFILE/UNKNOWN tách PUBLIC/PRIVATE/UNKNOWN; không suy public từ login/search filter |
| published_at, published_at_raw, precision | Timestamp có bằng chứng hoặc null; giữ thời gian tương đối gốc, không bịa chính xác |
| reactions_total, love_count, comments_count, shares_count | Tách tổng reactions khỏi tim; không đọc được là null, không phải 0; số rút gọn có cờ approximate |
| collected_at, query, evidence_ref, extraction_method | Đủ truy nguồn và kiểm vì sao có record |

Ứng viên lưu được không tự là bài hợp lệ của benchmark. Bài đã xác minh identity/link, công khai, nguồn và relevance mới vào bộ đếm chất lượng tương ứng. Không lẫn trạng thái quyền/benchmark với số lượng kỹ thuật đã trích được.

## 6. Quy tắc chọn hướng sau phép thử

| Kết quả | Quyết định |
| --- | --- |
| Response có bài, continuation trả batch mới không cần UI | Chọn request-first làm ứng viên chính cho pilot lớn hơn; DOM dùng đối chiếu/bổ sung |
| Response có bài, continuation chỉ chạy khi UI điều khiển | Giữ browser-driven response capture là phương án có bằng chứng; chưa gọi direct request tốt hơn |
| Chỉ DOM đọc được phần cần thiết | Đánh giá DOM collector nhỏ theo yield thật; không coi CPU/render tự động là bất khả thi |
| Không đường nào có link/bài đúng trong ngân sách | Kết thúc nhánh; không tiếp tục cùng vòng sửa và không suy toàn bộ bài toán bất khả thi |

Sau khi có bằng chứng mới đề xuất pilot 100 bài/nhiều query và ba loại nguồn. Một query có thể hết kết quả trước 1.000; tăng tốc transport không tạo thêm nguồn. Chỉ benchmark thực tế mới kết luận 1.000 bài Facebook hợp lệ trong 24 giờ; không ngoại suy tốc độ vài batch.

## 7. Những điều không dùng làm thước đo thành công

- Số version, số test PASS, số file hoặc 11/40 task.
- Có HTTP 200, JSON parse được nhưng không có bài đúng.
- Lấy được cùng một bài nhiều lần.
- Đọc được DOM sau khi agent tự mở từng bài, rồi gọi đó là collector tự động.
- Chuyển sang nhiều account, proxy hoặc provider trả phí để che lỗi chưa biết.

Thước đo quyết định là **link bài mới và metadata thực đã được lưu, truy được nguồn**, cùng chi phí thao tác và độ đầy đủ. Không yêu cầu nạp thêm tiền để bảo đảm một kết quả chưa được chứng minh.
