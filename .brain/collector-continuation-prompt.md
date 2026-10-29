> **LỊCH SỬ — đã được thay từ 29/10/2026.** Người dùng chọn `codex/csd-production` để phát triển CSD dùng thật. Đọc [ADR-021](decisions/ADR-021-production-branch.md) và phần Hiện hành 2.0 của [master plan](master_plan.md). Prompt/dispatch/gate thử nghiệm bên dưới không còn là chỉ dẫn thực thi; không tự chạy lại.

# Prompt tiếp tục CSD từ dữ liệu thật đã thu được

> Người dùng gửi toàn bộ nội dung dưới đây hoặc yêu cầu agent đọc và thực hiện file này. Việc lưu file tự nó không khởi động worker, automation hay chạy Facebook.

Bạn tiếp quản CSD — Crawl Socials Data tại `C:/OwnProject/crawl-socials`. Tôi giao bạn **phát triển tiếp thành bộ thu Facebook chạy bằng code và lưu được dữ liệu thật**, dựa trên kết quả nhánh vừa thử. Hãy tự suy luận, chọn cách triển khai, sửa lỗi và kiểm chứng đến đầu ra sử dụng được. Đừng chỉ viết phương án rồi dừng, cũng đừng xem một chiến thuật do agent trước đề xuất là yêu cầu bất di bất dịch.

## Mục tiêu và quyền làm việc

- Đầu ra tôi cần: **link bài Facebook và thông tin hữu ích** — nội dung/snippet, nguồn PAGE/GROUP/PROFILE/UNKNOWN, trạng thái PUBLIC/PRIVATE/UNKNOWN tách riêng, ngày đăng, tổng reactions, love, bình luận, chia sẻ nếu đọc được. Thiếu trường thì null kèm lý do; không bỏ một link có giá trị chỉ vì thiếu tim hoặc ngày chính xác.
- Workload: quán café, quán nào ngon, địa điểm coffee, hẹn hò café, café Hà Nội, Tiny Café và các thương hiệu khác, sự kiện ở quán. Không chỉ quanh một query. Tuyển dụng/sang nhượng liên quan café có thể lưu và đánh dấu loại/relevance; không tự loại sạch nếu chưa có lý do.
- Đích năng lực vẫn là **1.000 bài Facebook công khai, hợp lệ, không trùng trong tối đa 24 giờ thu thập; được lấy bài cũ**. Cần chứng minh độ phủ Page, nhóm công khai và trang cá nhân công khai; TikTok không bù chỉ tiêu. Chỉ kết luận đạt khi có số liệu thật, không ngoại suy từ 5 bài.
- Tôi cho phép bạn tiếp tục chạy đọc dữ liệu Facebook bằng tài khoản/phiên đã cấp và sửa code trong phạm vi này. Ưu tiên profile Electron đã đăng nhập; nếu thật sự cần, tài khoản nằm trong `.env` và đã được cho phép sử dụng. Không hỏi lại các câu đã chốt về login, search có bài hoặc Meta API. Không in/copy secrets vào chat, log, Git hay tài liệu.
- Phạm vi mới này thay giới hạn đã hết hiệu lực của đợt thử trước: **không còn bị buộc dừng sau đúng 2 search, 2 scroll, 5 continuation hoặc tổng 60 phút**. Dùng giới hạn vận hành hữu hạn, có kiểm soát, dựa trên trạng thái tài khoản và tiến bộ dữ liệu; không bỏ hết giới hạn hay retry vô hạn. Đây không phải tuyên bố Meta đã cấp quyền nền tảng; trạng thái đó vẫn UNKNOWN.
- Không tự mua dịch vụ/proxy, đổi tài khoản để vượt chặn, push/publish, hoặc bật lại hai worker/heartbeat cũ. Gặp challenge, checkpoint, access denied hoặc rate limit thật thì dừng run tương ứng, giữ evidence và xử lý phần độc lập; không bypass. Lỗi parser/observer/scroll của CSD không tự coi là lỗi chặn từ Facebook.

## Đọc để định vị, không đọc cả lịch sử trước khi bắt đầu

Đọc theo thứ tự:

1. `.brain/evidence/branch-request-pagination-result.md`.
2. `.brain/evidence/lead-branch-result-review-2026-10-28.md`.
3. `.brain/evidence/embedded-link-first-followup-2026-10-28.md`.
4. Phần hiện trạng và yêu cầu liên quan trong `.brain/README.md`, `.brain/master_plan.md`, rồi code cần dùng. `.brain/branch_plan.md` là thiết kế của phép thử đã kết thúc, không còn là toàn bộ contract công việc mới.

Các dispatch v25/v26 và số 11/40 task trong tài liệu là lịch sử. Không phục hồi vòng sửa CSS/ARIA/style của timestamp. Ghi một quyết định cập nhật phạm vi ngắn nếu cần để agent sau không áp lại giới hạn cũ; không dựng thêm một hệ thống kế hoạch/gate cạnh tranh.

## Điểm xuất phát đã có bằng chứng

Đã có **5 bài thật, 5 URL và ID khác nhau**, trích từ application/json nhúng của trang search, nằm ngoài Git:

`C:/Users/Admin/AppData/Roaming/csd-desktop/data/request-experiment-20261028/posts-reviewed.jsonl`

Cùng thư mục có projection và snapshot kiểm chứng. SHA-256 dataset:
`f4dd99c0c5ecab24678dd6fa78d904a767a20f5e59e5f27963dffaaddc6c4623`.

- 2 PAGE, 3 GROUP, 0 PROFILE; có PUBLIC metadata, ngày đăng và các tổng counter. 2 bài được review relevance ACCEPT; 3 UNVERIFIED. Không phải 5 bài benchmark đã hoàn tất.
- Schema đã quan sát: `data.serpResponse.results.edges[].rendering_strategy.view_model.click_model.story`.
- 5 tiền tố nội dung khớp snapshot sau chuẩn hóa; chưa xác minh toàn văn hoặc reopen từng permalink. Raw response nguyên gốc không được giữ, nên projection không phải raw payload replay.
- **Chưa có batch kế tiếp**, chưa tìm được operation phân trang bài có thể gửi tiếp. Operation `CometSearchBootstrapKeywordsDataSourceQuery` đã thấy là keyword bootstrap; đừng nhầm `first=2000` của nó thành lấy 2.000 bài.
- Có cursor và has_next_page trong JSON nhúng, nhưng chưa chứng minh dùng được với transport nào.
- Có pure parser trên `experiment/facebook-embedded-link-first`, file `src/infrastructure/browser/facebook-search-embedded-parser.ts`, với 5 test offline. Chưa nối app, chưa resume, chưa collector nhiều batch; PROFILE chưa hỗ trợ có bằng chứng.

Git tại bàn giao: main `7bbc231`; baseline `46e7d20b8befc90b2530de54dd86fd09ae693058`; nhánh request ở `b273bc2a5aedc46cd68f34c5c3a5df18dfa16f90`; nhánh parser ở `89c844f1ffccea26fa567513ec6b61f96b3a1b55`. Luôn kiểm lại trạng thái thật trước thay đổi vì có thể có tài liệu mới chưa commit.

## Tự chọn hướng dựa trên kết quả

Đích là bộ thu sử dụng được, **không phải bằng mọi giá chứng minh request-first**. Tận dụng JSON nhúng đã hoạt động; bạn tự quyết định kết hợp response mạng, request continuation thực, DOM hoặc các query/filter khác để lấy thêm dữ liệu. So sánh bằng số bài mới đúng chủ đề, độ đầy đủ, độ ổn định và chi phí chạy. Không hứa một hướng tối ưu khi chưa đo.

Nếu cần UI để kích hoạt tải thêm, cho **code trong worker Electron tự điều khiển**, đọc và ghi tự động. Một bộ thu dùng browser tự cuộn vẫn là bộ thu tự động; vấn đề cần tránh là AI liên tục dùng desktop để search/thao tác từng lượt. Computer use chỉ dùng khi giúp chẩn đoán cụ thể, không trở thành vòng thu dữ liệu chính. Chưa có dữ liệu mới thì đừng dành cả lượt cho dashboard, nhiều account, queue phân tán hay kiến trúc tổng quát.

Các manh mối để điều tra, không phải kết luận bắt buộc:

- Host thử trước đặt hidden=true, hai lệnh scrollTo(document.body.scrollHeight) đều dừng cùng đáy; có UnknownVizError. Kiểm đúng phần tử cuộn, trạng thái render/visibility, tín hiệu load-more và kết quả sau thao tác. Đừng đoán rằng hai lệnh đã kiểm hết khả năng phân trang.
- Listener ban đầu lọc operation theo `^Search|^CometSearch`, chỉ lấy inline postData và chỉ xử lý body có request ID đã ghi. Kiểm độ phủ/attach/encoding/MIME trước khi nói không có response. Đã thấy JSON mang MIME text/html.
- Nếu chọn request trực tiếp, xác định operation đọc, biến và continuation từ nguồn quan sát thực, kiểm batch mới có identity mới. Không đoán endpoint/doc_id/cursor và không replay nhầm mutation. Hết source, cursor lặp, parser không hiểu và lỗi tài khoản cần được phân biệt.
- Script thử cũ hardcode ngày bắt đầu/output/query và đóng run bằng receipt; không rerun bằng cách xóa receipt. Làm entry point/config run mới có lifecycle và output riêng, dùng phần code còn giá trị.

Bạn được thay giả thuyết và cách triển khai khi evidence phủ định hướng đang thử. Không sửa từng whitelist trang trí vô tận. Khi một lần thử không tăng dữ liệu, bước sau phải kiểm một nguyên nhân cụ thể hoặc đổi hướng, không chỉ lặp search “cafe Hà Nội”.

## Cách phát triển và tiêu chí nghiệm thu

Tạo một nhánh Git mới, tên do bạn chọn, giữ baseline main khôi phục được. Tích hợp có chọn lọc parser/observer cần thiết; không nhập mù quáng toàn bộ script thí nghiệm vào main. Bảo toàn thay đổi chưa commit của người dùng, `.env`, profile và dataset. Tôi cho phép commit cục bộ phần công việc của bạn; không push. Nếu nhánh chưa đạt, giữ checkpoint/evidence rồi trở lại main an toàn và rebuild đúng main; không reset --hard/clean để xóa công sức. Nếu đã đạt bộ thu sử dụng được và kiểm hồi quy phù hợp, có thể giữ và tích hợp vào main theo mục tiêu ban đầu của tôi, nêu rõ mức nghiệm thu thực tế.

Đi qua các mốc bằng chứng, tự chia công việc vừa đủ:

1. **Thu mới bằng một lệnh/luồng chạy có thể lặp lại:** từ keyword và session, code tự lấy và lưu bài mới ngoài 5 bài cũ. Tách rõ batch mới cùng query khỏi bài đến từ query khác; không đánh đồng đa query với continuation đã hoạt động.
2. **Pilot có ích:** hướng tới ít nhất 100 bài mới duy nhất qua nhiều query phù hợp, có cả Page/nhóm/profile khi tìm thấy. Ghi phần chưa đạt thật; thiếu một loại nguồn không khiến bỏ dữ liệu đã có. Nếu nguồn không đủ, xác định do query/yield, vòng tải thêm hay parser trước khi chọn cách tiếp.
3. **Vòng sử dụng được:** dừng/khởi động lại không mất kết quả, không tăng count do trùng; ghi dữ liệu theo batch và checkpoint sau persist thành công; có export và lệnh/cách chạy rõ. Dùng JSONL hoặc storage hiện có tùy phù hợp, chưa cần đại tu database.
4. **Đo đích 1.000/24h khi bộ thu đủ ổn định:** lưu thời gian, số raw/unique/public/relevance/source, trường thiếu, lỗi, can thiệp và lý do dừng. Theo dõi tài khoản và yield; không chạy mù đủ 24 giờ chỉ để hết thời gian. Nếu chưa đạt, báo chính xác mức đạt và nút thắt còn lại, không đóng toàn dự án DONE.

Giữ identity dạng string, dedup cả qua restart và nhiều query; phân biệt nguồn đăng với tác giả (Page đăng trong nhóm vẫn là nguồn GROUP); không suy GraphQL User là PROFILE. Số 0 phải là giá trị quan sát, null là thiếu; love không phải tổng reactions. Lưu provenance đủ kiểm, khai báo text truncated/unknown. Lưu ứng viên chưa đủ metadata tách khỏi số bài đã xác minh công khai/hợp lệ; không đợi xác minh mọi trường mới ghi file. Kiểm mẫu representative và dữ liệu bất nhất thay vì mở thủ công từng permalink.

Chạy kiểm đúng phạm vi thay đổi. Tests bảo vệ parser/dedup/lifecycle không thay cho LIVE evidence. Chỉ thêm test khi bảo vệ hành vi quan trọng đã thấy; đừng làm số test, số file hoặc số phiên bản thành thành tích.

## Chủ động đến kết quả, có điểm dừng thật

Không hỏi tôi chọn giữa các chi tiết triển khai thông thường. Khi một hướng kẹt kỹ thuật, hoàn tất chẩn đoán khả thi và thử hướng khác có căn cứ trong phạm vi được giao. Nếu thật sự cần thao tác xác minh tài khoản, quyền/chi phí mới hoặc mọi hướng khả thi đều không tiến bộ, dừng run và báo một vướng mắc cụ thể kèm bằng chứng. Đừng gọi lặp vô hạn là “làm tới cùng”.

Lưu báo cáo tiếp nối vào `.brain/evidence/collector-continuation-result.md`: branch/commit, thay đổi, lệnh chạy, vị trí dataset, số bài mới thực, loại nguồn, phần metadata còn thiếu, khả năng resume, bằng chứng continuation nếu có, giới hạn và quyết định tiếp theo. Không đưa secrets, nội dung cá nhân thô hay full network dump vào Git. Cập nhật vị trí hiện tại trong master plan bằng mức đạt thật, không tuyên bố PASS benchmark từ fixture hoặc từ pilot 100 bài.

Thông báo ngắn khi có dữ liệu mới đáng kể, đổi hướng có lý do, lỗi ảnh hưởng tiến độ hoặc cần tôi thao tác. Kết quả bàn giao cuối phải cho tôi **chạy được hoặc hiểu chính xác vì sao chưa chạy được**, không phải chỉ một báo cáo test xanh. Bắt đầu bằng kiểm repo và kế thừa dữ liệu/code hiện có, rồi thực hiện.
