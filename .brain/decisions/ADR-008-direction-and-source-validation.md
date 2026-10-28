# ADR-008 — Hướng triển khai CSD và cách đánh giá nguồn

Ngày: 2026-10-27, Asia/Bangkok.

Phạm vi: làm rõ hướng đang triển khai và bổ sung lựa chọn đã bị trình bày thiếu trong nghiên cứu ban đầu. Đây không phải quyết định chuyển CSD sang dịch vụ trả phí hoặc bằng chứng rằng một route đã chạy được. Trạng thái task/owner/gate tiếp tục lấy từ [master plan](C:/OwnProject/crawl-socials/.brain/master_plan.md).

## Kết luận để Agent tiếp tục công việc

**Giữ hướng CSD desktop bằng Electron đang triển khai. Hoàn thành bộ khung tối thiểu, ưu tiên kiểm chứng nguồn Facebook sớm, chưa xây sâu sản phẩm trước bằng chứng nguồn thật. Dịch vụ bên ngoài là phương án đối chiếu hoặc thay thế có điều kiện; chưa được chọn làm dependency của CSD.**

Không tạo lại dự án, không bỏ công việc P00/P01, không thay runtime đã chốt tại ADR-001 và không bắt người dùng lựa chọn lại toàn bộ kiến trúc. Giao diện, campaign, identity/dedup, lưu trữ và export của CSD vẫn cần thiết dù sau này nguồn là browser, API phù hợp hay nhà cung cấp.

## Bối cảnh phải lưu lại

Nghiên cứu ban đầu đã đi quá sâu vào cách tự xây crawler trước khi trình bày rõ lựa chọn tự xây so với dùng dịch vụ có sẵn. Việc nhắc đến dịch vụ sau khi Agent bắt đầu triển khai khiến người dùng không biết hướng nào đang được theo đuổi. Đây là thiếu sót của tư vấn, không phải một thay đổi yêu cầu từ người dùng.

Thông tin người dùng đã trả lời:

- Có tài khoản Facebook cá nhân thông thường.
- Chưa có Meta app/API được cấp quyền hoặc chấp thuận riêng từ Meta cho automation.
- CSD cần bài công khai về quán cà phê, đủ Page/nhóm công khai/trang cá nhân công khai, tối thiểu 1.000 bài không trùng trong một lần chạy tối đa 24 giờ; được lấy bài cũ.
- Hướng mở rộng sau MVP là dùng các tài khoản của người dùng để thu trong nhóm đã tham gia, gồm nhóm riêng tư, theo P11.04–P11.08.

Không hỏi lại người dùng câu “bạn đã có Meta app/quyền API chưa?” khi chưa có tình tiết mới. Việc có tài khoản do người dùng cho biết chưa chứng minh phiên đăng nhập, khả năng đọc nguồn hoặc khả năng thu tự động đã được kiểm tra trực tiếp.

## Vai trò của từng lựa chọn

| Lựa chọn | Vai trò trong CSD hiện tại | Giới hạn cần giữ rõ |
| --- | --- | --- |
| Browser qua Electron | Hướng kỹ thuật ưu tiên để nghiên cứu với hạ tầng và tài khoản người dùng đang có | Chưa có benchmark thật; quyền đọc, điều kiện thu tự động, độ bao phủ và độ ổn định cần được đánh giá riêng |
| Meta API chính thức | Route bổ sung nếu có API/quyền đúng với nguồn cần lấy | Không mặc định tạo app là có khả năng tìm mọi bài Facebook; người dùng hiện không có quyền API đã được cấp |
| Dịch vụ thu thập bên ngoài | Phương án đối chiếu hoặc thay thế khi có bằng chứng và ngân sách phù hợp | Chưa chạy thử, chưa mua, chưa được chọn; API của nhà cung cấp không phải Meta API |
| Search engine/index | Nguồn discovery phụ trợ nếu giúp tìm bài/seed | Không dùng để cam kết đầy đủ nguồn hoặc tự suy đủ 1.000 bài |

Không có lựa chọn nào ở đây đã chứng minh đạt workload của CSD. Không mô tả marketing, mức giá cho 1.000 records hoặc thông số request thành bảo đảm 1.000 bài đúng chủ đề, đủ ba loại nguồn.

Meta Page Public Content Access phục vụ nội dung Pages theo quyền/use case được duyệt; Groups API cũ bị gỡ từ 22/4/2024. Vì vậy, không đặt việc xin Meta API làm con đường chính mặc định cho toàn bộ yêu cầu Facebook của CSD. [Page Public Content Access](https://developers.facebook.com/docs/features-reference/page-public-content-access/), [Groups API changelog](https://developers.facebook.com/docs/graph-api/changelog/version19.0/).

Hai ví dụ để biết phương án nhà cung cấp tồn tại: [Apify Facebook Search Scraper](https://apify.com/apify/facebook-search-scraper/input-schema) có lựa chọn tìm posts theo keyword; [Bright Data Facebook Scraper](https://brightdata.com/products/web-scraper/facebook) liệt kê các công cụ lấy bài theo URL nhóm/Page. Đây là năng lực nhà cung cấp mô tả, chưa được thử với workload cà phê của CSD. Không suy chúng hỗ trợ nhóm riêng tư, có đủ dữ liệu Việt Nam, đủ cả ba nguồn hoặc được Meta cấp quyền chỉ từ việc họ cung cấp API.

## P00.02 phải kết luận điều gì

P00.02 là nhiệm vụ xác định nguồn và giới hạn, không phải nhiệm vụ bắt người dùng phải có Meta app. Agent đang sở hữu task này tiếp tục ghi source matrix và ADR-002; ADR-008 không thay thế các đầu ra đó hoặc tự đánh dấu task/gate hoàn thành.

Tách các trục đánh giá sau trong source matrix, thay vì gộp hết vào một cột “có quyền/không có quyền”:

| Trục | Câu hỏi phải trả lời | Hiện trạng đã biết |
| --- | --- | --- |
| Tài khoản/phiên | Có account và phiên người dùng cho phép CSD sử dụng không? | Người dùng cho biết có account cá nhân; chưa kiểm phiên thật |
| Khả năng kỹ thuật | Route có đọc/search/phân trang dữ liệu đúng loại nguồn không? | Browser và nhà cung cấp chưa được CSD kiểm chứng bằng live probe |
| Quyền và điều kiện sử dụng | Đã có quyền API, chấp thuận automation hoặc điều kiện nguồn nào? | Người dùng chưa có quyền/chấp thuận riêng đã nêu; không ghi thành đã được phép |
| Phù hợp sản phẩm | Dữ liệu có đủ chủ đề, ba loại nguồn, số lượng, chi phí và độ bền không? | Chưa có benchmark |

Thiếu Meta API không đủ để kết luận browser không thể đọc dữ liệu về mặt kỹ thuật. Ngược lại, đọc được bằng browser không chứng minh được phép tự động thu hoặc đáp ứng sản phẩm. Báo cáo phải giữ cả hai sự thật, không dùng cái này thay cho cái kia.

**P00.02 có thể DONE khi source matrix, bằng chứng và giới hạn đã được ghi đầy đủ, kể cả kết luận một route chưa sẵn sàng.** DONE của công việc phân tích không làm G00/G01 PASS. Nếu chưa đủ điều kiện chạy live, ghi rõ thiếu điều kiện nào và phạm vi công việc bị ảnh hưởng; không chỉ trả lại câu “cần Meta API” rồi để dự án đứng yên.

Không thêm yêu cầu Meta app/chấp thuận automation như điều kiện để hoàn thành phân tích P00.02 hoặc dựng khung offline P01.01. Việc chạy live vẫn phải đối chiếu điều kiện của route cụ thể; tài liệu này không tự cấp quyền nguồn hoặc bỏ qua gate hiện hành.

## Thứ tự làm việc ngay tiếp theo

1. **P00.02:** hoàn thành đánh giá theo hiện trạng người dùng đã cung cấp; route browser là hướng ưu tiên khảo sát, Meta API không mặc định sẵn có, vendor chỉ là phương án phụ chưa thử.
2. **P01.01:** tiếp tục bộ khung offline tối thiểu theo ADR-001, giữ ranh giới adapter để không khóa nghiệp vụ vào một nguồn. Không đổi sang xây tích hợp nhà cung cấp trong task này.
3. **P00.04 và chuẩn bị P02.02:** xác định phép thử nguồn nhỏ, đầu vào, giới hạn và điều kiện thực thi. Probe nhằm biết có đọc được bài, phân trang được và loại nguồn nào hoạt động; không cần dựng xong toàn bộ app.
4. **Khi đủ điều kiện thử nguồn:** làm P02.02, đưa bằng chứng vào P02.04/G01. Nếu chưa đủ điều kiện, công bố đúng trở ngại và lựa chọn giải quyết; không dành thời gian xây UI đầy đủ để thay cho tiến triển nguồn dữ liệu.
5. **Sau khi có luồng thật:** hoàn thiện pipeline cần thiết để thử G02 — 1.000 bài/24 giờ. Chỉ mở rộng sản phẩm theo những gate đã đạt.

Phần offline đang làm có thể tiếp tục. Tuy nhiên, framework, tests hoặc packaging chạy được không phải lý do để đầu tư vô hạn khi nguồn chưa kiểm chứng.

## Khi nào xem xét dịch vụ bên ngoài

Không thêm nhà cung cấp như một phase bắt buộc mới hoặc tự chuyển dự án sang paid API. Đánh giá phương án này khi cần đối chứng nhanh, khi probe Electron bộc lộ giới hạn hoặc khi lợi ích giảm công bảo trì có thể đo được.

Một so sánh có giá trị phải dùng cùng workload: keyword, loại nguồn, historical window, unique/relevance và permalink verification. Báo riêng dữ liệu Page/Group/cá nhân, số hợp lệ sau lọc, chi phí thực và dữ liệu còn thiếu. Nếu nhà cung cấp chỉ đạt Pages thì không được gọi là đã thay thế toàn bộ crawler CSD.

Việc nhà cung cấp có thể tốt hơn vẫn là giả thuyết cho tới khi có kết quả thật. Không đăng ký/mua dịch vụ, gửi credentials Facebook hoặc đưa dữ liệu nhóm riêng tư ra bên ngoài chỉ vì nó được nhắc trong tài liệu này.

Muốn đổi route chính: ghi kết quả so sánh, tác động chi phí/phạm vi/quyền dữ liệu và công việc tái sử dụng được vào ADR-002 hoặc ADR thay thế. Không âm thầm đổi hướng; không yêu cầu người dùng chọn lại từ đầu khi chưa có đề xuất cụ thể.

## Những điều chưa được chứng minh

- Browser qua Electron đạt 1.000 bài hợp lệ trong 24 giờ.
- Dịch vụ bên ngoài đạt đúng workload với chi phí thấp hơn tự xây.
- Có thể tự động thu mọi nhóm mà tài khoản đã tham gia.
- Một route kỹ thuật hoạt động đồng nghĩa có đầy đủ quyền dùng dữ liệu hoặc hoạt động bền vững.

Đây là các câu hỏi cần bằng chứng, không phải lời hứa sản phẩm. Các phát hiện quan trọng tiếp theo phải được ghi vào `.brain` và liên kết từ master plan; không để quyết định kiến trúc chỉ tồn tại trong chat.
