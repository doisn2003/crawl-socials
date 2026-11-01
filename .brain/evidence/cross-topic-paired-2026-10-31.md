# Kiểm tra chéo piano/HUST — 31/10/2026

**Kết luận: chưa đủ chất lượng để nghiệm thu bộ máy đa chủ đề; không bật bộ lọc 2.1 mặc định.** Hai phiên bản chạy cùng 323 snapshots: 250 piano và 73 HUST, không có captured comments. Đây là đánh giá thăm dò trên dữ liệu thật đã lưu, không phải kiểm chứng độ bao phủ tìm kiếm hoặc chất lượng comment.

Hai lượt gán nhãn độc lập phủ đủ 323 ID/lượt. Phân xử từng ca trong 54 trường hợp khác nhãn, chưa rõ hoặc khác bằng chứng dương tính; giữ 269 consensus. Final reference còn 41 unresolved, được đóng băng trước API đầu tiên, SHA-256 `11b29e82af3f82899c55b7a781c036b20a9d9d53ccf9de55a972e5d04711e66e`. Đây là **tham chiếu AI, không phải human gold**. Giữ nguyên các tệp nhãn gốc và runtime/manifest đã đóng băng.

## Chỉ số trên tham chiếu đã phân xử được

| Chủ đề/nguồn | Policy | Precision | Recall | Model chọn / toàn mẫu | Pending |
| --- | --- | ---: | ---: | ---: | ---: |
| Piano/Facebook | 2.0.3 | 16/16 = 100% | 16/17 = 94,1% | 16/100 | 0 |
| Piano/Facebook | 2.1.0 | 15/15 = 100% | 15/17 = 88,2% | 15/100 | 10 |
| Piano/Threads | 2.0.3 | 16/27 = 59,3% | 16/17 = 94,1% | 30/150 | 2 |
| Piano/Threads | 2.1.0 | 13/23 = 56,5% | 13/17 = 76,5% | 26/150 | 30 |
| HUST/Facebook | 2.0.3 | 2/2 = 100% | 2/4 = 50% | 2/26 | 0 |
| HUST/Facebook | 2.1.0 | 2/2 = 100% | 2/4 = 50% | 2/26 | 2 |
| HUST/Threads | 2.0.3 | 3/4 = 75% | 3/3 = 100% | 5/47 | 0 |
| HUST/Threads | 2.1.0 | 3/4 = 75% | 3/3 = 100% | 7/47 | 7 |

Model chọn gồm cả reference unresolved: piano Threads 3 ca ở mỗi policy; HUST Threads 1 ca ở 2.0.3 và 3 ca ở 2.1.0. Các ca này không được tính là đúng trong precision. Pending với reference dương tính vẫn là recall miss. Mẫu nhỏ có bất định lớn: precision piano/Facebook 2.0.3 Wilson95% 80,6–100%, piano/Threads 40,7–75,5%; HUST/Facebook 34,2–100%, HUST/Threads 30,1–95,4%. Không gộp trung bình đơn giản thành accuracy chung, không suy 100% từ 2 bài là chứng nhận chất lượng.

## Chi phí và lỗi

84 batches hoàn tất, 114 billable attempts có ledger finish. Tổng **$0.5430968**, cap $1, unmetered/reserved đều 0. Chi phí theo usage và price snapshot đã lưu, không phải hóa đơn.

| Policy | Assessed | Model chọn | Validation failures | Chi phí |
| --- | ---: | ---: | ---: | ---: |
| 2.0.3 | 321/323 | 53 | 0 | $0.1885566 |
| 2.1.0 | 274/323 | 50 | 48 | $0.3545402 |

2.1 có 46 `CLASSIFIER_BRAND_CONTEXT_UNSUPPORTED`, 1 validity contradiction và 1 thiếu deadline evidence; thêm 1 insufficient context thành 49 pending. 2.0.3 có 2 insufficient context. Không sửa output, nâng cap hoặc đổi model để làm đẹp số.

Chi phí exact theo policy/topic và token có trong báo cáo riêng. Một batch ở ranh giới mỗi topic chứa cả hai mạng, nên không phân bổ giả chi phí chính xác cho từng mạng. Không ngoại suy chi phí /1.000 bài đã xác nhận từ mẫu ít dương tính hoặc unresolved.

## Bằng chứng và quyết định tiếp

Private bundle: `C:/Users/Admin/AppData/Roaming/csd-desktop/data/benchmarks/cross-topic-20261031/`. [Báo cáo đầy đủ](C:/Users/Admin/AppData/Roaming/csd-desktop/data/benchmarks/cross-topic-20261031/summary.md), [số liệu JSON](C:/Users/Admin/AppData/Roaming/csd-desktop/data/benchmarks/cross-topic-20261031/summary.json), [scorer output](C:/Users/Admin/AppData/Roaming/csd-desktop/data/benchmarks/cross-topic-20261031/evaluation.json). Báo cáo có CI, bounds unresolved, denominator, paired-selection counts, token/cost và audit hashes; không chứa text mạng xã hội hoặc thông tin liên hệ cá nhân.

Khoảng tin cậy chỉ là xấp xỉ theo root, chưa tính phụ thuộc cùng tác giả/copy hoặc sai số của tham chiếu AI. Không có author-disjoint guarantee. HUST là census nhỏ của frame đã lưu. `paired_binary` là mức khớp lựa chọn SUITABLE, không phải accuracy ba nhãn. Hai ngành không đủ yêu cầu breadth ba ngành ngoài café.

Giữ 2.0.3 mặc định; chưa nghiệm thu production. Ưu tiên sửa hợp đồng output và phân biệt liên quan chủ đề với cơ hội tham gia ở mức thuật toán tổng quát, rồi kiểm chứng trên dữ liệu mới. Sau khi dùng các lỗi này để sửa, 323 mẫu trở thành development/regression set cho bản sửa. Lượt ngành thứ ba cần kiểm tra đồng thời collection và comment enrichment; không chỉ thay prompt trên cùng bộ café.
