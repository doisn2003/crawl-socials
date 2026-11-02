# CSD 0.3.0-rc.6 — bộ lọc theo mục tiêu và bằng chứng

Người dùng đã DUYỆT tích hợp hai nhãn và sửa lỗi hiểu sai mục tiêu/vai trò. Bản này nối tiếp cơ chế phủ ngữ nghĩa có kiểm soát và hỏi ngược bằng LLM đã được duyệt ở RC5.

## Các chặng

| Chặng | Kết quả |
|---|---|
| F1 — Hiểu mục tiêu | Lưu mục tiêu, lời làm rõ và tiêu chí đã xác nhận; phân biệt người mua/thuê với bên cung cấp; phân biệt điều kiện bắt buộc và ưu tiên. |
| F2 — Kiểm tra bằng chứng | Nhánh HOẶC, điều kiện VÀ; trích dẫn đúng đối tượng; kiểm định độc lập; hai nhãn cuối và trạng thái xử lý riêng. |
| F3 — Xếp hạng và xem xét | Ưu tiên mềm có bằng chứng, loại nhu cầu, độ mới và nguồn; hai nhóm kết quả; Excel có GoalEvidence. |
| F4 — Tái chạy AppData | Ba bộ mới nhất trước, bộ café lớn nhất sau; lưu checkpoint, đối chiếu nhãn, ca hồi quy và nhận xét thủ công. Đã kiểm chứng đủ 5.778 hội thoại; nguồn giữ nguyên. |

Phiên bản: **0.3.0-rc.6**. Policy: `goal-evidence-v3.0.0`. Ranking: `goal-evidence-rank-v3`. Mã lượt kiểm chứng cuối: `79e7d0b062d1d85e`.

## Hành vi đã tích hợp

Lời làm rõ và tiêu chí đã xác nhận đi cùng campaign. Bộ lọc lập hợp đồng mục tiêu có trích dẫn nguồn; suy diễn “luôn tìm khách hàng” từ planner cũ không được lấn át yêu cầu. Với nhà trọ, lời làm rõ là **“Tìm phòng để tôi thuê”**: cần tìm phòng được chào cho thuê, không phải những người cũng đang tìm phòng.

Một nhánh đạt đủ điều kiện bắt buộc thì có thể phù hợp. Mọi nhánh đều có mâu thuẫn có bằng chứng thì không phù hợp. Thiếu bằng chứng giữ trạng thái PENDING; lỗi API/schema giữ trạng thái FAILED hoặc lỗi xử lý tương ứng. Đây là trạng thái chưa có kết luận, không phải nhãn phân loại thứ ba. Không ép mọi bài vào nhãn âm để đủ hai nhãn.

Giá được đối chiếu bằng code, giữ đúng dấu “dưới”, khoảng giá giao ngưỡng và giá “từ”. Không ghép giá hoặc tiện nghi giữa các phòng/bình luận không liên quan. Trích dẫn phải tồn tại trong nguồn; chỉ chuẩn hóa khoảng trắng, hoa/thường và dấu định dạng ở ranh giới. Không sửa số, dấu tiếng Việt hoặc từ phủ định để khớp.

Kiểm định độc lập kiểm tra độ đầy đủ của hợp đồng mục tiêu trước khi phân loại. Kiểm thử thật phát hiện phiên bản trung gian bỏ sót “giữ quảng cáo liên quan để nghiên cứu” và “ưu tiên Threads” của café; bước kiểm định đã yêu cầu lập lại hợp đồng đầy đủ. Ưu tiên nền tảng được tính từ metadata nguồn, không yêu cầu bài viết tự nhắc tên nền tảng.

Khi bài gốc chưa phù hợp nhưng có bình luận, bộ lọc có lượt tìm riêng trong bình luận. Bài gốc chỉ là ngữ cảnh; người bình luận có thể có mục đích khác tác giả. Kết quả nhận phải trỏ tới bình luận đã chứng minh, qua cùng các bước kiểm định. Lượt này đã tìm thêm khách mua gà dưới bài bán hàng. Dữ liệu kiểm chứng lưu cả đánh giá ban đầu và đánh giá bình luận.

Ưu tiên mềm chỉ ảnh hưởng thứ tự, không tự loại bài. Tuổi bài không tự đồng nghĩa hết hạn. Thời hạn được chứng minh và giới hạn tuổi bài do người dùng yêu cầu được xét riêng. Các lần tái chạy đánh giá tại thời điểm quan sát gốc, không xác nhận nhu cầu/phòng/quán còn khả dụng hôm nay.

## Phạm vi dữ liệu

Chọn ba file `opportunity-results.json` mới nhất theo thời gian sửa file, không dùng con trỏ latest-run đã cũ. Bộ café là file kết quả lớn nhất của lượt tìm café. Mỗi hội thoại dùng snapshot hiện tại, không đếm mọi revision lịch sử thành bài riêng.

| Bộ | ID nguồn | Snapshot | Kích thước nguồn |
|---|---|---:|---:|
| Nhà trọ | crawl-3ff25a84-cc9b-4c7a-9543-0ab22827c386 | 557 | 7.388.366 byte |
| Bất động sản | crawl-dc867aca-820c-4b99-826e-31054b80d8fb | 681 | 9.424.837 byte |
| Gà ta | crawl-ebe12105-a34d-4fd7-95ed-698e8574f00d | 1.539 | 19.909.259 byte |
| Café | crawl-4e3faa2e-c67d-4353-86f8-734febb4b683 | 3.001 | 35.852.216 byte |

Tổng **5.778 hội thoại**. Ba snapshot gà ta chưa có hàng phân loại cũ vẫn được kiểm tra trong lượt mới.

Model thực chạy: **Gemini 3.5 Flash Lite**; kiểm định phạm vi dùng mức suy luận cao hơn. Windows User GEMINI_API_KEY được đọc lại khi tiếp tục; preflight ngày 02/11/2026 đã trả HTTP 200. Các chẩn đoán quota/billing/key trước đó được giữ trong artifacts, không chứa key.

AppData gốc không bị ghi đè. SHA-256 của file nguồn được kiểm tra trước/sau. Kết quả mới nằm riêng trong artifacts. Tái dùng checkpoint chỉ sau khi xác minh tính tương thích của campaign, hợp đồng và bằng chứng bằng code hiện tại. Khi bổ sung điều kiện bắt buộc mà không đổi nghĩa điều kiện cũ, chỉ kết luận âm đã có mâu thuẫn đủ chứng minh mới được tái xác minh; kết luận dương không được chuyển theo cách này. Kết luận âm ở bài gốc có bình luận phải chạy thêm bước kiểm tra bình luận. Các lỗi kỹ thuật được chạy lại; kết luận ngữ nghĩa không được chạy lại chỉ để đạt kỳ vọng.

## Kết quả kiểm chứng

Đã kiểm chứng đủ cả bốn bộ trên code cuối. Cả bốn summary đều complete=true; không còn lỗi API/schema hoặc kiểm chứng kỹ thuật chưa xử lý. Các kết luận hợp lệ được giữ qua checkpoint sau khi tái xác minh; chỉ phần chưa có kết quả hợp lệ hoặc không còn đáp ứng validator mới phải đánh giá lại.

| Bộ | Phù hợp | Không phù hợp | Chờ đủ bằng chứng | Lỗi kỹ thuật |
|---|---:|---:|---:|---:|
| Nhà trọ | 0 | 508 | 49 | 0 |
| Bất động sản | 468 | 211 | 2 | 0 |
| Gà ta | 18 | 1.478 | 43 | 0 |
| Café | 1.319 | 1.655 | 27 | 0 |
| **Tổng** | **1.805** | **3.852** | **121** | **0** |

**Đây là số quyết định của model, không phải accuracy.** Không tìm được phòng đủ bằng chứng không có nghĩa dữ liệu chắc chắn không có phòng phù hợp.

Các ca hồi quy có kỳ vọng định trước của ba bộ đầu đạt **13/15**; hai ca khác được đánh dấu cần xem xét, không chấm. Café đạt **9/10** ca có kỳ vọng định trước. Tổng **22/25** ca có chấm khớp kỳ vọng, kèm hai ca chỉ đánh dấu xem xét. Ba ca không khớp là nhà trọ vệ sinh chung, gà/trứng với lời phủ định và khách xin menu dưới tin tuyển dụng café. Các kỳ vọng do tác nhân đọc và ghi nhận, chưa được người dùng xác nhận thành nhãn chuẩn; không suy rộng tỷ lệ này ra toàn bộ dữ liệu.

## Sai sót và giới hạn còn thấy trong dữ liệu thật

- Nhà trọ `1460078205233323` và `2690263698017297`: LLM dùng “Vệ sinh chung” để kết luận vi phạm “không chung chủ”. Đây là suy diễn không đủ bằng chứng; điều kiện đó phải chưa rõ. Các điều kiện tiện nghi khác vẫn cần được đánh giá riêng.
- Nhà trọ `2922430571472391`: model để tiêu chí phòng sinh viên chưa rõ dù bài có hashtag phòng sinh viên. Đây là ca cần kiểm tra độ bao quát; không thể diễn giải số 0 phù hợp thành không có phòng nào đáng xem.
- Gà ta `3989728600843708534`, `4004068050383752019`: tên “ức gà” và thiếu thông tin giống gà/chung cư bị diễn giải quá chắc thành không đúng mục tiêu. Thiếu dữ kiện cần được phân biệt với bằng chứng mâu thuẫn.
- Gà ta `4019146993825711817`, `3984267313679594138`: một tên gà không rõ và một lời nhờ mua mang tính đùa được nhận; chưa thể coi là khách mua đúng sản phẩm đã được xác minh.
- Bất động sản `3872643073839417809`: ranh giới giữa quy hoạch và câu hỏi về sân vận động/nhà hát cần người dùng phân xử. Bài bán đất Thanh Hóa `25650605387907911` hiện vẫn phù hợp nhưng không được cộng ưu tiên miền Bắc.

Chi tiết mẫu đọc tay ở `artifacts/goal-filter-v3-appdata-20261102/manual-final-review.json`. Mẫu có chủ đích để tìm lỗi, không đại diện ngẫu nhiên. Bộ lọc đã có kiểm soát bằng chứng và khả năng giải thích tốt hơn, nhưng chưa đủ cơ sở để gọi là phân loại hoàn toàn tin cậy mà không có người xem lại.

Hai nhãn giúp thao tác và đo kết quả rõ hơn; phần cải thiện hiểu mục tiêu đến từ hợp đồng mục tiêu, bằng chứng và kiểm định, không đến từ việc đổi tên hoặc gộp nhãn. Campaign lịch sử giữ chính sách đã chạy; giao diện chỉ gộp hai nhóm âm cũ khi xem. Chọn **Tái lọc dữ liệu đã lưu** để đánh giá lại theo RC6.


Hai vấn đề còn thấy ở café cần được phân biệt:

- Ca `3989616233687278369`: bài gốc tuyển nhân viên, nhưng bình luận `3990745149030427338` xin menu và nói sẽ ghé quán. Lượt kiểm tra đã chọn đúng bình luận này nhưng kiểm định phạm vi vẫn loại. Đây là lỗi ngữ nghĩa còn tồn tại; không sửa tay nhãn hoặc chạy lại chỉ để đạt kỳ vọng.
- Quảng cáo thi công quán `4019422286960638823`, thác nước trang trí `4019422048044013404` và vách bong bóng `4019421629545105046` được nhận ở nhánh quảng cáo liên quan và đứng đầu danh sách. Nhánh nghiên cứu chưa giới hạn rõ liên hệ với nhu cầu chọn quán; thứ tự cũng chưa phân biệt mục tiêu chính với tư liệu nghiên cứu phụ. Điều này không nhất quán với ca quảng cáo vật liệu mái được loại.

Hướng cải tiến rút ra từ kiểm thử là: làm rõ phạm vi “quảng cáo liên quan” khi xác nhận mục tiêu; quy định thứ tự ưu tiên giữa các nhánh; kiểm định chặt quan hệ suy ra từ trích dẫn (thiếu thông tin khác với mâu thuẫn); và dùng tập nhãn do người dùng xác nhận để đo cả nhận sai lẫn bỏ sót. Đây là các phát hiện cho vòng tiếp theo, chưa được mô tả như những lỗi đã sửa.

Lỗi kỹ thuật cuối được sửa từ dữ liệu thật: các bình luận có ID nhưng không có nội dung/span không được đưa vào danh sách ứng viên cho LLM. Nếu chỉ có các bình luận rỗng và bài gốc không phù hợp, hội thoại chờ bổ sung dữ liệu. Một ca nhà trọ và hai ca café được kiểm tra theo quy tắc này. Không biến lỗi trích dẫn thành nhãn âm.

## Kiểm thử phần mềm và bản giao

- **950/950 unit tests đạt**; typecheck đạt.
- Electron UI smoke đạt: trả lời mục tiêu tự do, tiêu chí/từ khóa, hai nhóm kết quả, trạng thái chờ, nhãn cũ và trích dẫn điều kiện. Ảnh và JSON: `artifacts/goal-filter-v3-appdata-20261102/ui/`.
- Portable build thành công. Sáu file đóng gói liên quan được đối chiếu byte với dist.
- File: `release/CSD-Portable-0.3.0-rc.6.exe`.
- SHA-256: `b6a3d72b2664f45281513f1352611d8139fd4152fb456a55489f65f4c165fff0`.
- Đóng CSD cũ trước khi mở RC6 để tránh khóa một phiên ứng dụng.

## Tái lập và đọc kết quả

Harness: `scripts/benchmark/goal-filter-appdata.mjs`; phase latest trước, cafe sau. Kết quả cuối ở `artifacts/goal-filter-v3-appdata-20261102/runs/79e7d0b062d1d85e/`.

Để xuất lại, chạy `node scripts/benchmark/summarize-goal-filter.mjs artifacts/goal-filter-v3-appdata-20261102 79e7d0b062d1d85e` để tạo JSON/Excel cho từng bộ cùng bảng chuyển nhãn. Script này không gọi model và xác minh lại hash nguồn.

Thư mục báo cáo: `artifacts/goal-filter-v3-appdata-20261102/report/`. File report.json ghi đủ số lượng, lý do chờ/lỗi, hợp đồng và chuyển nhãn. Mỗi workbook có GoalEvidence để truy về điều kiện, trích dẫn và đối tượng được chọn. Thống kê chi phí gộp tất cả probe/retry/worker, khử trùng invocation ID; đây là ước lượng theo token/list price, **không phải hóa đơn**. Những cuộc gọi bị ngắt khi chưa có usage được ghi cận trên riêng.


- [Báo cáo máy đọc và bảng chuyển nhãn](C:/OwnProject/crawl-socials/artifacts/goal-filter-v3-appdata-20261102/report/report.json).
- Excel: [Nhà trọ](C:/OwnProject/crawl-socials/artifacts/goal-filter-v3-appdata-20261102/report/housing.xlsx), [Bất động sản](C:/OwnProject/crawl-socials/artifacts/goal-filter-v3-appdata-20261102/report/property.xlsx), [Gà ta](C:/OwnProject/crawl-socials/artifacts/goal-filter-v3-appdata-20261102/report/chicken.xlsx), [Café](C:/OwnProject/crawl-socials/artifacts/goal-filter-v3-appdata-20261102/report/cafe.xlsx).
- [28 nhận xét kiểm tra thủ công](C:/OwnProject/crawl-socials/artifacts/goal-filter-v3-appdata-20261102/manual-final-review.json).
- [Xác minh số dòng workbook và nguồn không đổi](C:/OwnProject/crawl-socials/artifacts/goal-filter-v3-appdata-20261102/report/artifact-verification.json).
- [Bản portable RC6](C:/OwnProject/crawl-socials/release/CSD-Portable-0.3.0-rc.6.exe).

Ước lượng theo bảng giá token đang cấu hình, gộp toàn bộ probe/retry/worker của đợt kiểm chứng: **53,57 USD** đã có usage; phần cuộc gọi chưa ghi nhận usage có cận trên riêng **1,34 USD**. Tổng 3.583 lần thử, 3.408 cuộc gọi có kết quả thành công. Con số này bao gồm các vòng phát triển và lần thử trước khi xử lý key/quota, không phải chi phí riêng một lần chạy cuối, không phải số tiền đã bị trừ hoặc hóa đơn của Google.
