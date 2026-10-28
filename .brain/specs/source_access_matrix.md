# Ma trận nguồn và đường truy cập Facebook — 1.0.0

Ngày kiểm tra: 2026-10-27, Asia/Bangkok. Task P00.02; workload [quán cà phê](campaign.coffee.json), [contract công khai 1.0.0](product_contract.md). Task/gate hiện hành chỉ nằm trong [master plan](../master_plan.md). Quyết định route: [ADR-002](../decisions/ADR-002-facebook-source-route.md).

Áp dụng [ADR-008](../decisions/ADR-008-direction-and-source-validation.md) vừa được bổ sung trong master plan: giữ Electron, không đổi sang vendor, phân biệt session/capability/quyền/product fit. Không yêu cầu người dùng phải có Meta app để hoàn thành phân tích này hoặc bootstrap offline; thiếu API grant không chứng minh browser bất khả thi về kỹ thuật.

## 1. Hiện trạng truy cập đã được người dùng xác nhận

Trong phiên P00.02, người dùng xác nhận chỉ có tài khoản Facebook cá nhân thông thường, chưa có Meta app/API được cấp quyền và chưa có chấp thuận riêng cho automation. Người dùng chọn nghiên cứu thu qua trình duyệt Electron, yêu cầu ghi đó là route dự kiến chưa xác minh quyền thu tự động/khả năng vận hành, và tiếp tục phần offline. Không yêu cầu hoặc tiếp nhận cookie/token/mật khẩu.

Không có Facebook connector trong các tool hiện có; nguồn CSD chưa có vault/session đăng nhập. Không mở hoặc mượn profile HotMatch, không kiểm tra kho cookie của trình duyệt khác. Chưa có Page quản lý, app ID, permission grant, tổ chức nghiên cứu hoặc hợp đồng nhà cung cấp được khai báo. Không suy “chưa khai báo” thành “người dùng không sở hữu”.

**Không có route AVAILABLE cho CSD trong đợt này.** Browser là hướng nghiên cứu đã được chọn, chưa là nguồn vận hành được xác nhận. Việc có thể xem bài công khai bằng tài khoản thường không tự giải quyết điều kiện thu tự động; Meta mô tả sự phân biệt đó trong [How We Combat Scraping](https://about.fb.com/news/2021/04/how-we-combat-scraping/amp/). Đây là ghi nhận điều kiện nguồn, không là kết luận về quyền pháp lý của người dùng.

## 2. Ý nghĩa trạng thái

| Trạng thái route tại CSD | Cách dùng |
| --- | --- |
| AVAILABLE | Có bằng chứng về quyền/phạm vi và khả năng truy cập cần dùng; không chỉ có tên API hoặc tài khoản |
| PENDING | Đã có bước cấp quyền/thiết lập cụ thể đang chờ, có tham chiếu; không dùng khi chưa hề đăng ký |
| UNAVAILABLE | CSD hiện không có quyền/cơ chế cần cho route, hoặc route lịch sử đã bị loại khỏi thiết kế |
| UNKNOWN | Chưa xác minh được capability/quyền/điều kiện để kết luận route dùng được |

Trạng thái mô tả CSD hiện tại, không đánh giá mọi người dùng Facebook. `UNAVAILABLE` vì chưa có API grant có thể đổi khi có grant; không có nghĩa API toàn nền tảng bị ngừng. Không đánh dấu PENDING để ngụ ý đã nộp đơn hoặc đăng nhập khi chưa làm.

## 3. Ma trận route và nguồn

| Route ID / cơ chế | Page | Public Group | Public personal timeline | Quyền/đầu vào thực tế ở CSD | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| FB_BROWSER_PUBLIC_SEARCH — Facebook UI trong session Electron riêng | Ứng viên có thể xuất hiện trong search hoặc nguồn; chưa thử | Ứng viên nhóm công khai; chưa thử search/continuation | Ứng viên bài cá nhân công khai; chưa biết phạm vi UI thực trả | Có tài khoản thường theo người dùng; chưa có session CSD, chưa xác minh quyền thu tự động | **UNKNOWN — route nghiên cứu ưu tiên** |
| FB_API_MANAGED_PAGE — Pages API cho Page được quản lý/ủy quyền | Chỉ đúng Page và permission/token phù hợp; không mặc định mọi Page | Không chứng minh Group | Không chứng minh personal | Chưa có Meta app/API grant; Page cụ thể/quyền quản lý chưa khai báo | **UNAVAILABLE tại CSD** |
| FB_API_PUBLIC_PAGE_CONTENT — PPCA cho public Page content | Capability ứng viên theo feature đã được xét; chưa xác minh grant/phiên bản hiện hành | Không suy thành quyền Group | Không suy thành quyền personal | Chưa có app/PPCA grant | **UNAVAILABLE tại CSD** |
| FB_API_PAGE_SEARCH — tìm Page làm seed | Khám phá Page, không tự là post keyword search | Không là Group post search | Không là personal post search | Chưa có app/token/features phù hợp; chưa gọi endpoint | **UNAVAILABLE tại CSD** |
| FB_API_LEGACY_GROUPS — Groups API cũ | Không áp dụng | Thiết kế cũ đã bị loại theo changelog v19/nền nghiên cứu; không thiết kế dựa vào endpoint này | Không áp dụng | Không có grant; docs v19 hiện không đọc lại được vì 429 | **UNAVAILABLE trong thiết kế CSD** |
| FB_API_USER_POSTS — dữ liệu user được cấp quyền | Không thay Pages API | Không là global Group search | Không suy quyền đọc mọi public timeline từ một user grant | Chưa có app/user permission; chưa kiểm docs hiện hành | **UNAVAILABLE tại CSD** |
| META_CONTENT_LIBRARY — UI/API nghiên cứu có kiểm soát | Nguồn nghiên cứu tiềm năng | Nguồn nghiên cứu tiềm năng | Không mặc định bao phủ mọi tài khoản cá nhân/bài công khai | Chưa có tài khoản nghiên cứu/grant, điều kiện mục đích O06 chưa chốt | **UNAVAILABLE tại CSD; eligibility/capability cụ thể UNKNOWN** |
| WEB_SEARCH_SUPPLEMENT — nhà cung cấp search được chọn riêng | Chỉ URL/snippet được index | Có thể tìm URL được index, không bảo đảm | Có thể tìm URL được index, không bảo đảm | Chưa chọn nhà cung cấp/credential/quota/điều kiện dùng | **UNKNOWN; chỉ bổ sung discovery** |
| VENDOR_REFERENCE — dịch vụ dữ liệu ngoài, chỉ phương án đối chiếu có điều kiện | Chưa thử | Chưa thử | Chưa thử | Chưa chọn/đăng ký/mua hoặc gửi credentials; API vendor không là Meta API grant | **UNKNOWN; không là dependency của CSD** |

Các mô tả API là ranh giới thiết kế dựa trên tài liệu nền và URL chính thức, **không phải xác nhận toàn bộ feature/permission còn nguyên ở phiên bản Graph API mới nhất**. Phiên bản API cho CSD chưa được chọn; cần đọc được docs version cụ thể và kiểm grant trước adapter/live probe. Chỉ browser route là hướng người dùng yêu cầu nghiên cứu; chưa xây đồng thời mọi route.

`source_type` theo bối cảnh xuất bản. Page đăng trong Group được tính PUBLIC_GROUP; tác giả là Page không làm tăng Page quota. Cả ba loại phải có ít nhất một bài hợp lệ, báo riêng; 1.000 Pages không thay được yêu cầu đó. Các route khác nhau có thể thấy cùng identity, không cộng lại số unique.

### Bốn trục đánh giá độc lập

| Nhóm route | Tài khoản / phiên | Khả năng kỹ thuật | Quyền / điều kiện sử dụng | Phù hợp sản phẩm |
| --- | --- | --- | --- | --- |
| Browser Electron | Account cá nhân do người dùng cho biết; chưa login session CSD | Chưa thử đọc/search/paging hoặc đủ ba nguồn; không kết luận bất khả thi chỉ vì thiếu API | Chưa có chấp thuận riêng theo người dùng; điều kiện thu tự động cho route/use case chưa được xác minh | Chưa có G01/G02, chưa biết yield/chi phí/can thiệp |
| API Page/PPCA/Page Search/User Posts | Không có Meta app/API grant được cấp; không kiểm token | Endpoint/version/capability cụ thể chưa thử; ranh giới Page không được suy sang Group/personal | Chưa có grant, không gọi API để giả lập kiểm quyền | Chưa giải quyết cả ba nguồn, chưa benchmark |
| Legacy Groups API | Không có phiên/grant CSD cho route cũ | Đã loại khỏi thiết kế theo nghiên cứu; docs hiện fetch lỗi | Không suy admin nhóm hoặc account thường thành khôi phục quyền API | Không dùng để lập cam kết MVP |
| Content Library | Chưa có tài khoản/grant nghiên cứu | Chưa thử API/UI và scope personal/history hiện hành | Eligibility, mục đích O06, lưu/xuất chưa xác minh | Chưa benchmark hoặc đối chiếu workload |
| Web search | Chưa chọn session/API provider | Chỉ là candidate discovery, chưa tích hợp search | Điều kiện dùng/quota provider chưa xác minh; không cấp quyền Facebook | Không có bằng chứng đủ nội dung/context/ba nguồn |
| Vendor tham khảo | Chưa có tài khoản/API key/đăng ký | Chưa thử với campaign quán cà phê | Điều kiện nguồn và quyền dùng data chưa xác minh; không tự gửi account Facebook ra ngoài | Chưa biết valid yield/cost; không mặc định thay thế Electron |

## 4. Capability, quota, lịch sử và khoảng trống bằng chứng

| Route | Search/filter/pagination | Lịch sử bài và trường dữ liệu | Quota/chi phí/can thiệp | Phải xác minh trước khi dùng |
| --- | --- | --- | --- | --- |
| Browser ưu tiên | Keyword qua UI; filter Page/Group/personal, địa phương, ngày và continuation đều chưa thử. Không tạo cursor/filter chỉ vì planner muốn | Không có cam kết lịch sử đủ sâu hoặc đủ 1.000; ID/permalink/text/source/publicity/published_at còn chưa có mẫu thật. Không dùng ngày index thay ngày đăng | Không có quota được cấp; không đặt “an toàn X request/phút”. Login/challenge/rate limit và phút can thiệp phải đo; không giải CAPTCHA hay đổi tài khoản để tiếp tục | Phạm vi/điều kiện thu tự động, session độc lập, public context, query nhỏ, trường đủ contract, điểm dừng và lỗi khác end-of-results |
| API Page/PPCA/search | Chỉ bật endpoint/filter/cursor được version/grant hỗ trợ; Page search chỉ tạo seeds | Trường/history tùy endpoint/permission; không suy công suất từ danh sách field | Chưa có token/quota/cost; đọc rate-limit headers theo endpoint khi được cấp, retry hữu hạn | Page cụ thể, token type và grant có hiệu lực, app review/feature cần thiết, API version/use case, storage/export conditions |
| Legacy Groups API | Không xây adapter legacy | Không có bằng chứng route hoạt động | Không áp dự toán cũ | Chỉ xem lại nếu có tài liệu chính thức mới về route khác đáp ứng nguồn; không coi cấp admin nhóm là phục hồi API cũ |
| User posts API | Không giả định global keyword search public posts | Chưa xác minh phạm vi user được ủy quyền và trường được cấp | Chưa có grant/quota | Docs và permission thật; user grant không tự bao phủ mọi tài khoản |
| Content Library | Công cụ nghiên cứu có search/filter; chi tiết current API chưa xác minh | Public content theo eligibility, product scope và môi trường nghiên cứu; không mặc định cho sản phẩm thương mại hoặc export tùy ý | Chưa có cấp quyền/giới hạn môi trường; không dự toán theo API thông thường | Đủ điều kiện/mục đích, quyền cấp thực tế, loại personal được bao phủ, lưu/xuất trong môi trường cho phép |
| Web search bổ sung | Provider-specific search/paging; chưa chọn API | Index thiếu/trễ; snippet không đủ để tính valid nếu thiếu text/context. Không biết recall toàn Facebook | Chưa có API/quota/ngân sách; không tự mua dịch vụ | Quyền dùng provider, quota, schema URL, xác minh bài qua route phù hợp, provenance LIVE theo contract |
| Vendor tham khảo | Không chọn endpoint/capability trước khi có nhu cầu đối chứng cụ thể | Chưa có mẫu hoặc coverage Page/Group/personal; marketing records không là valid posts | Chưa có ngân sách/đăng ký; không tự chi tiền | So sánh cùng workload/source mix/identity/relevance nếu được chọn về sau; không mua/tích hợp trong P00.02/P01.01 |

[Meta mô tả Content Library](https://about.fb.com/news/2023/11/new-tools-to-support-independent-research/) là công cụ cho nghiên cứu đủ điều kiện và có quy trình tiếp cận qua đối tác nghiên cứu. Trang đọc được là thông báo có các cập nhật tới 2024, không thay grant hoặc tài liệu vận hành 2026. [Google về site:](https://developers.google.com/search/docs/monitor-debug/search-operators/all-search-site) xác nhận kết quả không bảo đảm liệt kê hết URL được index; không dùng số kết quả search làm sản lượng hoặc độ bao phủ Facebook.

## 5. Route ưu tiên và điều kiện thử cụ thể

Chọn **FB_BROWSER_PUBLIC_SEARCH** làm hướng nghiên cứu thứ nhất theo yêu cầu người dùng. Khi đủ điều kiện, dùng CSD/Electron partition mới, người dùng tự đăng nhập; bắt đầu từ query `cafe Hà Nội` và các từ khóa quán cà phê trong campaign, quan sát kết quả qua UI Facebook thực. Đường dẫn search nếu được UI hỗ trợ sẽ được ghi từ navigation thực, không hardcode endpoint GraphQL/request replay chưa được xác minh.

Phép thử đầu tiên dự kiến ở P02.02, không chạy trong P00.02/P01.01:

1. Làm rõ điều kiện/quyền thu tự động cho use case cùng phạm vi nguồn công khai; ghi tham chiếu cấp quyền/điều kiện, không ghi secret. Việc người dùng muốn nghiên cứu browser chưa được gọi là chấp thuận từ Meta.
2. P00.04 có protocol/ngân sách/stop conditions, G00 được đánh giá trên nguồn thực sự phù hợp để thử. O06 về mục đích/lưu/xuất được xử lý trước dữ liệu thật.
3. CSD có session host thử độc lập và khả năng redaction phù hợp; không mượn HotMatch. P01.01 hiện chỉ bootstrap offline, chưa có session Facebook.
4. Thử một query nhỏ rồi theo continuation nếu UI có; ghi loại nguồn, trường có/thiếu, auth/rate-limit/parse failures, điểm dừng và thao tác tay. Giới hạn cụ thể do protocol quyết định, không suy công suất 24h.
5. Xác minh source context/publicity của mẫu. Nếu mới thấy Page, chỉ kết luận route tiếp cận được Page; chưa chứng minh Group/personal hoặc toàn source mix.

Nếu browser không có điều kiện phù hợp, ghi rõ hạn chế và xem lại route/API/scope với decision/version mới; không tự chuyển campaign thành Pages-only. API Page có thể được xem xét nếu sau này có grant/nguồn cụ thể, nhưng không thay nguồn nghiệm thu còn thiếu.

## 6. Kiểm chứng tài liệu và kết luận

[Evidence nguồn](../evidence/p00-source-access-2026-10-27.json) lưu URL, thời điểm theo ngày, loại kết quả đọc và giới hạn. Đợt này:

- Đọc được thông báo chính thức Meta về scraping và Content Library; đọc được Google Search Central về giới hạn site:.
- Meta Developers cho changelog v19, PPCA, Pages Search/Posts, Content Library access, user posts và rate limiting trả HTTP 429 qua công cụ đọc. Transparency Center cũng trả 429. Không suy lỗi fetch tài liệu thành tài khoản Facebook người dùng bị block hoặc API dữ liệu không tồn tại.
- Automated Data Collection Terms chuyển tới login/temporary-block page trong công cụ đọc; **không đọc được nội dung điều khoản hiện hành**. Không dùng màn hình đó làm bằng chứng đã chấp nhận điều khoản.
- Search giới hạn domain chính thức không cung cấp excerpt đủ để thay các trang API bị lỗi; không dùng blog bên thứ ba làm bằng chứng cập nhật permission/quota.

P00.02 có thể hoàn thành với ma trận phản ánh unknown và route ưu tiên có điều kiện. **G00 chưa PASS**: chưa có nguồn AVAILABLE và P00.04 chưa chốt protocol/ngân sách. O03 được làm rõ hiện trạng nhưng chưa được giải quyết thành quyền/khả năng truy cập sẵn sàng; vẫn nằm trong `open_questions` của campaign. P01.01 và các nhánh offline không phụ thuộc gate được tiếp tục.
