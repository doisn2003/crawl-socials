# Production v2 — triển khai kế hoạch tái cấu trúc CSD

Ngày: 06/11/2026. Nhánh: `production-v2`. Code đã kiểm chứng tại `1423e89`.

Đã triển khai phần mềm theo [master plan 2.0.0](../master-plans_restructor_version2.0.0.md), trên nền production `codex/csd-production` tại `738dc8e923093bb63b77671ea96813d9b699d690`. Không dùng nhánh Quality v2 đã bỏ làm nền. Việc nghiệm thu tỷ lệ hữu ích và sản lượng thực tế là bước riêng, chưa có số đo live cho phiên bản này.

Workspace thực hiện: `C:\OwnProject\crawl-socials-production-v2`. Workspace gốc `C:\OwnProject\crawl-socials` và production được giữ nguyên. Không push, promote production hoặc thay executable đang dùng.

## Hành vi sản phẩm đã triển khai

### Nhập yêu cầu và lập kế hoạch

- Giữ prompt tự nhiên và ô thông tin doanh nghiệp; gợi ý nêu sản phẩm/dịch vụ, vấn đề giải quyết, địa bàn ưu tiên và mục đích tiếp cận/nghiên cứu.
- Planner mặc định của luồng desktop dùng policy `opportunity-coverage-v2`. Tách các ý từ nguồn yêu cầu trước khi sinh cách tìm; kiểm tra mỗi ý có cách tìm hoặc lý do xử lý rõ ràng. Các câu hỏi, câu trả lời và sửa mục tiêu vẫn có lịch sử.
- Portfolio có 24 nhóm truy xuất, tối đa 240 query. Mỗi query giữ nguồn ý, nhóm, định danh và đợt. Kiểm tra không bỏ ý, không đảo chiều người cần/người cung cấp. Từ đồng nghĩa, dịch thuật, tiếng lóng là giả thuyết truy xuất; không bị buộc phải là trích nguyên văn prompt.
- Có tập query ban đầu và query dự phòng đóng băng trong recipe. Query dự phòng dùng được qua restart, nhiều tài khoản và cả OFF khi dùng kế hoạch đã lưu; không phải gọi planner lại để lấy reserve.
- Địa bàn ưu tiên không biến thành điều kiện loại. Không tự giới hạn tuổi bài. Thời điểm người tiêu dùng dự định dùng dịch vụ không bị nhầm với tuổi bài đăng.
- Query thuộc portfolio v2 chỉ đọc trong trình sửa tiêu chí. Sửa ý định qua phần hội thoại để tạo lại danh mục có nguồn; không sửa text rồi giữ metadata cũ sai lệch.

### Bốn chế độ lọc và phạm vi bằng chứng

| Chế độ | Hành vi code |
|---|---|
| OFF | Không lập kế hoạch bằng AI, không phân loại/review bằng AI; dùng từ khóa nhập hoặc kế hoạch đã lưu. Đầu ra ghi rõ chưa đánh giá. |
| CONSISTENT | Nhận cơ hội rộng có liên hệ và giá trị hợp lý: nhu cầu, vấn đề, mong muốn, trải nghiệm, thảo luận, sở thích, bối cảnh liên quan. |
| STANDARD | Giữ tín hiệu có ích cụ thể và các loại nhu cầu/vấn đề/mong muốn/trải nghiệm/thảo luận; tâm sự có liên hệ thật không bắt buộc có ý định mua. |
| QUALITY | Cần bằng chứng cụ thể đáp ứng mục tiêu đã chốt; review độc lập có chọn lọc cho ca dễ hiểu sai. Mục tiêu nghiên cứu/thảo luận không bị ép thành nhu cầu mua. |

Cả ba chế độ AI loại quảng cáo, bài lạc đề và bài có bằng chứng trái điều kiện bắt buộc. Thiếu bằng chứng hoặc lỗi kỹ thuật giữ trạng thái chờ; không biến lỗi API thành kết luận không phù hợp. Không nới chuẩn bằng quảng cáo hoặc bài không liên quan để lấp chỉ tiêu.

Một hợp đồng bằng chứng bài gốc dùng chung cho ba chính sách. Các nhãn giải thích gồm `DIRECT_NEED`, `LATENT_PROBLEM`, `PERSONAL_DESIRE`, `EXPERIENCE`, `DISCUSSION`, `INTEREST`, `CONTEXT`. UI hiển thị tên tiếng Việt; export giữ nhãn ổn định, lý do và ngày đăng khi có.

Luồng mới là `POST_ONLY`: không thu/enrich/revisit bình luận. Khi dùng kho cũ, view phân loại và cache loại bỏ bình luận. Comment mới không đổi hash nội dung bài gốc. Recipe lịch sử vẫn đọc/resume theo phiên bản đã lưu, không bị nâng cấp âm thầm.

Cache bằng chứng tách khỏi mode; recipe/policy/model/ý định/phạm vi bằng chứng được kiểm soát phiên bản. QUALITY review không nhận kết luận lượt đầu như một đáp án để sao chép. Tiêu chí hiện hành là nguồn quyết định; câu trả lời/sửa mục tiêu đã hết hiệu lực không được đưa lại vào classifier.

### Thu thập nhiều tài khoản và chạy nhiều giờ

| Giới hạn | Giá trị |
|---|---:|
| Mục tiêu đầu ra tối đa | 5.000 bài gốc |
| Trần bài thô tối đa | 50.000 |
| Trần bài thô mặc định | 20.000 |
| Portfolio tối đa | 240 query |
| Thời gian mặc định | 720 phút |
| Giới hạn thời gian recipe | 1.440 phút |

- Chọn nhiều tài khoản cùng nền tảng. Nút thêm tài khoản tạo profile riêng; không dùng lại profile đầu tiên.
- Job/checkpoint và thư mục kết quả tách theo nền tảng/profile/query. Ghi vào kho chung được tuần tự hóa; file tổng hợp tương thích dữ liệu cũ được tạo sau khi các writer riêng đã kết thúc.
- Giữ trang query còn có kết quả trong các lượt làm việc có giới hạn, giảm tải lại và replay. Độ mới, trùng, replay và thời gian được ghi để điều phối. Portfolio lớn vẫn có checkpoint.
- Số cửa sổ thích nghi theo tài nguyên và tải quan sát; có khoảng ổn định khi thay đổi concurrency. Cửa sổ thu thập ẩn; chỉ thao tác đăng nhập rõ ràng của người dùng mở cửa sổ xã hội.
- Một mục tiêu toàn cục, khử trùng theo `(platform, root_id)` và nhận theo thứ tự hoàn tất bền vững. Hai tài khoản thấy cùng một bài không tạo hai kết quả. Không áp quota Facebook/Threads.
- AI hết ngân sách không xóa bài đã thu; phần thu vẫn có thể tiếp tục trong trần raw/storage. Mọi gọi model, gồm planner/review và lượt theo dõi, vẫn đi qua ngân sách tiền hiện có. Không tự tăng trần.

### Xuất kết quả và lịch sử giao bài

- Bản xuất nhóm phù hợp bám tập target; bài dư vẫn lưu và có trong bản xuất tất cả. Raw nội bộ giữ đầy đủ bằng chứng.
- File xuất cho khách loại bài đã giao ở lượt trước của cùng scope. Xuất lại chính batch đó không cộng số bài mới.
- OFF ghi nhận mọi root thực sự có trong file, gồm extra; không tạo receipt phù hợp cho file rỗng hoặc dùng nhãn đã phân loại. Các hàng OFF vẫn là chưa đánh giá.
- Ghi file staging, lưu receipt và digest, rename file đích rồi hoàn tất ledger. Recovery kiểm tra digest trước khi ghi nhận; lỗi ghi file không được tính như đã giao. Partial/live export không mở khóa batch còn thiếu.
- Ledger SQLite lưu subscription, recipe hiện hành, scope khách/lĩnh vực ổn định, root đã giao và thời điểm giao. Gắn recipe mới là thao tác rõ ràng; không tự gộp khách hàng vì trùng prompt hoặc tên.

### Theo dõi định kỳ

- `DiscoveryWatch` độc lập với theo dõi bình luận. Người dùng bật lịch từ một lượt thu, có thể đặt tên khách/lĩnh vực và tắt lịch khi một lượt đang chạy.
- Mặc định tìm bổ sung mỗi 24 giờ, hướng tới 100 bài chưa từng giao trong tháng. Bài cũ mới phát hiện được tính; batch đầu không cộng vào chỉ tiêu bổ sung tháng. Tháng được xác định theo `Asia/Bangkok`.
- Tái dùng recipe đã xác nhận, không gọi planner lại. Giữ ngân sách và cơ chế tài khoản. Lượt mới bỏ qua root đã giao trước AI và khi chọn target.
- Lịch và trạng thái giữ qua restart; recovery xử lý gián đoạn giữa khởi chạy và ghi subscription. Không mở hai lượt đồng thời hoặc ghi đè kết quả thủ công chưa xuất.
- Khi đổi cấu hình cho cùng khách/lĩnh vực, dùng nút gắn cấu hình vào lịch đã có. Các root đã giao không làm số bài cần xuất bị kẹt ở target cũ.
- Desktop phải đang mở và tài khoản còn đăng nhập. Việc bật lịch là opt-in; coding và kiểm thử không tự tạo lịch thật.

### Giao diện

Giữ font hiện tại, dùng màu trắng/đen, bốn mode có tên và mô tả. CONSISTENT là mặc định cho cấu hình mới; mode đã lưu được giữ. Ngân sách lượt hiển thị và có thể chỉnh trong trần cho phép; giới hạn tiền trên máy vẫn được giữ. Có chọn nhiều tài khoản, tổng tiến độ theo nền tảng không đếm lặp, nhãn cơ hội/ngày đăng và bộ lọc loại cơ hội trong phần xem trước. Các control bình luận không hoạt động ở luồng mới.

## Kiểm chứng

Kiểm thử sử dụng mock model, dữ liệu cục bộ và AppData tạm cô lập. Không truy cập mạng xã hội, không gọi API trả phí và không mở writer vào AppData production.

- `npm run check`: đạt; TypeScript main, renderer và tests.
- `npm test`: build đạt; **1.065/1.065 tests đạt**, không skip/cancel/failure, khoảng 36,95 giây cho test runner.
- `node scripts/production-v2-ui-smoke.mjs`: đạt; Electron thực, cửa sổ ẩn, không có yêu cầu mạng, không có gọi model hoặc lỗi renderer; chặn toàn bộ HTTP(S). Kiểm tra bốn mode, lưu cấu hình, OFF zero cost, target 5.000, nhiều tài khoản, start một lần, post-only, hai thẻ tiến độ tổng đúng, lịch định kỳ, gắn recipe và tắt lịch khi đang chạy.
- Regression cụ thể: không gọi AI cho root đã giao; không đọc comment cũ; ngày đăng năm 2015 vẫn qua luồng không giới hạn tuổi; export target/extra đúng; OFF không làm mất query dự phòng; resume giữ selection; receipt/idempotency/partial export và lịch sử qua recipe mới.

Artifact cục bộ: [báo cáo UI smoke](../../artifacts/production-v2-ui-smoke/production-v2-ui-smoke.json), [ảnh giao diện theo dõi](../../artifacts/production-v2-ui-smoke/monthly-discovery.png). Artifact và ảnh không được đưa vào commit.

## Giới hạn nghiệm thu và vận hành

1. Test pass xác nhận code, không chứng minh độ hữu ích >50% ở CONSISTENT, 60–80% ở STANDARD hoặc chất lượng ngữ nghĩa thực tế của QUALITY. Cần nhãn post-only độc lập theo mục tiêu mới và đánh giá riêng; không tái dùng số đo của Quality v2 đã bỏ làm bằng chứng.
2. Target 5.000 đã đi qua cấu hình, planner, service, pipeline và UI trong kiểm thử. Chưa chạy thu live 5.000 bài cho phiên bản mới, chưa đo liên tục đủ tháng để xác nhận 100 bài/tháng. Nguồn tìm, tài khoản, máy, quota và ngân sách vẫn quyết định sản lượng.
3. Các nhóm query là portfolio hữu hạn có lineage. Không chứng minh bao phủ toàn database Facebook/Threads. Độ ưu tiên dựa trên tỷ lệ được model nhận là tín hiệu vận hành, không phải độ hữu ích đã được con người đo.
4. Giao bài được quy ước là xuất file thành công trên máy. Phần mềm không biết người nhận đã đọc file, đã được liên hệ hay đã mua hàng. Số root không phải số người tiêu dùng duy nhất.
5. Lịch tự chạy khi desktop mở; tắt máy không có crawler máy chủ. Phạm vi khách/lĩnh vực phải chọn đúng hoặc gắn vào subscription đã có để chống lặp qua recipe; không đoán danh tính khách từ prompt.
6. Việc triển khai dùng zero paid calls. Không mở lại DEVELOPMENT, không reset ledger, không đọc/in/copy key, cookie hoặc thông tin đăng nhập. Ngân sách của phép đánh giá live tiếp theo chưa được cấp trong yêu cầu coding này.

Không phát hành thay production chỉ dựa trên các kiểm thử trên. Nhánh này là bản triển khai để review và nghiệm thu dữ liệu thật theo phạm vi/chi phí được xác nhận riêng.
