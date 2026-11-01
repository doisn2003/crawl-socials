# CSD — Tiến độ, thành tựu và điểm cần quyết định

Ngày 31/10/2026. Báo cáo theo yêu cầu dừng sau lượt kiểm tra tai nghe. Phạm vi sản phẩm: tìm cuộc thảo luận để thương hiệu có thể tham gia, giữ dữ liệu nghiên cứu thị trường; đa chủ đề; mục tiêu 1.000 bài tinh **tổng hai mạng**, ưu tiên Threads 8:2 hoặc 7:3.

## 1. Hệ thống đang ở đâu?

**CSD đã có bộ máy chạy thật từ prompt đến thu thập, bình luận, phân loại và xuất dữ liệu. Chưa thể gọi là sắp nghiệm thu production.** Phần nền kỹ thuật hoạt động, nhưng độ chính xác và khả năng tìm đủ cuộc thảo luận có ích trong ngân sách chưa được chứng minh ổn định qua nhiều chủ đề.

Không dùng số tests hoặc số dòng code để quy đổi thành phần trăm hoàn thành. File café 1.000 bài đã giao là 1.000 bài do model chọn, không phải 1.000 cơ hội đã được xác nhận đạt chuẩn. Hai file đã giao giữ nguyên checksum.

## 2. Những gì đã làm được

| Khả năng | Bằng chứng hiện có |
| --- | --- |
| Prompt → kế hoạch và truy vấn | Planner tổng quát, có tiêu chí giữ/loại, giả định, trích dẫn làm căn cứ; xem/sửa/lưu dùng lại trên UI; không hardcode quán café |
| Vừa lưu vừa lọc | Thu Facebook/Threads song song; raw ghi trước, phân loại chạy đồng thời và kết quả xuất hiện trước khi crawl kết thúc |
| Bình luận trên cả hai mạng | Có capture bài/bình luận/reply, liên kết gốc/cha và mức coverage. Bình luận mới tạo revision và đánh giá lại; không đếm comment thành bài mới |
| Ba nhóm kết quả | Phù hợp / Chưa phù hợp / Không phù hợp; giữ pending/lỗi riêng, có bằng chứng và vị trí tham gia ở bài hoặc comment |
| Quản lý lượt chạy | Dừng/Tiếp tục, hàng chờ bền vững, chống trùng, cache, nhật ký token/chi phí, ngân sách model và giới hạn thu |
| Bảo vệ lưu trữ | Chờ khi backlog lớn; dừng thu thêm khi dung lượng run hoặc dung lượng trống chạm ngưỡng; giữ batch đã nhận. Policy không tự đổi qua Resume và được kiểm thử crash/concurrent writers |
| Nguồn và ranking | Ưu tiên nguồn của kế hoạch là tiêu chí phụ sau nội dung; không loại bài chỉ vì là page. Kết quả UI/SQL/export giữ cùng thứ tự |
| Tái sử dụng dữ liệu/bộ lọc | Tái lọc dữ liệu lưu sẵn và thêm thư mục CSD ngoài; không cần đăng nhập, không sửa nguồn, giữ comments và mốc dữ liệu cố định |
| Kiểm chứng kỹ thuật | Type check, build và **885/885 tests PASS**; có native UI smoke, tests worker/SQLite, Stop/Resume, raw preservation, budget và export |

Các thao tác seeding/đăng bình luận chưa được tự động hóa. Sản phẩm hiện tập trung tìm và đánh giá cơ hội.

## 3. Kết quả thực tế và giới hạn

### Café và kiểm tra chéo ngành

- Café: primary đạt precision theo tham chiếu AI khoảng **78,95% Facebook / 87,30% Threads**; thấp hơn mục tiêu 90%. Các mẫu đã dùng để cải tiến không còn là holdout mới cho bản sửa.
- Piano/HUST: hai phiên bản chạy cùng **323 mẫu**, hai pass nhãn và phân xử 54 ca; còn 41 ca chưa đủ thông tin. Tổng API **$0.5430968**.
- Piano/Threads: bản hiện tại 2.0.3 đạt **precision 59,3%, recall 94,1%** theo tiêu chí của campaign kiểm tra. Tức là tìm được nhiều bài đúng nhưng cũng đưa vào nhiều bài chưa đủ cơ sở để tham gia.
- HUST có quá ít dương tính để kết luận rộng. Chẳng hạn precision Facebook 100% chỉ dựa trên **2 bài được chọn**; recall chỉ 50%.
- Bản thử nghiệm 2.1 phát sinh **48 lỗi validation**, 46 lỗi liên quan trường thương hiệu khi campaign không cung cấp thương hiệu. Chi phí gần gấp đôi bản hiện tại. **Không bật 2.1 mặc định.**

[Chi tiết mẫu số, khoảng tin cậy và chi phí](../evidence/cross-topic-paired-2026-10-31.md). Tham chiếu do AI đánh giá độc lập, không thay thế human gold; chưa chứng minh recall trên toàn mạng xã hội.

### Lượt tai nghe vừa hoàn tất

Run `crawl-4ed260d9-9a37-4f2b-9e3d-6ff2b080e329`, bộ lọc 2.0.3, comments bật. Thiết lập: 300 raw, 15 phút, $1; mục tiêu thử 100 bài với ưu tiên 80:20. Đây là kiểm tra bộ máy ở ngành thứ ba ngoài café, không đổi mục tiêu sản phẩm thành 100.

| Kết quả model tại cuối lượt | Threads | Facebook | Tổng |
| --- | ---: | ---: | ---: |
| Bài gốc duy nhất | 161 | 149 | **310** |
| Bình luận đã lưu | 132 | 66 | **198** |
| Phù hợp do model chọn | 68 | 30 | **98** |
| Chưa phù hợp | 63 | 109 | **172** |
| Không phù hợp | 30 | 10 | **40** |
| Pending/lỗi phân loại | 0 | 0 | **0** |

API toàn lượt **$0.2247048**, gồm 1 planner call và 45 classifier calls; usage unknown/reserved đều 0. Khoảng 3 phút 32 giây từ launch đến mốc export cuối. Trạng thái cuối **STOPPED**, không phải COMPLETED: chưa đạt 100 và chưa đủ 80 Threads. Cap raw là điểm dừng nhận thêm; đã giữ trọn batch đang nhận nên tổng vượt 300 lên 310. Số 98 vẫn là model-selected, chưa được dùng như số cơ hội xác nhận.

Giới hạn bình luận rất cụ thể: **29/310 roots được thử capture**, gồm 27 có comments và 2 empty; 281 chưa thử. Có 67 reply lồng và không có parent unresolved trong phần đã lưu. Chỉ **1/98** kết quả Phù hợp chọn COMMENT làm nơi tham gia, 4 kết quả trích evidence bình luận. Lịch sử có một trường hợp từ Chưa phù hợp thành Phù hợp sau khi có bình luận mới; đây là quan sát tiến trình, không phải thí nghiệm chứng minh tác động nhân quả. Thu được bình luận và khai thác tốt bình luận là hai mức nghiệm thu cần đo riêng.

Collector có 345 rows vì gồm 310 bài gốc và 35 Threads reply-candidates; không cộng 35 candidates chưa phải bài gốc thành bài mới. Mười bài vượt cap xuất hiện khi raw đi từ 299 lên 310 trong hai nhóm ingest đang chạy đồng thời. Không bỏ chúng để làm số cuối tròn 300.

Hàng chờ tìm bài gốc từ reply vẫn còn **34 jobs** sau một attempt hoàn tất. Con số 0 pending trong bảng chỉ là phân loại hiện tại, không có nghĩa toàn bộ enrichment/discovery đã hết việc. Pilot đã thoát process và không bật watch; không tự tiếp tục các jobs này trong thời gian tạm dừng.

Đã đánh giá độc lập toàn bộ 310 snapshots, đọc chéo 62 mẫu chọn không dựa vào nhãn model, rồi phân xử các ca khác nhau. Độ đồng thuận nhãn trước phân xử là 59/62 (95,2%). Final reference có 91 Phù hợp, 177 Chưa phù hợp, 34 Không phù hợp và 8 chưa đủ thông tin. Dự đoán model đã có từ lúc thu; các agent gán nhãn không được xem chúng, và bản tham chiếu được cố định trước khi evaluator mở dự đoán. Không gọi thêm API/crawl cho đánh giá này. Đây là tham chiếu AI, chưa phải xác nhận của con người hoặc bằng chứng seeding thực tế.

| Kiểm tra nội dung tai nghe | Threads | Facebook |
| --- | ---: | ---: |
| Model chọn | 68 | 30 |
| Được tham chiếu AI xác nhận đúng | **59** | **16** |
| Chọn sai | 8 | 14 |
| Đầu ra chưa đủ thông tin để kết luận | 1 | 0 |
| Precision trên nhãn đã phân xử được | **88,1%** (59/67) | **53,3%** (16/30) |
| Recall trong bài gốc đã thu | **86,8%** (59/68) | **69,6%** (16/23) |

Trong 98 model-selected, **75 đúng theo tham chiếu AI, 22 sai và 1 chưa rõ**. Tỷ lệ đầu ra đã được tham chiếu xác nhận là **75/310 = 24,2%** của raw; thấp hơn mức 33–50% cần cho kỳ vọng 1.000 tinh từ 2.000–3.000 raw. Threads gần các ngưỡng hơn Facebook, nhưng chưa đạt precision 90% và chưa đủ 100 output được đánh giá/mạng theo gate.

Tham chiếu tìm được 13 cơ hội có target ở bình luận (8 Facebook, 5 Threads); model bỏ sót 9/13 ở mức chọn bài. Ba trường hợp model chọn vị trí tham gia khác tham chiếu đều có bằng chứng hợp lệ, không bị tính sai chỉ vì không trùng target. Kết quả cho thấy cần cải thiện cách sử dụng ngữ cảnh bình luận, bên cạnh việc mở rộng coverage.

Quy đổi **API của chính pilot này** theo 75 đầu ra đúng là khoảng **$2,996/1.000**. Không coi đây là bảo đảm production dưới $3: chưa tính hạ tầng, chưa có biên dự phòng, nhãn tham chiếu vẫn do AI và chất lượng nguồn thay đổi theo campaign. Chi phí thật của lượt đo vẫn là $0.2247048, không phải đã chạy 1.000 bài xác nhận.

[Operational audit](C:/Users/Admin/AppData/Roaming/csd-desktop/data/benchmarks/audio-engine-20261031/operational-summary.md) · [Đánh giá nội dung và giới hạn](C:/Users/Admin/AppData/Roaming/csd-desktop/data/benchmarks/audio-engine-20261031/quality-summary.md). Reference SHA-256: `33b39fbe414528dde84c03310333c69f12ef2c1f05e3b164cd98a7faefe9c47e`.

## 4. Khó khăn quyết định còn lại

1. **Phân biệt bài liên quan và cơ hội tham gia.** Model còn nhận lời khen chung, nhật ký ngắn, chia sẻ màn biểu diễn hoặc ý định mơ hồ thành trải nghiệm/thảo luận có ích; đôi khi bỏ sót trải nghiệm cụ thể vì không có câu hỏi. Đúng chủ đề chưa đủ để quyết định Phù hợp.
2. **Chất lượng nguồn.** Facebook vẫn có nhiều quảng cáo; keyword search không tự đảm bảo nguồn người dùng cá nhân/nhóm. Chưa triển khai collector feed và registry nguồn riêng cho profile/group/page. Chọn thêm thư mục dữ liệu không phải tính năng này.
3. **Bình luận đã thu được nhưng coverage còn hạn chế.** Có cap/lượt mở/expand; không thể gọi 198 comments là toàn bộ comments trên 310 bài. Bài ít chữ/ảnh/video vẫn khó được tìm bằng keyword. Chưa chứng minh coverage comment theo gate tham chiếu trên từng bề mặt.
4. **Một số điều kiện và thời gian chưa áp dụng đầy đủ.** Planner hiểu nhiều trường hơn bộ lọc mặc định hiện thi hành; ngôn ngữ/đối tượng/nghiên cứu còn ghi chú UI và cần điều kiện giữ/loại rõ. `max_age_days` chưa tự tạo expiry; watch 72 giờ và live continuation dài hạn chưa nghiệm thu.
5. **Chi phí phải đi cùng chất lượng và yield.** Chi phí API nhỏ không chứng minh <$3/1.000 cơ hội thật. Cần tính trên đầu ra được xác nhận, cùng phạm vi run; còn chi phí vận hành máy/thu thập chưa đo đầy đủ. Không thể bù thiếu nguồn bằng nới nhãn.
6. **Chưa hoàn tất phát hành.** Portable RC2 có trước các thay đổi gần nhất; source/dist mới hơn. Retained import chưa có storage admission, retention tự động chưa triển khai; vẫn cần kiểm chứng release/rollback và chạy dài.

Tiến độ kỹ thuật hiện đi trước tiến độ chứng minh chất lượng. Đây là lý do không tiếp tục lấy số tests hoặc đủ 1.000 dòng làm tiêu chuẩn hoàn thành.

## 5. Hệ thống đã gần hoàn thành chưa?

| Mức sử dụng | Đánh giá |
| --- | --- |
| Thu và lưu dữ liệu để người dùng xem/nghiên cứu | Đã sử dụng được trên các route đã kiểm chứng |
| Gợi ý cơ hội, người dùng kiểm tra trước khi tham gia | Đã có khả năng vận hành; cần coi nhãn là gợi ý |
| Tự tin giao 1.000 cơ hội tinh đa chủ đề, đạt precision/recall/chi phí đã chốt | **Chưa đạt** |
| Production có comments/watch/nguồn/khôi phục dài hạn được nghiệm thu đầy đủ | **Chưa đạt** |

Nếu tiếp tục, phần có giá trị nhất là cải tiến hợp đồng output và ranh giới intent, đồng thời cải thiện nguồn/phát hiện cuộc trao đổi; kiểm chứng lại bằng holdout mới. Phát triển thêm UI hoặc điều chỉnh một bộ output có sẵn sẽ không giải quyết phần thiếu quyết định này.

## 6. Điểm dừng để người dùng quyết định

**Đã hoàn tất kiểm tra lượt tai nghe và báo cáo này. Tạm dừng theo yêu cầu người dùng.** Process thu đã thoát, watch không hoạt động, các agent kiểm tra đã hoàn tất. Không mở chiến dịch mới, không sửa tiếp bộ lọc, không đóng gói hoặc phát triển tính năng mới trước quyết định tiếp theo.

Những hướng có thể cân nhắc: tiếp tục công cụ tìm thảo luận nhưng thu hẹp phạm vi đã kiểm chứng; chuyển trọng tâm sang nghiên cứu thị trường; hoặc đánh giá lại nguồn dữ liệu/route nếu đầu vào không đạt yield cần thiết. Chưa tự chọn thay người dùng.
