# CSD — Phương án kiểm chứng lại nguồn sau khi dừng

28/10/2026, Asia/Bangkok. **ĐỀ XUẤT, CHƯA TRIỂN KHAI.** Người dùng yêu cầu suy nghĩ phương án sau khi yêu cầu dừng toàn bộ. Hai worker đã dừng, automation đã xóa. Tài liệu này không khôi phục dispatch, không thay master plan/gate và không cho chạy Facebook. Lượt nghiên cứu chỉ đọc code, evidence và tài liệu kỹ thuật chính thức; không đọc `.env`, không chạy build/test/nguồn thật.

## 1. Kết luận và căn cứ

Ưu tiên thử **đọc phản hồi dữ liệu mà chính trang Facebook đang tải**, tái sử dụng Electron response observer; dùng DOM đối chiếu nội dung và bối cảnh công khai. Đây là giả thuyết kỹ thuật có thể kiểm chứng nhanh, chưa phải bằng chứng lấy được dữ liệu Facebook bằng cách này.

Không tiếp tục lấy việc mở timestamp làm điều kiện bắt buộc trước khi đọc một bài. Chỉ mở chi tiết khi trường thực sự cần còn thiếu. Không cần đổi Electron sang Python/Playwright/Crawlee để thực hiện phép thử đầu.

Những gì xác minh được trong repository:

| Bằng chứng | Ý nghĩa |
| --- | --- |
| `src/infrastructure/browser/response-observer.ts:154,221` đã dùng `Network.enable` và `Network.getResponseBody` | Có hạ tầng nhận response body, chưa phải Facebook parser |
| `src/main/electron-probe-driver.ts:6` chỉ có `createFixtureProbeDriver`; `src/main/index.ts:87` cấp driver này ở smoke, còn lại null | Nhánh probe network hiện chưa được nối với Facebook thật; DOM diagnostic là nhánh riêng, không suy rằng toàn bộ app không đọc được Facebook |
| P01.03 có nghiệm thu observer trên fixture/replay | Tận dụng hạ tầng đã có, không nghiệm thu lại toàn bộ framework |
| LIVE v18 đọc lại một snippet nhóm công khai và khớp hash | Đã có bằng chứng đọc nội dung thật, chưa chứng minh search extraction hoặc throughput |
| LIVE v24/v25 bị loại bởi ARIA/style trong classifier CSD | Một phần nút thắt là điều kiện nội bộ, chưa có bằng chứng Facebook chặn các lượt này |
| Product contract mục 2 cho `UNBOUNDED` với `published_at = null`; mục 3 cho snippet đủ xác định chủ đề | Không cần ngày đăng chính xác hoặc full text mọi bài để kiểm chứng workload hiện tại; identity, permalink, nguồn/công khai và relevance vẫn cần bằng chứng |

Sai lầm trước đó: biến các yêu cầu chứng minh UI/action thành mục tiêu trung gian kéo dài, không có ngân sách dừng theo kết quả dữ liệu. Guard cho đăng nhập, Stop, ownership và dữ liệu đúng nguồn vẫn cần; hiểu mọi thuộc tính trang trí không phải mục tiêu sản phẩm.

## 2. Đường dữ liệu đề xuất

```text
Trang Facebook trong profile CSD hiện có
  → tìm kiếm/cuộn có giới hạn bằng giao diện bình thường
  → observer nhận response của chính trang đó
  → parser chỉ lấy record bài thuộc kết quả đang kiểm tra
  → đối chiếu DOM / bằng chứng công khai / liên kết bài
  → loại trùng theo identity → lưu JSONL ứng viên và kết quả xác minh
```

Electron cung cấp CDP qua `webContents.debugger`; Chrome DevTools Protocol có `Network.getResponseBody` để đọc nội dung response theo requestId. Năng lực của công cụ là đã có tài liệu, còn response Facebook của phiên này chứa những trường nào **chưa được quan sát**. [Electron Debugger](https://www.electronjs.org/docs/latest/api/debugger), [Chromium Network protocol](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Network.pdl).

Phép thử quan sát request/response do UI tạo ra; không tự gọi endpoint đoán sẵn, không replay GraphQL/cursor/token và không đổi proxy/account. Nếu thấy GraphQL thì coi đó là định dạng nội bộ vừa quan sát, không gọi nó là Meta Graph API hoặc API được Meta cấp quyền. Platform permission vẫn UNKNOWN.

### Bước khó phải kiểm trước khi viết parser

- Response có liên quan đúng query/current view không? Có chứa chính bài đang hiển thị không? Cùng endpoint không đủ để xác lập liên quan.
- Có text, identity và URL bài thực sự, hay chỉ fragment/tham chiếu? Không coi mọi field `id` là post ID; không ghép text/author/URL từ các nhánh JSON khác nhau tùy tiện.
- Body là JSON đơn, nhiều message/chunk, multipart hay định dạng khác? Chỉ hỗ trợ cấu trúc thực sự quan sát; không `eval` nội dung.
- Có dữ liệu được tải trước nhưng không hiển thị, ngoài query, quảng cáo, bình luận hoặc story đính kèm? Chỉ retain phần đã liên kết với bài trong phạm vi thử; không dump toàn bộ payload vào repo.
- Publicity của từng bài và loại nguồn có thể đối chiếu không? Nhãn lọc “công khai”, tài khoản nhìn thấy bài hoặc `author_type=PAGE` riêng lẻ không thay bằng chứng bối cảnh xuất bản.

### Các giới hạn observer hiện tại cần nhìn thẳng

Default hiện chỉ Fetch/XHR, MIME JSON/plain text, 128 KiB/body, 512 KiB buffer, 2 MiB tổng, 30 giây/run và chỉ đọc sau loadingFinished. Đây là cấu hình fixture, **không biết đã phù hợp Facebook hay chưa**. Body lớn, MIME khác, initial document, stream chưa kết thúc hoặc observer gắn quá muộn đều có thể khiến không nhận được body.

Phải gắn observer trước thao tác tải mới; log số response, MIME/size/drop reasons và thời điểm. Có thể override giới hạn có cận trong phép thử; không bỏ mọi giới hạn. Một cấu hình thử được chốt trước run có thể dùng 2 MiB/body, 16 MiB buffer, 32 MiB tổng và segment tối đa 60 giây, với tổng thời gian/số segment cố định bên ngoài. Vẫn phải báo truncation/drop, không hiểu response rỗng là Facebook không có bài. Nếu cấu hình này không đủ, ghi thất bại cụ thể trong ngân sách thử thay vì tự tăng vô hạn.

Giữ raw body trong main memory để chọn field; chỉ lưu bản trích tối thiểu local ngoài repo. Không lưu cookie/header/token hoặc dữ liệu luồng không liên quan. DOM chỉ dùng đọc/đối chiếu vùng bài đang xem; không tiếp tục phát triển bộ kiểm toàn bộ cây CSS/SVG.

## 3. Một phép thử có giới hạn, không mở lại cả dự án

Nếu người dùng cho tiếp tục, đề xuất **tối đa 60 phút tổng từ lúc bắt đầu triển khai đến kết luận**, gồm coding, build, kiểm và LIVE. Đây là ngân sách thử, không hứa hoàn thành trong một giờ. Không khởi động heartbeat qua đêm. Một worker thực hiện; lead kiểm phần thay đổi cần thiết và chạy nguồn, không hai worker cùng lặp toàn bộ suite.

| Mốc trần tích lũy | Đầu ra cần thấy | Nếu không có |
| --- | --- | --- |
| 15 phút | Observer gắn đúng phiên và có metadata response/drop đủ để biết dữ liệu đi đâu | Xác định lỗi wiring/filter/body access, không viết parser giả |
| 30 phút | Ít nhất một bài thật được ánh xạ response ↔ bài đang hiển thị, có text và identity/URL từ bằng chứng | Kết thúc hướng network tại ngân sách này nếu không có bằng chứng nội dung; không đẻ thêm framework |
| 60 phút | Mục tiêu 20 bài thật không trùng có link và text đủ dùng; phân loại riêng số đã xác minh công khai/nguồn/relevance và số còn thiếu | Báo chính xác số đạt và lý do không đạt; dừng đợt thử, không tự cấp thêm một giờ |

Ngân sách nguồn đề xuất: tối đa hai lượt tải kết quả, tối đa ba thao tác cuộn mỗi lượt, một tài khoản; chọn từ workload có sẵn. Chỉ cho lượt thứ hai khi có thay đổi cụ thể hoặc kiểm chứng tiếp trang/đổi query; không tìm lại cùng query vô điều kiện. Nếu hết bài sớm thì báo yield thấp, không tăng lượt để ép đủ 20. Auth/challenge/deny thật thì dừng run.

Không đạt mốc 30/60 phút chỉ kết luận hướng thử này chưa đạt trong ngân sách; không suy toàn bộ Facebook bất khả thi. Nhánh URL mới có sẵn và current-post reader là lựa chọn phụ để lấy trường thiếu, không tiếp tục thêm hàng loạt điều kiện timestamp. Nếu cần đổi hướng lần nữa, phải có kết luận và phạm vi mới, không tự nối thành vòng chạy không hạn.

Đầu ra là một file người dùng mở kiểm được: nội dung, link, nguồn, query, thời gian thu, trạng thái xác minh và lý do thiếu. `.brain` chỉ báo số/hash/tham chiếu; số test hoặc số version không thay dữ liệu thật.

## 4. Sau khi đã có dữ liệu mới tính chuyện 1.000 bài

Mốc đầu không cần đủ ba loại nguồn để chứng minh transport; chỉ ghi rõ phạm vi nguồn vừa kiểm. Mục tiêu cuối vẫn đủ cả Page, nhóm công khai, cá nhân công khai. Không dùng một nguồn thay nguồn còn thiếu.

Sau phép thử nhỏ mới đề xuất pilot 100 bài qua nhiều query và continuation. Đo số mới không trùng mỗi lần tải/cuộn, số đủ dữ liệu, loại nguồn, phút can thiệp và lý do dừng. Giới hạn thử pilot phải chốt riêng; không tự mở lại toàn master plan.

Nếu search nhanh bão hòa: chuyển sang các query khác đúng intent và nguồn Page/nhóm liên quan được khám phá từ search. Đây là chiến lược tăng nguồn ứng viên, chưa được chứng minh làm tăng yield. Không xoay nhiều account chỉ để che lỗi parser hoặc tránh challenge. TikTok/Apify vẫn là nhánh khác và không cộng vào chỉ tiêu Facebook.

1.000/24 ≈ 41,7 bài hợp lệ/giờ là mức trung bình số học, không phải dự báo. Có 20 bài đầu chưa chứng minh giữ tốc độ hay còn đủ nguồn; chỉ run thực tế với dedup, quality và source coverage mới kết luận 1.000/24h. Không lấy vài phút đầu nhân 24 giờ.

## 5. Cách báo tiến độ thay thế

Mỗi lượt báo: response liên quan → record trích được → identity duy nhất → bài đủ bằng chứng công khai/nguồn/relevance → số thiếu từng loại trường. Trạng thái benchmark/permission được báo riêng; không hard-code mọi tiến bộ kỹ thuật thành số 0 rồi dùng nó làm báo cáo duy nhất, cũng không tự đổi mẫu chẩn đoán thành benchmark hợp lệ.

Không báo phần trăm dự án từ 11/40 task trong giai đoạn chưa chứng minh nguồn. Chỉ có các mốc thực tế: chưa lấy được dữ liệu; lấy được mẫu; lấy được nhiều trang; đạt pilot; đạt 1.000/24h; lặp lại ổn định.

## 6. Kết luận quyết định

Có một hướng thử khác đáng kiểm chứng và đã có một phần hạ tầng trong repo. Chưa có bằng chứng nó sẽ thành công với Facebook của phiên này, và chưa có căn cứ bảo đảm 1.000 bài. Thay đổi quan trọng là chứng minh schema/dữ liệu trước, dùng thời hạn kết thúc rõ và không tiếp tục đầu tư nếu chỉ có fixture/test PASS.

Dự án vẫn dừng. Tài liệu này giữ lại phương án để người dùng xem xét, không phải lệnh giao việc.

## 7. Bổ sung theo đầu ra người dùng vừa làm rõ: link trước, thông tin đọc được sau

Người dùng nhấn mạnh đầu ra là link bài và thông tin hữu ích: loại nguồn, công khai, ngày đăng, tim/share. Đây là lý do đơn giản hóa bộ thu: lưu record ứng viên có link đã quan sát ngay, bổ sung metadata theo bằng chứng; không buộc mọi trường hoàn chỉnh mới được lưu. Không tự bỏ mục tiêu 1.000/24h hoặc tính ứng viên UNKNOWN thành bài công khai hợp lệ.

### Các điểm lấy dữ liệu và thứ tự thử

1. **DOM card đang render:** đọc href/text/nhãn/mốc thời gian/counters trong cùng card bằng script cố định; lưu trước khi card bị cuộn khỏi DOM. Không dùng giả định class CSS bền vững. Script đọc không cần hiểu toàn bộ trang trí SVG/CSS.
2. **Response mạng:** bổ sung ID, URL, text, timestamp/counters nếu body thật có và liên kết đúng bài; tận dụng observer có sẵn. Không chứng minh thêm điều gì từ docs CDP ngoài năng lực đọc response của công cụ.
3. **Dữ liệu nhúng trong HTML/script data blocks:** kiểm tra cấu trúc dữ liệu có sẵn trong document nếu response XHR không chứa phần cần lấy. HTML cho phép script data blocks, nhưng Facebook có trường cần thiết ở đó hay không là UNKNOWN đến khi quan sát. Parse như dữ liệu, không chạy/eval và không dump document chứa thông tin ngoài phạm vi. [HTML Standard](https://html.spec.whatwg.org/multipage/scripting.html#the-script-element).
4. **URL native từ context-menu:** Electron `context-menu` trả `params.linkURL`, có thể dùng để lấy liên kết Chromium đang nhận diện trên đúng node. Nếu còn placeholder thì vẫn là placeholder; API này không tự sinh permalink. Evidence v24/v25 đã ghi href bài xuất hiện sau thao tác con trỏ/context-menu, chưa tách được nguyên nhân do hover hay right-click. Đây là fallback đáng thử có giới hạn, không cần mở menu bằng AI từng bài. [Electron context-menu](https://www.electronjs.org/docs/latest/api/web-contents#event-context-menu).
5. **Mở bài và lấy URL điều hướng thực tế:** theo dõi URL main frame/in-page navigation và `getURL()` nếu thật sự chuyển tới permalink; modal không đổi URL thì nhánh đó không giải quyết được identity. Chỉ mở bài thiếu link/trường, không áp cho mọi record.
6. **Nút sao chép liên kết của giao diện, nếu thực sự có:** fallback cuối cho một số bài, chỉ thao tác copy-link, không đăng/chia sẻ nội dung. Đọc clipboard trong khoảng thao tác có kiểm chứng để tránh nhầm clipboard cũ; tránh dùng clipboard chung cho nhiều worker song song. Chưa xác minh control này trên phiên hiện tại. [Electron clipboard](https://www.electronjs.org/docs/latest/api/clipboard).

Nguồn tìm kiếm bên ngoài hoặc vendor có thể bổ sung permalink, nhưng không làm counters/visibility đúng hoặc đầy đủ hơn một cách tự động. Không mở thêm connector trong phép thử đầu. Accessibility tree phản ánh UI và có thể hỗ trợ định vị, không xem như nguồn dữ liệu độc lập bảo đảm đủ bài.

### Luồng sản phẩm tối thiểu

Một worker code trong Electron: mở query một lần → nhận response và card mới → lấy link bằng đường sẵn có → lưu record → cuộn có điều kiện để lấy batch mới → dedup → bổ sung trường thiếu khi cần. Một card chỉ nhận tối đa một lượt fallback lấy link trong batch; không có link thì ghi lý do và chuyển card khác. Theo dõi số link mới để nhận biết bão hòa, không search lại cùng keyword mỗi lần nâng bản parser.

Không dùng agent điều khiển desktop để vận hành từng bài. Electron đã hỗ trợ `executeJavaScriptInIsolatedWorld`, sự kiện navigation/context-menu và `sendInputEvent`. Riêng `sendInputEvent` yêu cầu cửa sổ chứa webContents được focus theo docs; không hứa chạy nền hoàn toàn hoặc không ảnh hưởng desktop trước khi kiểm. [Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents#contentssendinputeventinputevent).

Đầu ra đầu tiên là JSONL local để kiểm ngay, có thể nạp SQLite sau khi đường nguồn hoạt động. Dùng cùng local store được bảo vệ và không để secrets/raw payload lẫn vào output. Không xây thêm UI/queue framework trước khi có record thật.

Các trường tối thiểu: observed_post_url, post_id nếu có, snippet, source_type, visibility, published_at/published_at_raw, reactions_total, love_count, comments_count, shares_count, collected_at, query và evidence/provenance. Nguồn PAGE/GROUP/PROFILE khác với visibility PUBLIC/PRIVATE/UNKNOWN; Page là tác giả trong nhóm không biến bối cảnh xuất bản thành Page.

Thiếu metadata lưu null kèm lý do, không ghi 0; thời gian tương đối giữ raw/độ chính xác thay vì bịa timestamp; tổng reactions không phải số tim. Lưu nguyên biểu diễn rút gọn như 1,2K và đánh dấu approximate nếu cần chuyển số. Chỉ đếm vào kết quả công khai đã xác minh khi identity/link, bối cảnh và relevance đủ bằng chứng; các mục còn thiếu vẫn nhìn thấy trong danh sách ứng viên.

Đây là cập nhật phương án theo yêu cầu suy nghĩ, chưa chạy nguồn hoặc khởi động lại worker.
