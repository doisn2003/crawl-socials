**Thẩm định khả thi thu thập bài viết Facebook bằng Electron**

Ngày đánh giá: 27/10/2026. Đầu vào là [tài liệu nghiên cứu ban đầu](C:/OwnProject/crawl-socials/crawl-socials-data-with-electron.txt), [mã nguồn HotMatch](C:/OwnProject/hotmatch-desktop), tài liệu chính thức của các nền tảng và repository gốc.

**Mục tiêu đã được xác nhận:** Facebook là nền tảng bắt buộc ở bản đầu; thu thập 1.000 bài viết trong tối đa 24 giờ chạy; được lấy bài cũ. Bản đánh giá hiểu “1.000 bài” là 1.000 bài khác nhau, đúng chủ đề, có đường dẫn bài viết dùng được. Không cộng bình luận, link nhóm hoặc link Page vào số bài. Chưa có yêu cầu mỗi ngày tiếp theo phải tìm thêm 1.000 bài chưa từng thu thập.

**Kết luận: đáng đầu tư một thử nghiệm nhỏ có tiêu chí nghiệm thu; chưa đủ bằng chứng để bắt đầu xây toàn bộ sản phẩm theo lời hứa trong tài liệu gốc.** Mục tiêu 1.000 bài lịch sử trong 24 giờ có cơ sở kỹ thuật để thử, nhất là với chủ đề rộng và nguồn được truy cập phù hợp. Chưa thể bảo đảm đạt cho mọi bộ từ khóa, hoặc đồng thời bao phủ bài cá nhân, Groups và Pages trên toàn Facebook. Nghiên cứu và đọc mã nguồn chưa thay thế cho một lần chạy thật đạt mục tiêu; hiện chưa có benchmark Facebook như vậy trong đợt thẩm định này.

Tài liệu gốc có nhiều ý tưởng kiến trúc đúng: tách tìm nguồn khỏi lấy dữ liệu, mở rộng từ khóa có kiểm soát, chuẩn hóa định danh, loại trùng, lưu phiên và chấm mức liên quan. Điểm yếu nằm ở việc chuyển những khả năng kỹ thuật này thành cam kết về số bài và độ ổn định mà chưa đo.

**Tốc độ máy tính không phải trở ngại chính.** 1.000 bài trong 24 giờ tương đương 41,7 bài hợp lệ mỗi giờ. Nếu chỉ có 8 giờ hoạt động hiệu quả, hệ thống cần 125 bài hợp lệ mỗi giờ. Đây là số bài cuối cùng sau loại trùng và kiểm tra chất lượng, không phải số request hay số bản ghi nhận về.

Về mặt số học, một tập 2.500 bản ghi có 60% còn lại sau loại trùng, 75% trong số đó đúng chủ đề và 90% tiếp tục đạt kiểm tra đường dẫn sẽ cho khoảng 1.013 bài. Đây chỉ là ví dụ giả định để thấy tác động của hao hụt, không phải dự báo công suất. Các tỷ lệ thực phải đo theo từng nguồn và bộ từ khóa; càng tìm lâu, tỷ lệ bài mới thường cần được theo dõi riêng thay vì giữ một hệ số cố định để ngoại suy.

“Cà phê”, “quán cà phê Đà Lạt” và “Tiny Coffee tại một địa chỉ cụ thể” là ba bài toán có lượng nguồn cung khác nhau. Nếu chỉ có 300 bài phù hợp mà hệ thống có thể tiếp cận, chạy nhanh hơn hoặc thêm profile không tạo ra 700 bài còn thiếu. Mở rộng từ khóa cũng không được làm thay đổi nhu cầu chỉ để đủ số lượng.

**Facebook có các đường truy cập khác nhau, và không đường nào mặc nhiên giải quyết toàn bộ phạm vi.**

| Đường dữ liệu | Khả năng dùng cho mục tiêu | Giới hạn quyết định |
| --- | --- | --- |
| Pages có quyền truy cập phù hợp | Có thể lấy bài từ tập Page đã biết, rồi lọc theo từ khóa và chủ đề | Chỉ giải quyết nguồn Pages; quyền và mục đích sử dụng cần được chấp thuận |
| Page Public Content Access | Có cơ chế được xét duyệt để đọc nội dung public của Pages ngoài những Page tự quản lý | Không mặc định có quyền khi tạo app; không mở rộng thành quyền đọc mọi Groups/bài cá nhân |
| Groups API cũ | Không thể làm nền tảng cho dự án mới | Meta đã gỡ trên mọi phiên bản từ 22/4/2024 |
| Meta Content Library/API | Có dữ liệu công khai và chức năng phục vụ nghiên cứu | Dành cho tổ chức/nghiên cứu đủ điều kiện, có xét duyệt; không phải API thương mại mở cho startup |
| Kết quả tìm kiếm web | Hữu ích để phát hiện bài và nguồn đã được lập chỉ mục | Không đầy đủ; có thể gặp link cũ, link nhóm, link không xác minh được |
| Giao diện Facebook qua Electron | Có thể quan sát và trích xuất dữ liệu mà phiên truy cập thực sự được trả về | Cần xác minh quyền thu thập, độ bền, phân trang và lượng bài tìm thấy; chưa có bảo đảm sản lượng |

Meta xác nhận việc gỡ Groups API trong [Graph API v19.0 changelog](https://developers.facebook.com/docs/graph-api/changelog/version19.0/). Có quản trị viên nhóm hợp tác cũng không làm API đã bị gỡ xuất hiện trở lại.

[Page Public Content Access](https://developers.facebook.com/docs/features-reference/page-public-content-access/) là tuyến xin quyền phân tích/hiển thị bài và tương tác trên Pages; cần xét duyệt ứng dụng, xác minh doanh nghiệp và có thể có hợp đồng bổ sung. Việc lưu hoặc xuất URL kèm snippet phải phù hợp phạm vi được cấp. [Pages Search](https://developers.facebook.com/docs/pages-api/search-pages/) tìm Page để làm nguồn đầu vào; nó không phải API tìm mọi bài viết Facebook theo từ khóa.

[Meta Content Library Get access](https://developers.facebook.com/docs/content-library-and-api/get-access/) quy định điều kiện tổ chức học thuật/phi lợi nhuận và xét duyệt nghiên cứu. Vì thế, không nên đưa quyền dùng thư viện này vào kế hoạch thương mại như một đầu vào chắc chắn.

Đối với trình duyệt, người dùng đăng nhập được và nhìn thấy nội dung công khai chưa đồng nghĩa phần mềm đã được phép tự động thu thập. Meta công bố việc hạn chế thu thập tự động không được cho phép, gồm giới hạn truy cập và phát hiện hành vi. Điều này tác động trực tiếp đến độ bền vận hành, nên “không bị phát hiện” không thể là giả định nền tảng của sản phẩm. [Meta How We Combat Scraping](https://about.fb.com/news/2021/04/how-we-combat-scraping/amp/).

Nếu nhu cầu quan trọng là các bài hỏi đáp trong Groups, 1.000 bài quảng bá từ Pages không phải kết quả tương đương. Khi nghiệm thu phải báo cáo riêng số bài từ Page, nhóm công khai và tài khoản cá nhân, cùng tỷ lệ nội dung quảng cáo, hỏi đáp, review hoặc loại khác mà người dùng cần.

**Những khẳng định cần sửa trong nghiên cứu ban đầu:**

| Khẳng định | Đánh giá sau kiểm chứng |
| --- | --- |
| Mỗi truy vấn MXH thường có trần 200–500 bài | Không có căn cứ dùng như hằng số chung cho Facebook, TikTok, Threads và X. Giới hạn phụ thuộc giao diện/API, loại truy vấn, quyền và phân trang. |
| 100 nhóm × vài trăm bài sẽ thành hàng chục nghìn bài phù hợp | Chỉ là phép nhân giả định. Phải trừ nhóm không tiếp cận được, bài trùng giữa truy vấn, bài sai chủ đề và giới hạn tìm kiếm. |
| SearXNG giúp tìm hàng nghìn link mà không lo bị chặn | SearXNG tổng hợp kết quả từ engine khác; nó không tạo chỉ mục Facebook đầy đủ hay loại bỏ giới hạn của engine. |
| Cookie Google lâu năm giúp quét hàng trăm trang ổn định | Chưa có benchmark hoặc bảo đảm chính thức cho kết luận này. Không dùng làm cơ sở công suất. |
| Thay UA, Client Hints, tắt Node là xử lý triệt để anti-detection | Những cấu hình có ích không chứng minh tự động hóa không bị nhận diện, không bị giới hạn hoặc được phép. |
| Bắt JSON qua CDP là đã có crawler Facebook | CDP chỉ cung cấp dữ liệu đầu vào. Vẫn cần nhận diện operation, parse schema, lấy ID/URL, theo cursor, phân biệt lỗi và khôi phục nhiệm vụ. |
| Đã làm sẵn 70%, chỉ cần thêm bốn module | Không có cách đo phần trăm này. Bộ khung có thật nhưng phần discovery và khả năng vận hành Facebook chưa được chứng minh. |
| Tiết kiệm 85–90% tài nguyên; chạy nền giữ 100% tốc độ | Có cấu hình chặn tài nguyên và chống throttling; các tỷ lệ hiệu quả chưa được đo trên Facebook. |

Google nói rõ toán tử `site:` không trả đầy đủ mọi URL được lập chỉ mục. Vì vậy kết quả tìm kiếm web là một nguồn discovery, không phải mẫu số để tính tỷ lệ bao phủ Facebook. [Google Search Central](https://developers.google.com/search/docs/monitor-debug/search-operators/all-search-site).

SearXNG có cấu hình riêng cho CAPTCHA, từ chối truy cập và lỗi quá nhiều request; điều này bác bỏ cách hiểu “self-host là hết bị chặn”. [SearXNG search settings](https://docs.searxng.org/admin/settings/settings_search.html).

Khi chọn dịch vụ search cho triển khai mới, cũng cần cập nhật hiện trạng: [Bing Search APIs đã ngừng ngày 11/8/2025](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement); [Google Custom Search JSON API đóng với khách hàng mới, khách hàng cũ phải chuyển đổi trước 1/1/2027](https://developers.google.com/custom-search/v1/overview). Những thay đổi này nói về API, không có nghĩa trang tìm kiếm Bing/Google đã ngừng hoạt động.

Một API search còn hoạt động cũng có giới hạn riêng. Ví dụ, [Brave Web Search](https://api-dashboard.search.brave.com/api-reference/web/search/get) cho tối đa 20 kết quả/trang và offset 0–9; các trang có thể trùng. Không được lấy số truy vấn nhân số kết quả tối đa để hứa số bài Facebook duy nhất. Quyền lưu kết quả cần được kiểm tra theo gói dịch vụ nếu lựa chọn nhà cung cấp này.

**HotMatch giúp giảm công việc xây bộ khung, nhưng cần tách khỏi nghiệp vụ hiện tại.**

| Thành phần đã có | Bằng chứng trong mã nguồn | Ý nghĩa với prototype |
| --- | --- | --- |
| Electron 44.7.0 | [package.json](C:/OwnProject/hotmatch-desktop/package.json:58) | Có nền tảng desktop Chromium để tái sử dụng |
| Partition bền vững và session riêng | [profiles.js](C:/OwnProject/hotmatch-desktop/main/profiles.js:82), [manager.js](C:/OwnProject/hotmatch-desktop/main/manager.js:67) | Quản lý phiên của người dùng |
| HTTP qua session và khóa chuyển mạng | [platform.js](C:/OwnProject/hotmatch-desktop/main/platform.js:137) | Tái sử dụng cơ chế gọi mạng theo profile |
| Đọc response body bằng CDP | [page-account-observer.js](C:/OwnProject/hotmatch-desktop/main/page-account-observer.js:90) | Nền tảng cho bộ quan sát phản hồi Facebook |
| Chặn ảnh/video/font | [lite.js](C:/OwnProject/hotmatch-desktop/main/lite.js:1) | Có thể giảm tải; cần thử để tránh làm hỏng luồng trang |
| Điều phối tài nguyên | [store.js](C:/OwnProject/hotmatch-desktop/main/store.js:6) | Có cấu hình giới hạn; chưa phải benchmark công suất MXH |

[Electron session.fetch](https://www.electronjs.org/docs/latest/api/session#sesfetchinput-init) dùng Chromium network stack. Tuy nhiên, gọi `ses.fetch` không tự thực thi JavaScript của website để tạo mọi token/chữ ký cho một request tùy ý. Khi trang web tự gọi API, mã của trang và phiên truy cập đảm nhiệm luồng đó; quan sát được request không đồng nghĩa có thể phát lại mãi mãi.

Observer hiện tại chỉ nhận GET của `/api/v1/refresh`, MIME JSON, giới hạn 128 KB và dữ liệu `payload.user`. Nó còn bỏ một số response từ cache/service worker/child target. Xem [page-account-observer.js](C:/OwnProject/hotmatch-desktop/main/page-account-observer.js:128). Cho phép POST và tăng kích thước body chỉ giải quyết bước lọc đầu vào. Cần parser và fixture riêng cho Facebook, xử lý response lỗi hoặc đổi schema, đồng thời bảo đảm không ghi cookie/token vào log.

Cơ chế ngủ tab đóng webContents và giữ URL, không bảo toàn DOM/cursor tìm kiếm: [browser-tabs.js](C:/OwnProject/hotmatch-desktop/main/browser-tabs.js:97). Nhiệm vụ đang thu thập cần checkpoint và được phối hợp với cơ chế này. [Electron debugger](https://www.electronjs.org/docs/latest/api/debugger) cũng có thể detach khi mở DevTools; crawler cần nhận biết và khôi phục trạng thái thích hợp.

Cookie snapshot hiện lưu cả giá trị cookie vào JSON qua [session-cookies.js](C:/OwnProject/hotmatch-desktop/main/session-cookies.js:42) và [store.js](C:/OwnProject/hotmatch-desktop/main/store.js:83). Ghi file nguyên tử giúp tránh hỏng dữ liệu nhưng không phải mã hóa. Khi mang bộ khung sang sản phẩm mới, cần bảo vệ thông tin phiên; không sao chép dữ liệu tài khoản đang dùng sang bản thử nghiệm.

Các cờ sandbox, context isolation và tắt Node integration có giá trị bảo vệ ứng dụng tải nội dung bên ngoài. [Tài liệu bảo mật Electron](https://www.electronjs.org/docs/latest/tutorial/security) không biến những cấu hình đó thành bảo đảm tránh phát hiện bot. Không có căn cứ để đặt mua tài khoản/proxy hàng loạt trước khi biết một nguồn hợp lệ có đáp ứng nhu cầu hay không.

**Thiết kế nhỏ nhất đủ kiểm chứng mục tiêu nên gồm sáu phần:**

1. **Định nghĩa yêu cầu.** Bộ từ khóa, mô tả chủ đề, địa phương nếu có, loại bài cần lấy và điều kiện loại bỏ. Cho phép bài cũ nhưng vẫn lưu ngày đăng nếu nguồn cung cấp; không suy ngày đăng từ ngày search engine lập chỉ mục.
2. **Lập danh sách nguồn và truy vấn.** Kết hợp nguồn người dùng biết, nguồn tìm được và API được cấp quyền. Lưu truy vấn đã chạy và số bài mới tăng thêm. Chỉ chia theo ngày/khu vực khi giao diện hoặc API thực sự hỗ trợ bộ lọc đó.
3. **Adapter Facebook.** Tách adapter API được phép, kết quả search và giao diện trình duyệt. Mỗi adapter phải trả dữ liệu chuẩn cùng trạng thái rõ ràng: hết kết quả, bị giới hạn, cần đăng nhập, không được phép hoặc lỗi parse.
4. **Chuẩn hóa và lưu dữ liệu.** SQLite với khóa duy nhất theo nền tảng và post ID; URL là phương án bổ sung khi ID chưa xác định. Chỉ bỏ tham số tracking đã biết: `story_fbid`/`id` có thể là định danh, không được xóa mọi query string.
5. **Lọc liên quan.** Rules cho trường hợp rõ ràng, sau đó phân loại khi cần. Lưu lý do chấp nhận/loại bỏ. Đừng mặc định loại bài “tuyển dụng” hoặc “sang nhượng” nếu người dùng thực sự cần chúng.
6. **Điều phối và đo lường.** Lưu checkpoint, giới hạn thử lại, xử lý gián đoạn, ghi thời gian và chi phí. Dừng hoặc yêu cầu xử lý phù hợp khi bị hạn chế truy cập, thay vì coi dữ liệu rỗng là hết bài.

Mỗi bài tối thiểu có `platform`, `post_id` khi biết, `canonical_url`, `source_type`, `source_id` khi biết, `published_at` nếu có, `discovered_at`, `query_id`, đoạn nội dung đủ đánh giá chủ đề, trạng thái xác minh và kết quả lọc. Nguồn chưa đủ dữ kiện phải được đánh dấu “chưa xác minh” và không cộng vào số bài đạt chuẩn. Không cần tải video, toàn bộ ảnh, danh sách người tương tác hay tất cả bình luận để chứng minh mục tiêu lấy link bài.

Với mục tiêu 1.000 bài cho một lần chạy tối đa 24 giờ, đề xuất triển khai ban đầu là JavaScript/TypeScript cùng Electron và SQLite. Redis, Bloom filter, hàng đợi phân tán hay bể hàng chục tài khoản làm tăng phạm vi trước khi giải quyết được rủi ro chính. Nếu sau này dùng Bloom filter, nó chỉ nên là bộ lọc hỗ trợ vì false positive có thể làm bỏ sót bài; dữ liệu chính vẫn cần khóa định danh chính xác.

**Thử nghiệm quyết định đầu tư phải chạy đến mục tiêu thật, không dừng ở việc lấy được vài chục bài.**

Đề xuất giới hạn công sức xây prototype ở 5–7 ngày công, với một lần kiểm tra nguồn sớm trong 1–2 ngày đầu. Đây là ngân sách kiểm chứng đề xuất, không phải ước lượng đã chứng minh. Thời gian chờ xét duyệt quyền truy cập không nằm trong thời gian lập trình. Nếu không có đường dữ liệu phù hợp, kết luận sớm về giới hạn đó trước khi xây giao diện sản phẩm.

Chọn các bộ từ khóa đại diện cho cách dùng thực tế: một chủ đề rộng, một chủ đề gắn địa phương và một tên thương hiệu cụ thể. Trước khi thử, thống nhất phạm vi chấp nhận và loại nguồn bắt buộc cùng số lượng tối thiểu tương ứng. Nếu chưa chốt cơ cấu nguồn, chỉ được kết luận cho cơ cấu thực thu được, không suy thành đạt toàn bộ phạm vi tài liệu gốc. Nếu thương hiệu hẹp không có đủ bài thì ghi nhận giới hạn nguồn cung, không làm rộng nghĩa âm thầm để đạt chỉ tiêu. Mỗi lần chạy phải bắt đầu từ từ khóa và các nguồn được phép dùng trong sản phẩm, không được chỉ nạp sẵn 1.000 URL rồi chứng minh khả năng lưu chúng.

| Tiêu chí nghiệm thu đề xuất | Cách kiểm tra |
| --- | --- |
| Đúng sản lượng | Ít nhất 1.000 bài duy nhất đạt toàn bộ tiêu chí từ tập thu được trong tối đa 24 giờ, tính cả thời gian chờ, lỗi và can thiệp khi thu thập |
| Đúng chủ đề và phạm vi | Đạt cơ cấu nguồn đã chốt trước khi chạy; tách Page/Group/cá nhân và loại nội dung; không thay yêu cầu bài thảo luận bằng quảng cáo Page |
| Link có giá trị | Permalink trỏ tới đúng bài, không phải trang tìm kiếm/nhóm; ghi bối cảnh truy cập và thời điểm kiểm tra |
| Có thể kiểm toán | Xuất được danh sách bài, nguồn truy vấn và lý do được chấp nhận; không chỉ báo một con số trên giao diện |
| Có thể phục hồi | Dừng/khởi động lại không làm mất tiến độ hoặc nhân đôi dữ liệu |
| Chi phí chấp nhận được | Ghi số tiền thực, phút can thiệp của người vận hành, tài nguyên và chi phí trên 1.000 bài đạt chuẩn |
| Có khả năng lặp lại | Sau lần đầu đạt, thử thêm các lần chạy độc lập với phạm vi tương đương; báo riêng số bài mới so với lịch sử đã lưu |

Đóng băng tập thu được ở giờ thứ 24. Có thể kiểm toán chất lượng sau đó, nhưng không bổ sung bài mới để bù bài bị loại; nếu tập cuối còn dưới 1.000 bài hợp lệ thì không đạt. Đợt đầu nên rà soát toàn bộ tập dùng để chứng minh mốc này. Nếu chỉ đánh giá ngẫu nhiên một mẫu thì chỉ có ước lượng độ chính xác, chưa chứng minh mọi dòng trong 1.000 kết quả đều hợp lệ. Thời gian rà soát thủ công phải được ghi riêng để tránh nhầm prototype có người kiểm tra với sản phẩm tự vận hành.

Ngoài số bài cuối cùng, cần đo số bản ghi thô, số bài mới mỗi giờ, tỷ lệ trùng, tỷ lệ sai chủ đề, số lỗi truy cập, số lần cần thao tác tay và mức đóng góp của từng nguồn. Biểu đồ số bài mới tích lũy có thể cho thấy tìm kiếm đã bão hòa. Không dùng 50 bài trong 10 phút đầu để ngoại suy thẳng thành 7.200 bài/ngày.

Độ bao phủ toàn Facebook không đo được chỉ từ những bài công cụ tự tìm thấy. Có thể tạo một tập bài mẫu do người kiểm tra xác nhận độc lập để phát hiện bỏ sót, nhưng tỷ lệ tìm lại trên tập mẫu này không phải recall trên toàn bộ Facebook.

**Quyết định sau thử nghiệm:** nếu đạt 1.000 bài đúng phạm vi trong 24 giờ với chi phí và mức can thiệp chấp nhận được, có cơ sở phát triển MVP cho đúng phạm vi đã kiểm chứng. Nếu chỉ đạt với Pages, phải xác nhận đó là sản phẩm đáp ứng nhu cầu hay không. Nếu liên tục dừng ở vài trăm bài mới, hoặc không có đường truy cập phù hợp, cần đổi nguồn dữ liệu hay thu hẹp cam kết; tăng số profile không phải bằng chứng giải quyết được vấn đề.

Một lần đạt 1.000 bài cũ chỉ chứng minh khả năng lấy một tập lịch sử. Muốn sau này cung cấp thêm 1.000 bài chưa từng lấy mỗi ngày, cần benchmark khác với loại trùng xuyên nhiều ngày và đánh giá lượng nội dung mới hoặc phần lịch sử còn lại.

**Các sửa đổi ngoài Facebook để tham khảo khi mở rộng:**

| Nội dung | Kết quả kiểm chứng |
| --- | --- |
| Threads chỉ nên dùng API nội bộ | Có [Keyword Search API chính thức](https://developers.facebook.com/docs/threads/keyword-search/), cần quyền được xét duyệt. Nên đánh giá đường chính thức trước. |
| MediaCrawler hỗ trợ TikTok quốc tế/Facebook | Danh sách [nền tảng hỗ trợ](https://github.com/NanmiCoder/MediaCrawler) có Douyin, không đồng nhất với TikTok quốc tế. [LICENSE](https://github.com/NanmiCoder/MediaCrawler/blob/main/LICENSE) hiện hạn chế thương mại và large-scale crawling; cần kiểm tra quyền trước khi tái sử dụng code. |
| TikTok-Api có sẵn video keyword search hoạt động | [Source search.py](https://github.com/davidteather/TikTok-Api/blob/main/TikTokApi/api/search.py) ghi chỉ hỗ trợ tìm users trong luồng đó. Cần thử nghiệm riêng cho video, không suy từ tên thư viện. |
| pytrends là nguồn được bảo trì ổn định | [Repository](https://github.com/GeneralMills/pytrends) đã archive ngày 17/4/2025. |
| TikTok Research API phù hợp cho sản phẩm thương mại | [FAQ chính thức](https://developers.tiktok.com/docs/en/research-api-faq) loại trừ commercial users khỏi điều kiện dùng Research Tools. [Display API](https://developers.tiktok.com/docs/en/display-api-overview) không phải global keyword search. |
| X nhất thiết phải dùng API không chính thức | Có [Search Posts chính thức](https://docs.x.com/x-api/posts/search/introduction) và [mô hình tính phí](https://docs.x.com/x-api/getting-started/pricing). Cần tính phí trên dữ liệu trả về, không chỉ bài cuối cùng giữ lại. |
| Reddit dùng PRAW thì mặc nhiên miễn phí cho thương mại | Client library không cấp quyền dữ liệu; xem [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) và [Data API Terms](https://redditinc.com/policies/data-api-terms). |
| YouTube có thể dùng quota truyền miệng để dự toán | Dùng [bảng quota hiện hành](https://developers.google.com/youtube/data/determine_quota_cost) và [search.list](https://developers.google.com/youtube/data/reference/rest/v3/search/list), đồng thời phân biệt số kết quả trả về với video duy nhất phù hợp. |

