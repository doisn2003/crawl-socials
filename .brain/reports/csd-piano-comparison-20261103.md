# CSD R7 — thử piano với Gemini 3.1 Flash-Lite

Ngày 03/11/2026, múi giờ Asia/Bangkok. Bản ứng viên **0.4.0-rebuild.2**.

**Đã xuất đủ 1.000 bài được bộ lọc nhận cho mỗi mức.** Trên cùng 3.222 bài gốc, Tiêu chuẩn nhận 1.356 và Chất lượng nhận 1.005. Toàn nhiệm vụ dùng **1,253847 USD / trần 6 USD**, gồm cả lập kế hoạch, kiểm tra truy cập, mở rộng query, lỗi và các lần xử lý lại. Kiểm tra mẫu cho thấy Tiêu chuẩn giữ được nhiều bài đúng hơn, còn Chất lượng sạch hơn nhưng bỏ sót thêm. Bộ lọc vẫn cần cải tiến vai cung–cầu và cách xét các nhánh thảo luận/đam mê.

## Phạm vi và file bàn giao

Prompt được giữ nguyên: “Tìm người dùng đang có nhu cầu học chơi đàn piano. Tìm người muốn mua đàn piano hoặc thuê đàn piano. Tìm những người đang bàn luận về đàn piano. Tìm những người chia sẻ câu chuyện của họ về piano. Tìm những người đam mê âm nhạc, đam mê piano”.

Làm rõ của người dùng: **chỉ bài liên quan đến piano**. Các nhánh là HOẶC, nên bài kể chuyện hoặc bày tỏ đam mê không cần có thêm ý định mua/học. Không tự thêm giới hạn địa bàn, ngôn ngữ hoặc tuổi bài. Bài quảng cáo đơn thuần sai vai; nội dung thảo luận đáng kể không bị loại chỉ vì người đăng là giáo viên/cửa hàng.

- [1.000 bài Tiêu chuẩn — Excel](C:/Users/Admin/AppData/Roaming/csd-desktop/data/comparisons/piano-comparison-20261103/CSD-piano-STANDARD-1000.xlsx)
- [1.000 bài Chất lượng — Excel](C:/Users/Admin/AppData/Roaming/csd-desktop/data/comparisons/piano-comparison-20261103/CSD-piano-QUALITY-1000.xlsx)
- [Dữ liệu Tiêu chuẩn — JSON](C:/Users/Admin/AppData/Roaming/csd-desktop/data/comparisons/piano-comparison-20261103/CSD-piano-STANDARD-1000.json)
- [Dữ liệu Chất lượng — JSON](C:/Users/Admin/AppData/Roaming/csd-desktop/data/comparisons/piano-comparison-20261103/CSD-piano-QUALITY-1000.json)
- [CSD Portable 0.4.0-rebuild.2](C:/OwnProject/crawl-socials/release/CSD-Portable-0.4.0-rebuild.2.exe)
- [Số liệu tổng hợp và hash để đối chiếu](../evidence/csd-piano-comparison-20261103.json)

File Excel có nội dung, URL, thời gian, quyết định và bằng chứng. Mỗi file đã kiểm tra đủ 1.000 dòng bài, không trùng ID, mọi quyết định đều thuộc đúng snapshot và model 3.1. Phần dư và toàn bộ dữ liệu thô giữ tại thư mục AppData bên trên; không đưa dữ liệu bài đăng vào Git. Đây là bộ so sánh lưu riêng, dùng collector và classifier của CSD, không phải hai lượt độc lập hiển thị như campaign thông thường trong lịch sử UI.

## Số lượng

Hai mức cùng đọc tập cuối và bằng chứng giống nhau. Quality tái dùng đánh giá nền của Standard, rồi kiểm tra bổ sung có chọn lọc.

| Chỉ số | Tiêu chuẩn | Chất lượng |
|---|---:|---:|
| Bài gốc đầu vào | 3.222 | 3.222 |
| Được nhận | **1.356** | **1.005** |
| Không phù hợp | 1.611 | 1.726 |
| Chưa kết luận | 255 | 491 |
| Đã xuất trong chỉ tiêu | **1.000** | **1.000** |
| Phần dư được giữ | 356 | 5 |
| Facebook / Threads trong file 1.000 | 212 / 788 | 286 / 714 |

Tiêu chuẩn nhận nhiều hơn 351 bài, tương đương **34,9%** so với Chất lượng. Hai tập được nhận có 1.000 bài chung; 356 chỉ được Standard nhận, 5 chỉ được Quality nhận. Quality không hoàn toàn là tập con vì một số đánh giá nền thiếu/lỗi được xử lý lại bằng cùng bằng chứng.

Toàn nguồn gồm 746 bài Facebook và 2.476 bài Threads. Không đặt tỷ lệ mạng. Collector còn giữ 147 trả lời Threads chưa xác định gốc; chúng chưa vào tập 3.222 và không được tính thành bài gốc. **Chưa kết luận là trạng thái xử lý**, không phải nhãn phân loại thứ ba hay bài đạt chỉ tiêu.

“Duy nhất” ở đây là theo mạng/ID bài gốc, không phải 1.000 người khác nhau. Tập thô có 88 bản ghi ngoài lần xuất hiện đầu tiên có văn bản giống hệt; file Standard có 9, Quality có 6. Chưa gộp các ID khác nhau chỉ vì giống câu chữ.

## Chi phí và thời gian

| Công việc thực tế trong phép so sánh | USD |
|---|---:|
| Preflight + phân rã prompt + mở rộng query | 0,004746 |
| Xử lý thuộc lượt Tiêu chuẩn | 0,738382 |
| Công việc thêm để có Chất lượng | 0,510719 |
| **Tổng** | **1,253847** |

Có 1.070 API attempts của nhiệm vụ; 2.406.402 token vào, 434.831 token ra, usage báo 0 thinking/cache. Giá dùng tính: 0,25 USD/triệu token vào và 1,50 USD/triệu token ra, theo [bảng giá Google](https://aistudio.google.com/docs/pricing#gemini-3.1-flash-lite). Đây là chi phí tính từ usage, không phải hóa đơn Visa hay sao kê Google.

Chi phí lọc trên 1.000 bài đầu vào của phép chạy này khoảng **0,229 USD Standard** và **0,388 USD cho nền + Quality**, chưa cộng 0,004746 USD công việc chung. Quality làm chi phí lọc tích lũy tăng khoảng **69,2%**. Không gọi 0,510719 USD là giá chạy Quality độc lập: đó chỉ là phần thêm sau khi đã có Standard. Cũng không coi toàn bộ 0,738382 USD là chi phí tối thiểu để Standard dừng ngay khi đạt 1.000, vì Standard tiếp tục đọc tập chung trong lúc chờ Quality.

Tài khoản DEVELOPMENT có tổng 1.071 attempts vì giữ thêm lần preflight 2.5 cũ, chi phí 0 USD. Không xóa hoặc reset sổ. Ledger bền vững ghi 1,253847023 USD do làm tròn từng khoản ở đơn vị nhỏ; chênh với tổng usage dưới 0,000001 USD. **Dự phòng còn treo = 0**. Ngân sách nhiệm vụ đã đóng tại số tiền/số call hiện có; không tiếp tục dùng phần chưa tiêu cho thử nghiệm khác.

Từ lúc bắt đầu 18:24:56 đến hoàn tất 19:07:24: khoảng **42 phút 27 giây**. Khoảng này có sửa lỗi và khôi phục checkpoint nhiều lần; không phải phép đo tốc độ thuần hoặc hai lượt A/B độc lập. Mất điện xảy ra sau khi dữ liệu và bản xuất đã hoàn tất. Đã kiểm tra lại JSON, SQLite, hash binary; một log smoke gần cuối bị hỏng sau mất điện nên kiểm tra worker đó được chạy lại offline, không gọi AI.

## Chất lượng qua mẫu kiểm tra

Khóa mẫu đều 120 bài từ toàn bộ 3.222 bài bằng hash xác định trước; đọc văn bản trước khi ghép nhãn candidate. Gán 40 YES, 70 NO, 10 UNKNOWN. Nhãn tham chiếu do **một coding agent** đọc, chưa được khách hàng xác nhận. Một bài hashtag chung từng xuất hiện khi debug trước đó; nhãn model cuối vẫn được ẩn khi chấm. Không chỉnh bộ lọc theo mẫu rồi gọi điểm trên chính mẫu ấy là kiểm chứng độc lập.

| Chỉ số trên mẫu | Tiêu chuẩn | Chất lượng |
|---|---:|---:|
| Bài đúng được nhận | 37 | 31 |
| Bài sai được nhận | 8 | 4 |
| Bài đúng chưa được nhận, gồm PENDING | 3 | 9 |
| Bài tham chiếu UNKNOWN nhưng được nhận | 8 | 4 |
| Precision trên phần có nhãn rõ | **82,2% (37/45)** | **88,6% (31/35)** |
| Khoảng Wilson 95% của precision | 68,7–90,7% | 74,0–95,5% |
| Recall trên 40 bài đúng trong mẫu | **92,5%** | **77,5%** |
| Khoảng Wilson 95% của recall | 80,1–97,4% | 62,5–87,7% |

Precision là tỷ lệ đúng trong phần được nhận; recall là tỷ lệ bài đúng mà bộ lọc giữ được **trong tập đã crawl**, không đo mọi bài có trên mạng xã hội. Trong mẫu, Quality giảm 4 bài sai nhưng mất thêm 6 bài đúng. Khoảng bất định chồng lấn; chưa đủ cơ sở khẳng định mức cải thiện precision sẽ lặp lại ở mọi chủ đề.

Nếu coi toàn bộ ca UNKNOWN được nhận là sai hoặc đều đúng, precision mẫu nằm trong **69,8–84,9% Standard** và **79,5–89,7% Quality**. Đây là biên do thiếu nhãn, không phải khoảng tin cậy thống kê.

Bảng chính đánh giá toàn bộ tập được bộ lọc nhận, gồm cả phần dư. Trong đúng hai file bàn giao 1.000, mẫu ngẫu nhiên trên giao với 40 bài Standard và 38 bài Quality:

| Kiểm tra phần thuộc file bàn giao | Tiêu chuẩn | Chất lượng |
|---|---:|---:|
| Đúng / sai / chưa rõ | 26 / 6 / 8 | 30 / 4 / 4 |
| Precision phần rõ | 81,3% | 88,2% |
| Wilson 95% | 64,7–91,1% | 73,4–95,3% |

Các con số 82%/89% là ước lượng ban đầu; không có nghĩa đã kiểm tra thủ công đủ 2.000 dòng, hoặc bảo đảm mọi tập Standard luôn đạt trên 60%.

Trong 40 bài tham chiếu đúng có 18 bài thuộc học/mua/thuê và 22 bài thuộc thảo luận/câu chuyện/đam mê. Vì prompt rộng như đã duyệt, **1.000 bài được nhận không tương đương 1.000 khách sẵn sàng trả tiền**.

## Vì sao kiến trúc tạo ra kết quả này?

**Thu rộng và lưu trước khi lọc giúp đạt số lượng.** Mỗi query/mạng có công việc, cửa sổ và checkpoint riêng; khử trùng theo ID rồi lưu bền vững. Mười query từ planner, hai neo ngắn “piano”, “đàn piano” và bốn query mở rộng tạo 16 tác vụ/mạng. Cả 32 tác vụ đều đã chạy; một số dừng do đạt mục tiêu hoặc timeout, không có bằng chứng mọi nguồn đã cạn.

Đợt chạy tìm ra lỗi trần cũ 8 cửa sổ/hồ sơ và việc đóng/mở liên tục khi CPU tăng. Đã sửa để bộ điều phối chung quyết định theo tài nguyên; tăng CPU chỉ ngăn nhận thêm công việc, không tự đóng mọi cửa sổ đang làm. Đỉnh log là 17 tác vụ đang giữ quyền cửa sổ; RAM trống thấp nhất khoảng 1,14 GiB và CPU hệ thống có lúc 100%. Đây là tải cả máy, không chỉ CSD. “Mỗi từ khóa một cửa sổ” không đồng nghĩa 32 trang luôn hoạt động đồng thời trên máy 16 GiB. Giới hạn Tier 1 cao cũng không xóa thời gian tải trang, render và replay phân trang.

**Standard nhận DIRECT và PLAUSIBLE có bằng chứng nên ít bỏ sót.** Nó không yêu cầu mọi bài phải có câu “tôi muốn học/mua”. Phụ huynh, câu hỏi chọn đàn, chuyện tập luyện và sở thích có thể được giữ theo nhánh phù hợp. Đầu ra gọn theo batch, cache theo ngữ nghĩa và model rẻ hơn giúp giảm tiền. Tuy nhiên, span có thật chỉ chứng minh model trỏ đến nội dung tồn tại, không chứng minh suy luận vai/chủ đề là đúng.

**Quality chọn ca để đọc thêm, nhưng chọn dựa một phần vào chính nhận định lần đầu.** Nếu model gán DIRECT/TARGET và không gắn cờ, bài có thể đi qua mà không được đọc lại. Bốn ca sai còn lại trong mẫu Quality đều là phía cung: tặng đàn, tặng voucher học, bán Petrof và thanh lý đồ em bé có đồ chơi piano. Vòng kiểm tra bổ sung chưa bắt được lỗi mà vòng đầu tự tin cho là đúng.

Ở chiều ngược lại, Quality đòi kết quả kiểm tra bổ sung phải đạt DIRECT. Một số bài đã được hai lượt coi là phù hợp nhưng vẫn mang PLAUSIBLE, nên bị giữ PENDING. Ví dụ: bàn đào tạo piano, nhận xét một cảnh chơi piano, kể piano là sở thích. Với nhánh thảo luận/đam mê, đòi dấu hiệu kiểu nhu cầu mua/học làm mất bài đúng. Đây là lý do cần chính sách riêng theo nhánh, thay vì tiếp tục siết chung.

Một số ca còn bị loại chỉ vì tác giả là trung tâm hoặc có lời mời tư vấn, dù có câu chuyện/thảo luận đáng kể. Ranh giới giữa nội dung chuyên môn và quảng cáo cần được người dùng kiểm tra thêm; nhãn tham chiếu đã nêu rõ cách xử lý ca ranh giới.

## Điểm mạnh, điểm yếu và hướng cải tiến

Điểm mạnh đã đo được: đạt chỉ tiêu hai mức trong khoảng 21% trần tiền; chia sẻ dữ liệu/cache; giữ dữ liệu qua checkpoint và mất điện; không ép tỷ lệ mạng; có thể truy lại quyết định/bằng chứng/chi phí. Standard là lựa chọn hợp hơn cho mục tiêu thu rộng và chủ đề ít bài trong lần này.

Điểm yếu còn hiện hữu:

- Standard vẫn có lỗi suy diễn chủ đề và đảo phía cung–cầu. Quality chưa sửa được các ca DIRECT tự tin nhưng sai; đồng thời bỏ sót thêm bài đúng.
- PENDING chiếm 7,9% Standard và 15,2% Quality. Standard có 189 ca thiếu bằng chứng, 58 ca thiếu item trong trả lời, 7 sai format và 1 không có chữ. Quality có 362 ca thiếu mức bằng chứng theo chính sách Quality, 96 thiếu bằng chứng nền, 30 bất đồng và 3 ca còn lại. Không được đánh đồng toàn bộ PENDING với nguồn kém chất lượng.
- Chưa thu sâu bình luận, chưa đọc media; tập 3.222 hiện có **0 bình luận gắn gốc**. 147 trả lời chưa có gốc còn giá trị tiềm năng nhưng chưa được giải quyết. Hashtag hoặc tiêu đề video không đủ xác minh nội dung.
- Trong file xuất, Standard có 545 bài trong 30 ngày, 136 bài 31–90 ngày và 319 bài hơn 90 ngày; Quality tương ứng 458 / 177 / 365. Bài lâu nhất khoảng 5,5 và 7,4 năm. Không có hạn tuổi được chốt nên không tự loại, nhưng chưa thể xác nhận nhu cầu thương mại vẫn còn.
- Từ “piano” còn có nghĩa tầng/kế hoạch trong tiếng Ý và xuất hiện trong thương hiệu/đồ chơi. Search thật trả về nhiều nhiễu; không phải thêm cửa sổ là mọi kết quả đều đúng. Một số trạng thái worker còn ghi FAILED/USER_STOP khi nguyên nhân toàn cục là đạt mục tiêu; đây là điểm cần sửa cách báo trạng thái.
- Lát thu ngắn hiện phải mở lại/replay một phần kết quả cũ khi đào sâu. Cần giảm công việc lặp ở browser trước khi tăng mạnh song song API.

Thứ tự cải tiến đề nghị, chưa tự chạy thêm phép thử trả phí:

1. **Trả về nhánh phù hợp và vai của tác giả theo nhánh.** Phân biệt tìm học, tìm mua/thuê, thảo luận, chuyện cá nhân và đam mê. Yêu cầu bằng chứng đúng cho từng loại; bài thảo luận không cần giả lập ý định mua.
2. **Review theo rủi ro sai vai, kể cả ca DIRECT.** Tập trung vào tin cho/tặng/bán/dạy, đồ chơi và ngữ cảnh chỉ có tag/tên tài khoản. Lấy mẫu nhỏ ca tự tin để đo lỗi; không đọc lại mọi bài.
3. **Xử lý PENDING có mục tiêu và giới hạn chi phí.** Cứu riêng item thiếu/format lỗi, giữ item hợp lệ; không lặp cả batch. Đọc thêm gốc/bình luận hoặc media chỉ ở ca có khả năng thay đổi quyết định. Không tự nhận ca thiếu bằng chứng để làm đủ số.
4. **Giữ ngữ cảnh cửa sổ qua các lát và tối ưu query bằng số bài mới hữu ích.** Mỗi query vẫn độc lập; tránh replay prefix dài, hiển thị chính xác đạt mục tiêu/cạn nguồn/timeout. Sửa validator mở rộng query để không bỏ toàn bộ phần đúng khi model trả quá số lượng.
5. **Cho người dùng xem riêng mức độ nhu cầu và tuổi bài trong tập phù hợp.** Có thể ưu tiên bài mua/học mới khi mục tiêu là bán hàng, vẫn giữ nhánh câu chuyện/đam mê đã yêu cầu. Không âm thầm đổi phạm vi để lấy điểm đẹp.

Mẫu hiện tại nên trở thành tập hồi quy sau khi người dùng xác nhận các ca ranh giới. Lần đo tiếp cần mẫu giữ riêng hoặc mẫu mới, báo lại precision/recall/chi phí dưới một ngân sách được cấp; không tuyên bố model tự học hoặc đã được huấn luyện RL.

## Bản chạy, kiểm tra và Git

Đã đổi model mặc định của planner/filter mới sang **Gemini 3.1 Flash-Lite**; bản nháp 2.5 từng lỗi có thể retry theo model đã chọn mà không xóa chi phí cũ. Lượt lịch sử vẫn giữ recipe/model. Khi tự chạy, dùng bản portable mới và giới hạn USER trong CSD; ngân sách DEVELOPMENT của phép thử này không tự tăng giới hạn chạy tay.

Typecheck và **982/982 unit tests** đạt. Kiểm tra main/preload/renderer của ASAR đạt; OFF chặn planner, không gọi AI. Worker SQLite trong ASAR đạt. Fixture localhost mở 24 cửa sổ riêng và kiểm tra session/observer; số này không phải khả năng chạy 24 trang mạng xã hội nặng cùng lúc. Đã đối chiếu SQLite, 1.000 dòng mỗi Excel và ID bằng chứng trong JSON. Sau mất điện kiểm tra lại integrity và hash, không crawl hoặc gọi model lại.

Runtime được đóng gói từ commit `704e75d`, nối các commit `20b70ae` (model/chi phí), `d334dde` (cửa sổ/collector), `1e14d4e` (batch/review). Chặng riêng `codex/csd-r7-piano-comparison` được hợp vào `codex/csd-rebuild` theo merge có mốc; tag `csd-rebuild-r7-20261103` lưu kết quả này. Giữ tag ứng viên cũ và RC7; chưa promote production hoặc push remote.

**Khuyến nghị hiện tại:** tiếp tục thử với Standard khi ưu tiên số lượng và giảm bỏ sót; dùng Quality khi chấp nhận ít bài hơn, nhưng chưa coi mức này là bộ lọc chính xác tuyệt đối. Ưu tiên sửa chính sách theo nhánh và lỗi vai trò trước khi tăng mức chi hoặc thêm vòng LLM.
