# Benchmark intent café — 30/10/2026

Người dùng yêu cầu benchmark trước tích hợp, xác nhận dùng bộ café gốc với nhu cầu review/trải nghiệm, hỏi quán, café làm việc/học và địa điểm hẹn hò; loại quảng cáo, tuyển dụng, sang nhượng và nội dung ngoài mục tiêu. Chưa tích hợp bộ lọc vào ứng dụng.

## Nguồn và đơn vị đo

Dữ liệu thật nằm ngoài repository tại `%APPDATA%/csd-desktop/data/collections`, không cần dùng bản Excel dự phòng trong Downloads.

| Nguồn | Tập | Bài/ID duy nhất | Text chuẩn hóa duy nhất | SHA-256 của posts.json |
| --- | --- | ---: | ---: | --- |
| Facebook | coffee-20261028 | 1.156 | 1.146 | 3bbdbdc90b66e379a41d3e488429eb42bbd4dab5b2bb4bf01313d3d5a05795ab |
| Threads | threads-coffee-20261029 | 1.004 | 953 | 1f8b7e5b4e1cdca4492c23a1cf39033d491705b3023244013deefdb2235e64d4 |

Không có text rỗng. Cả hai tập có `text_completeness=UNKNOWN`; không có nội dung bình luận. JSON và JSONL khớp theo ID. Đơn vị chính là post ID, chưa loại các ID có cùng text; yield sau exact-text dedup được báo riêng. Không dùng latest-run vì đã chuyển chủ đề.

Tất cả dữ liệu, URL, nhãn, đầu vào mô hình và response nằm ngoài repo tại `%APPDATA%/csd-desktop/data/benchmarks/coffee-intent-20261030`. Mô hình chỉ nhận ID mờ và text đã che URL/email/số điện thoại; không nhận tên tác giả, nguồn, tương tác, nhãn tham chiếu hay các bài gốc chưa che thông tin liên hệ.

## Tham chiếu đã đóng băng

`prepare-intent-benchmark.mjs` chọn ngẫu nhiên xác định bằng hash: 150 bài evaluation và 20 bài development mỗi nền tảng. Development không trùng cụm text với evaluation. Phần còn lại vẫn được chạy để đo yield toàn tập. Mẫu evaluation giữ phân phối post ID tự nhiên, không cân bằng lại nhãn.

Hai ngữ cảnh AI độc lập đọc và gán nhãn 300 bài theo `coffee-intent-rubric-v1.txt`; một lượt phân xử xử lý bất đồng và kiểm tra biên. Đóng băng trước khi có prediction Gemini thành công.

| Mẫu | ACCEPT | REJECT | UNCERTAIN | Tổng |
| --- | ---: | ---: | ---: | ---: |
| Facebook | 42 | 94 | 14 | 150 |
| Threads | 54 | 78 | 18 | 150 |
| Tổng | 96 | 172 | 32 | 300 |

Hai lượt AI đồng ý quyết định 287/300 (95,67%) trước phân xử; đây không phải độ chính xác bộ lọc. Có 16 dòng được phân xử/kiểm tra bổ sung. `reference-final.jsonl` SHA-256: `981699e11528376fb021854171ae6a3beeae386ef82bd809a27f7e73a5a2cee6`.

**Trạng thái: AI_ADJUDICATED_NOT_HUMAN_VALIDATED.** Chưa có nhãn nào được người duyệt. Hai AI có thể cùng sai. `human-review.jsonl` chứa nội dung, nhãn, bằng chứng và trường trống cho người duyệt; ưu tiên các trường hợp chưa rõ/bất đồng. Không gọi đây là gold chuẩn đã nghiệm thu.

## Phép đo và giới hạn

- Precision = TP/(TP+FP), chỉ trên tham chiếu ACCEPT/REJECT. Bài mô hình nhận nhưng tham chiếu UNCERTAIN được báo riêng.
- Recall = TP/(TP+FN) trên các bài tham chiếu ACCEPT; abstain hoặc thiếu output trên bài dương là bỏ sót. Recall chỉ trong tập ứng viên đã crawl, không phải toàn Facebook/Threads.
- Yield = số ACCEPT / toàn bộ bài thô của từng nền tảng, chỉ kết luận khi xử lý đầy đủ. Đây là tỷ lệ mô hình giữ, chưa đồng nghĩa tỷ lệ bài đúng.
- Báo confusion matrix, UNCERTAIN, output lỗi/thiếu, coverage, exact-text dedup, Wilson 95% cho các tỷ lệ mẫu. Khoảng Wilson không phản ánh sai số nhãn AI hay phụ thuộc giữa các bài trùng text.
- Chi phí dựa trên usageMetadata của mọi attempt và đơn giá công bố; gồm output/thinking/cache, retry và output lỗi. Không suy ra số tiền trên hóa đơn hay free-tier/credit từ response API. Không có usage thì không ghi chi phí đo được bằng 0.
- Bộ dữ liệu mỗi mạng mới khoảng 1.000 bài; mục tiêu 1.000 bài tinh từ 2.000–3.000 bài thô chưa thể được kiểm chứng trực tiếp. Các phép quy đổi là ước tính có điều kiện, chưa gồm crawl, bình luận, hạ tầng hay người gán nhãn.

## API và cấu hình

Key cũ: 6 attempt development đều HTTP 402 hết prepayment, không có completions/usage. Giữ log `gemini-dev`; không resume log cũ sau thay đổi prompt/config.

Key mới đọc lại từ biến môi trường Windows User `GEMINI_API_KEY`, không ghi key vào file/log. Kiểm tra ngày 30/10/2026: 2.5 Flash-Lite trả 404; 3.1 Flash-Lite trả HTTP 200, JSON đúng schema, 10 input + 5 output token, khoảng 0,97 giây. Log không có bí mật: `api-health-latest.json`. Google hiện giới hạn 2.5 cho project đã dùng trước đó; models.list thành công không đảm bảo gọi inference được. [Lịch model](https://ai.google.dev/gemini-api/docs/deprecations).

Baseline chuyển sang `gemini-3.1-flash-lite`, thinking minimal, temperature 0, JSON có schema và kiểm bằng chứng trích nguyên văn. Standard text pricing kiểm ngày 30/10/2026: $0,25 input, $1,50 output gồm thinking, $0,025 cached input / 1 triệu token. [Giá chính thức](https://ai.google.dev/gemini-api/docs/pricing), [thinking](https://ai.google.dev/gemini-api/docs/thinking).

Runner giới hạn chi phí trước mỗi attempt, lưu request/response/usage và kiểm model/prompt/input hash khi resume. Dừng toàn lượt khi gặp billing/auth/quota vĩnh viễn. Không biến output lỗi thành REJECT và không tự retry để ép nhãn.

Development 40 bài với 3.1: 6 request HTTP 200, 33 output hợp lệ, 7 output lỗi (5 trích dẫn không nguyên văn/quá dài, 2 decision không khớp reason). Usage quy đổi $0,00917475, lưu tại `gemini-3.1-dev-v1`. Chỉ dùng development để làm rõ hướng dẫn trích một cụm ngắn, giữ nguyên khoảng trắng và không dùng REJECT khi thiếu ngữ cảnh; rubric/ngữ nghĩa và nhãn evaluation không đổi. Không xem prediction evaluation để chỉnh prompt.

Development v2 sau hướng dẫn trên: 39/40 hợp lệ, chi phí token quy đổi $0,00896475. Lượt toàn tập đầu (`gemini-3.1-flash-lite-v1`, batch 8) dừng sau 158 output hợp lệ/168 bài có response, $0,04125525. Nguyên nhân thực là hạn mức **15 request/phút Free Tier**, không phải hết số dư: HTTP 429 có quotaId `GenerateRequestsPerMinutePerProjectPerModel-FreeTier`, quotaValue 15. Runner trước đó nhầm câu chung “check ... billing details” là lỗi quota vĩnh viễn. Sửa nhận diện từ structured quota, bổ sung giãn thời gian request; giữ log cũ làm bằng chứng. Chuyển batch 32 để giảm số request của lượt chính từ 271 xuống 69; thử lại development với cùng batch trước khi chạy. Chưa dùng prediction evaluation để chọn/chỉnh ngữ nghĩa.

Hạn mức Free Tier do API xác nhận; số tiền hóa đơn chưa được kiểm. Các số USD ở báo cáo là token thực tế nhân đơn giá Paid Tier để đánh giá khả năng triển khai thương mại, không phải khẳng định tài khoản đã bị trừ đúng số tiền đó.

Development với cấu hình batch 32 có 20 bài mỗi nền tảng: 39/40 hợp lệ, 2 request, $0,006444475. Lượt chính `gemini-3.1-flash-lite-b32-v1` dùng tối đa 32 bài/request, concurrency 3, khoảng cách khởi phát tối thiểu 4.500 ms (khoảng 13,3 request/phút), giới hạn $2. Không thay prompt/ngữ nghĩa sau development v2.

File `human-review.xlsx` bên cạnh dữ liệu chứa 300 dòng, ID/text/evidence/nhãn AI và 900 ô nhãn/intent/ghi chú của người duyệt còn trống; có lọc, cố định tiêu đề và dropdown quyết định. Nội dung dài được giữ đầy đủ; 11 bài vượt chiều cao hiển thị tối đa một hàng Excel, cần xem qua formula bar. Không tự tính nhãn AI thành nhãn người.

Lượt chính đầu tiên hoàn tất 69 request trong 309,582 giây: 1.969/2.160 output hợp lệ, 159 output lỗi và 32 bài trong một request timeout. Usage trả về quy đổi $0,331813425; request timeout không có usage, trần dự phòng chi phí $0,0293825. `summary-first-pass.json` giữ snapshot trước lượt phục hồi 191 ID lỗi/thiếu; không retry những quyết định hợp lệ.

Lưu vết tái sử dụng tại thư mục lượt chính: `filter-snapshot.json` chứa nguyên system prompt, rubric, model/config, giới hạn token và giá; `runner-source.mjs` và `rubric.txt` giữ byte nguồn. Hash prompt đã kiểm khớp manifest. Snapshot không chứa API key hay bài thô.

Quy tắc trước lượt toàn tập: giữ nguyên mọi output hợp lệ; cho phép một lượt resume chỉ các ID có output lỗi/thiếu để phục hồi định dạng. Tính toàn bộ chi phí lượt đầu và phục hồi; nếu vẫn thiếu thì báo coverage và chưa chốt yield đầy đủ, không chạy lại chỉ vì không đồng ý nhãn.

## Công cụ tái lập

- `scripts/benchmark/prepare-intent-benchmark.mjs`: snapshot, chuẩn hóa, che liên hệ, chia mẫu.
- `scripts/benchmark/coffee-intent-rubric-v1.txt`: quy tắc intent và evidence.
- `scripts/benchmark/finalize-intent-reference.mjs`: ghép hai lượt nhãn và phân xử.
- `scripts/benchmark/intent-gemini.mjs`: chạy Gemini, resume, log, budget.
- `scripts/benchmark/evaluate-intent-benchmark.mjs`: kiểm prediction và tính chỉ số độc lập.

## Kết quả sơ bộ sau một lượt phục hồi

Đã thử toàn bộ 2.160 bài. 76 request trong lượt chính và phục hồi, 75 request có usage, một request timeout; tổng thời gian tiến trình 342,278 giây (không gồm khoảng dừng giữa hai lệnh). Không phát sinh HTTP 429 sau khi giới hạn nhịp gọi. 2.103 output hợp lệ; 57 output vẫn lỗi và được giữ riêng, không chuyển thành REJECT.

| Chỉ số | Facebook | Threads |
| --- | ---: | ---: |
| Bài thô | 1.156 | 1.004 |
| Output hợp lệ | 1.131 | 972 |
| ACCEPT | 463 | 407 |
| REJECT | 648 | 520 |
| UNCERTAIN | 20 | 45 |
| Output lỗi còn lại | 25 | 32 |
| Được giữ / toàn bộ bài thô | 40,05% | 40,54% |
| ACCEPT sau exact-text dedup nghiêm ngặt | 460 | 404 |
| Evaluation có output hợp lệ | 145/150 | 146/150 |
| TP / FP / FN hiệu dụng | 38 / 14 / 4 | 51 / 10 / 3 |
| Precision trên nhãn đã xác định | 73,08% | 83,61% |
| Wilson 95% precision | 59,75–83,23% | 72,39–90,84% |
| Recall, gồm lỗi/abstain như bỏ sót | 90,48% | 94,44% |
| Wilson 95% recall | 77,93–96,23% | 84,89–98,09% |
| ACCEPT nhưng tham chiếu UNCERTAIN | 7 | 4 |
| Precision nếu các nhãn chưa rõ là sai→đúng | 64,41–76,27% | 78,46–84,62% |
| Token cost đã đo, USD | 0,215820675 | 0,145655 |
| Trần chi phí thiếu usage, USD | 0,0293825 | 0 |
| USD/1.000 output hiện được giữ | 0,466–0,530 | 0,358 |

**Precision/recall là so với tham chiếu AI, chưa phải chất lượng được người xác nhận.** Mẫu evaluation còn thiếu 5 output Facebook và 4 Threads; precision chỉ dựa các output hợp lệ, recall phạt thiếu output trên bài dương. Khoảng theo nhãn chưa rõ là identification bounds, không phải khoảng tin cậy. Tỷ lệ giữ 40% là kết quả vận hành đã quan sát (ACCEPT hợp lệ / mọi bài thô), không phải chứng nhận 40% bài đúng hay dự báo cuối cùng nếu sửa hết lỗi. `metrics.json` giữ `acceptance_yield=null` vì chưa đủ output; bounds khi xử lý nốt bài lỗi là 40,05–42,21% Facebook và 40,54–43,73% Threads, không cộng UNCERTAIN vào ACCEPT.

Tổng lượt chính: 527.426 input token (3.957 cached), 153.673 output token, 0 thinking token được báo; token quy đổi **$0,361475675**, cộng dự phòng timeout thành tối đa **$0,390858175** trong mô hình tính giá này. Toàn bộ các lượt development/chạy thử và lượt chính có usage quy đổi $0,4273149, chưa gồm hai health check rất nhỏ; phần timeout dự phòng như trên. Không có lỗi đối chiếu chi phí giữa runner và evaluator. Không khẳng định số tiền bị trừ vì API cho biết đang áp dụng quota Free Tier và chưa kiểm hóa đơn.

Chi phí $/1.000 output được giữ trong bảng là chi phí của những kết quả đã xuất, gồm mọi request của lượt chính và phục hồi, không phải $/1.000 bài đã được chứng nhận đúng. Đơn giá này thấp hơn ngân sách mục tiêu nhưng chất lượng vẫn chưa đủ để kết luận đã đạt yêu cầu.

## Điều học được

Baseline keyword giữ tất cả có precision trên nhãn đã xác định là 30,88% Facebook, 40,91% Threads, recall 100% trong chính tập đã thu. LLM tăng độ tinh đáng kể nhưng vẫn nhận nhầm 24 bài bị tham chiếu loại: 14 Facebook, 10 Threads. Kiểm tra lỗi cho thấy quảng cáo từ người cung cấp, lời mời sự kiện/giao lưu và nội dung chỉ liên quan chủ đề là các nhóm cần xử lý tiếp. Bốn bài dương bị REJECT, hai bị UNCERTAIN, một thiếu output tạo thành bảy FN hiệu dụng.

Sau phục hồi, 57 lỗi kỹ thuật gồm 34 evidence không đúng nguyên văn và 23 cặp REJECT/INSUFFICIENT_CONTEXT không nhất quán (23 trường hợp này ở Threads). Đây là lỗi có thể giải quyết bằng thiết kế đầu ra: trả một mã lớp thống nhất rồi suy ra decision/reason, và chọn ID đoạn văn có sẵn để hệ thống trích nguyên văn. Chưa triển khai hoặc đo phiên bản đó trong benchmark này.

TP xác định trong mẫu / mọi bài mẫu là 38/150 (25,33%) Facebook và 51/150 (34%) Threads. Nếu mẫu và nhãn đại diện cho các lượt sau, quy đổi điểm là khoảng **3.947 bài thô Facebook** và **2.941 bài thô Threads** cho 1.000 TP xác định; không tính các bài tham chiếu chưa rõ là đúng. Đây là ngoại suy chưa kiểm chứng, không phải cam kết throughput. Facebook cần cải thiện truy vấn/nguồn để tiến gần mục tiêu 2.000–3.000 bài thô; tăng tỷ lệ nhận của bộ lọc đơn thuần có thể đưa thêm quảng cáo vào.

## Bước tiếp và đầu ra

1. Người duyệt xác nhận 300 nhãn trong `human-review.xlsx`, ưu tiên các bất đồng và nhãn chưa rõ. Chưa sửa nhãn đóng băng theo prediction để làm đẹp điểm.
2. Phiên bản thử tiếp xử lý sự nhất quán schema/evidence, rồi kiểm tra bổ sung quảng cáo rõ ràng ở các bài ACCEPT. Cần đo lại chi phí, không giả định vòng lọc thứ hai miễn phí.
3. Tách một holdout mới trước khi dùng phân tích lỗi của 300 bài này để tinh chỉnh; giữ nhãn/prompt phiên bản để so sánh trung thực. Thử cải thiện query trước khi tích hợp production.

Đầu ra ngoài repo: `metrics.json`, `analysis-summary.json`, `error-audit.json`, `disagreements-model.jsonl`, `pending-review.jsonl`, `accepted-facebook.jsonl`, `accepted-threads.jsonl`, `human-review.xlsx`; thư mục lượt chính giữ manifest, snapshot bộ lọc, toàn bộ request/response/usage và prediction. Các file ACCEPT là kết quả mô hình, không có nhãn chứng nhận của người. Audit độc lập đọc đủ 50 bất đồng và 57 lỗi còn lại, kiểm lại confusion matrix và chi phí đạt; 19/50 bất đồng liên quan nhãn tham chiếu UNCERTAIN nên không coi cả 50 là lỗi chắc chắn.

Lệnh tái lập (PowerShell, chạy ở root repository; dùng thư mục output mới nếu đổi cấu hình; lệnh runner dưới đây sẽ resume các ID chưa hợp lệ nếu chạy lại):

```powershell
$env:GEMINI_API_KEY = [Environment]::GetEnvironmentVariable('GEMINI_API_KEY', 'User')
$benchmarkDir = Join-Path $env:APPDATA 'csd-desktop\data\benchmarks\coffee-intent-20261030'
node scripts/benchmark/intent-gemini.mjs --data "$benchmarkDir\population.jsonl" --rubric scripts/benchmark/coffee-intent-rubric-v1.txt --out "$benchmarkDir\gemini-3.1-flash-lite-b32-v1" --model gemini-3.1-flash-lite --input-rate 0.25 --output-rate 1.50 --cached-input-rate 0.025 --batch-size 32 --concurrency 3 --min-request-interval-ms 4500 --max-usd 2
node scripts/benchmark/evaluate-intent-benchmark.mjs --benchmark "$benchmarkDir" --run "$benchmarkDir\gemini-3.1-flash-lite-b32-v1"
```

Đã kiểm syntax các script, mock schema/evidence, hash/resume, budget, token-cost, quota và throttle; chạy thực tế như trên. Workbook lưu lại đủ 300 dòng, 900 ô nhãn người trống, dropdown/counter kiểm đạt. Không có thay đổi production, crawl mới, hoặc tích hợp bộ lọc trong lượt này. Trạng thái kế tiếp là duyệt nhãn người và thiết kế phiên bản thử mới, không phải chờ API key.
