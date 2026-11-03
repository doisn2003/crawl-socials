# ADR-025 — Phát triển lại CSD với chi phí được kiểm soát

- Ngày: 03/11/2026, Asia/Bangkok.
- Phạm vi lượt này: lập kế hoạch, kiểm tra thông tin model và tổ chức Git. Chưa triển khai runtime mới.
- Nền: `csd-next-rc7-20261103`, commit `c4c48ed9ec0389ab4e504777a6cbbde1375301f0`.
- Nhánh hiện hành: `codex/csd-rebuild`.
- Thay quyết định vận hành của ADR-023/024 cho phần phát triển mới; giữ các mốc cũ để đối chiếu.

## 1. Vấn đề và trách nhiệm

Người dùng báo AI Studio đã ghi nhận 40 USD sử dụng, trong đó 17 USD đã trừ từ thẻ Visa qua thanh toán tự động. Đây là số người dùng kiểm tra trên nhà cung cấp, không phải số đã được đối soát bằng ledger của CSD. Hai lượt piano mới nhất chỉ giải thích khoảng 5,6567 USD chi phí theo token usage tại giá gateway; không được coi chúng là toàn bộ hóa đơn 40 USD.

RC7 đã tăng số cửa sổ và yêu cầu AI đồng thời trước khi chứng minh chi phí cho mỗi bài được giữ và chất lượng có ích. Đây là thiếu sót của quá trình phát triển. Kiểm thử phần mềm đạt không bù được việc kết quả ít, chi phí cao hoặc loại nhầm nhu cầu thật.

Mục tiêu mới: có một đường thu thập hữu ích không dùng API trả phí; thêm AI theo mức lọc người dùng chọn; mỗi thử nghiệm có giới hạn tiền, đầu ra có thể kiểm tra và một giả thuyết cụ thể.

### Bằng chứng đã xác minh

| Chỉ số | Lượt 11:59 ngày 03/11 | Lượt 12:18 ngày 03/11 |
|---|---:|---:|
| Cửa sổ collector | 4 | 6 |
| Bản ghi crawler | 524 | 433 |
| Bài gốc vào bộ lọc | 522 | 428 |
| Phù hợp / không phù hợp / chưa xong | 116 / 218 / 188 | 108 / 138 / 182 |
| Lần gọi AI | 235 | 178 |
| Chi phí ước tính USD | 2,8175232 | 2,8391890 |
| Token đầu ra, gồm thinking | 1.028.991 | 1.054.093 |
| Tỷ trọng chi phí đầu ra | 91,30% | 92,82% |
| Nguyên nhân dừng | MODEL_BUDGET_EXHAUSTED | HTTP 402 / MODEL_BILLING_EMPTY |

Hai lượt không có lỗi HTTP 429 trong ledger. Lượt sau mới bắt đầu 3/8 từ khóa trên mỗi mạng; chưa thu bình luận. Hai và năm bản ghi chênh với số bài gốc là trả lời Threads không có root_post_id trong bản xuất thô. Không cộng kết quả hai lượt thành số người duy nhất.

Một lỗi đã xác nhận: phụ huynh tìm giáo viên piano cho con được vòng đầu nhận SUITABLE, rồi vòng kiểm định đổi sang NOT_SUITABLE vì hiểu sai vai trò. Cần giữ trường hợp này trong bộ hồi quy. Chưa đo tỷ lệ sai trên toàn bộ dữ liệu.

Nguồn kiểm tra: hai collection `crawl-6b59136f-a4e7-4219-9c13-559d90077c15` và `crawl-9a6373d3-414d-4e3a-9172-076fd0e38220`; aggregate và hash trong [evidence](../evidence/csd-rebuild-baseline-20261103.json). Dữ liệu thô và script đọc chỉ nằm ở AppData/artifacts, không đưa vào Git.

## 2. Quyết định model và quản lý chi phí

**Người dùng đã chọn Gemini 2.5 Flash-Lite**, sau khi làm rõ lựa chọn 3.1 hay rẻ hơn 3.1. Dùng `gemini-2.5-flash-lite` cho phân rã, hỏi làm rõ và các mức lọc có AI. Không tự chuyển sang model đắt hơn khi lỗi hoặc thiếu quyền.

Giá Standard cho text, kiểm tra ngày 03/11/2026:

| Model | USD / triệu token đầu vào | USD / triệu token đầu ra |
|---|---:|---:|
| Gemini 2.5 Flash-Lite — được chọn | 0,10 | 0,40 |
| Gemini 3.1 Flash-Lite | 0,25 | 1,50 |
| Gemini 3.5 Flash-Lite — RC7 | 0,30 | 2,50 |

Đơn giá đầu ra của 2.5 thấp hơn 3.5 là 84%; đây không phải cam kết giảm tổng chi phí 84%, vì số token, số lượt sửa và chất lượng có thể thay đổi. [Giá chính thức](https://aistudio.google.com/docs/pricing#gemini-2.5-flash-lite).

Google hiện ghi 2.5 Flash-Lite chưa deprecated và còn qua API, nhưng có điều kiện truy cập với nhóm 2.5. GET metadata bằng key lấy từ cấu hình môi trường Windows trả HTTP 200 ngày 03/11, model version 001, có generateContent. Chưa gọi generateContent nên **chưa xác nhận quyền inference và trạng thái billing thực tế**. Nếu bị chặn thì giữ chế độ không lọc và báo đúng lỗi. [Vòng đời model](https://aistudio.google.com/docs/deprecations#gemini-2.5-flash-models).

### Những thay đổi phải làm trước khi thử AI trả phí

1. Một sổ chi phí phát triển dùng chung giữa script, app và worktree, ngoài Git; cộng ngân sách toàn đợt, không reset theo campaign. Có khóa/transaction để không vượt trần do chạy đồng thời.
2. Trước khi dispatch, giữ chỗ chi phí tối đa cho input/output; đối soát usage sau phản hồi. Yêu cầu gián đoạn chưa biết chi phí tiếp tục giữ khoản dự phòng sau restart.
3. Phân biệt đang thiếu chỗ vì request khác còn chạy với đã hết ngân sách thực: đợi request đang chạy quyết toán trước khi báo hết tiền. Không hủy cả pipeline do một batch lớn chưa đặt được chỗ.
4. Tách trần phát triển, trần mỗi lượt người dùng, trần chi tiêu CSD cộng dồn/ngày do người dùng chọn và giới hạn lưu trữ. Tạo lượt mới không reset trần cộng dồn. Mọi planner/clarifier/reviewer/retry/background job đều phải đi qua một bộ kiểm soát chi phí; không có đường gọi fetch riêng bỏ qua hạn mức. Đổi ngày chỉ ảnh hưởng ngân sách ngày, không xóa lịch sử hoặc ngân sách toàn đợt phát triển.
5. Hiển thị đã dùng, đang dự phòng, còn lại và giới hạn đã chọn. Sổ CSD là chi phí ước tính, không đại diện số dư/hóa đơn toàn tài khoản Google hoặc ứng dụng khác.
6. Thinking của 2.5 mặc định tắt cho phân rã và Standard; Quality chỉ tăng khi thử nghiệm nhỏ chứng minh đáng giá. Dùng tham số hợp lệ của 2.5 (`thinkingBudget`), không gửi `thinkingLevel` của 3.x.
7. Metadata và giá theo model riêng. Không gán quota 4K RPM của 3.5 cho 2.5, cũng không dùng nhầm giới hạn Free Tier 13 RPM/500 RPD đang hardcode cho mọi model khác 3.5. Giới hạn concurrency ban đầu nhỏ, tách khỏi số cửa sổ; điều chỉnh bằng quota thực và số đo.
8. Không tự bật theo dõi/revisit/sửa format vô hạn. Mỗi batch có số lần thử và trần token hữu hạn; lỗi lặp giữ lại để xử lý sau. Cache theo nội dung, phiên bản mục tiêu, mode, model và recipe; metadata like/view thay đổi không đủ để gọi lại AI.
9. Giữ ledger của model cũ để tính tiền đã dùng và audit. Chuyển model cho một lượt cũ là revision rõ ràng, không sửa nhãn/model quá khứ hoặc đọc nhầm giá. App RC7 đã phát hành không tự đổi model khi chỉ sửa kế hoạch.

### Ngân sách phát triển

- Lượt lập kế hoạch này: **0 yêu cầu sinh nội dung**; chỉ GET metadata, đọc tài liệu và dữ liệu cục bộ.
- Coding, typecheck, unit tests, replay parser và UI fixture: mặc định **0 USD API**.
- Phép thử inference sau khi có guard: đề xuất tối đa **0,10 USD / phép thử**, tối đa **1 USD cộng dồn cho đợt đánh giá đầu**, kèm giới hạn số call/số bài trước khi chạy. Đây là đề xuất để cấp ngân sách, chưa phải quyền tự tiêu tiền.
- Không chạy lại toàn bộ 5.778 bài chỉ vì sửa prompt. Tái sử dụng snapshot/cache; chạy tập nhỏ rồi mới mở rộng trong ngân sách được cấp.
- Không tự thay đổi auto-reload/billing của Google. Chặn chi tiêu CSD không ngăn chi tiêu từ các phần mềm khác hoặc thanh toán tự động do Google quản lý.

## 3. Electron — một từ khóa, một tác vụ/cửa sổ

Ý tưởng mở riêng từng từ khóa đúng ở việc tách công việc và tăng độ phủ sớm. Đơn vị thực tế là `(mạng xã hội, hồ sơ, từ khóa)`: 8 từ khóa trên 2 mạng là 16 tác vụ; Top/Recent là trạng thái của cùng tác vụ, không nhân đôi cửa sổ mặc định.

Giới hạn cứng 2–3 cửa sổ/mạng trong RC7 là lựa chọn triển khai bảo thủ, chưa dựa trên profiling của máy người dùng. Thiết kế mới:

- Mỗi tác vụ có query, cursor, checkpoint, trạng thái, số bài mới/trùng và lý do dừng riêng; có thể sở hữu một BrowserWindow riêng.
- Có chế độ mở toàn bộ tác vụ song song khi tài nguyên đủ. Khởi động lệch nhau để tránh dồn việc tải trang trong cùng một thời điểm.
- Mặc định điều phối tự động: tăng dần số cửa sổ đang hoạt động, đo RAM/CPU/thời gian phản hồi; pause/checkpoint tác vụ khi có áp lực rồi tiếp tục sau. Giảm số cửa sổ không làm mất query khỏi kế hoạch.
- Máy đo tại thời điểm lập kế hoạch có khoảng 15,9 GiB RAM, 6 logical processors, còn 4,8 GiB RAM. Chưa đo bộ nhớ cho mỗi cửa sổ Facebook/Threads; không lấy một con số RAM giả định làm kết luận 16 cửa sổ chắc chắn chạy tốt hoặc chắc chắn không chạy được.
- Khi số tác vụ lớn hơn số cửa sổ có thể chạy, cấp lát xử lý ngắn cho mỗi query trước khi đào sâu tiếp. Thử 2–3 trang mỗi lát như tham số ban đầu rồi đo; không cho query đầu chiếm toàn bộ thời gian.
- Chung session theo hồ sơ, observer gắn đúng webContents. Không chia sẻ cursor giữa query. Giới hạn/cảnh báo từ mạng xã hội được xử lý theo đúng hồ sơ; thêm cửa sổ không tạo thêm quyền/quota của nhà cung cấp.
- UI cho thấy tác vụ đã chạy, đang chờ, hết nguồn hoặc lỗi. Không gọi hoàn tất khi còn query chưa chạy mà không ghi rõ nguyên nhân.

Mỗi BrowserWindow có renderer riêng, nên RAM/CPU có liên quan thực tế. Tuy nhiên, giới hạn tài nguyên chỉ nên điều khiển số tác vụ hoạt động, không được làm mất kế hoạch tìm kiếm. [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model), [đo hiệu năng](https://www.electronjs.org/docs/latest/tutorial/performance).

Không hứa “không bỏ sót mọi bài”: kết quả tìm kiếm có ranking, giới hạn truy cập/phân trang và bài không được trả về. Cam kết có thể kiểm tra là mọi query được ghi nhận và mọi batch đã nhận được lưu trước khi checkpoint; truy vấn chưa chạy được báo rõ.

## 4. Thu thập và AI hoạt động độc lập

```mermaid
flowchart LR
  A["Từ khóa nhập tay hoặc kế hoạch đã lưu"] --> B["Tác vụ riêng theo mạng và từ khóa"]
  P["Phân rã bằng 2.5 Flash-Lite khi bật AI"] --> B
  B --> C["Lưu bền vững và khử trùng theo ID"]
  C --> D["Không lọc: xuất bài chưa đánh giá"]
  C --> E["Hàng đợi đánh giá có ngân sách"]
  E --> F["Tiêu chuẩn: một đánh giá ngắn"]
  F --> G["Chất lượng: kiểm tra bổ sung có chọn lọc"]
  F --> H["Tập kết quả chung, không chia tỷ lệ mạng"]
  G --> H
```

- Ghi dữ liệu thô trước, checkpoint sau. Dedup trong transaction theo `(platform, root_post_id)` và alias URL đã xác minh; giữ provenance của tất cả query tìm ra bài đó.
- Không xóa hai nhu cầu khác người chỉ vì câu chữ giống nhau. Trùng nội dung giữa hai mạng được đánh dấu nghi ngờ; chỉ gộp khi có bằng chứng cùng bài/thực thể. Mục tiêu là số bài/hội thoại, không tự đổi thành số người duy nhất.
- AI hết tiền, hết quota, timeout hoặc thiếu key chỉ làm hàng đợi AI tạm dừng. Crawler tiếp tục đến trần bài thô, dung lượng, mục tiêu đã đạt hoặc người dùng dừng.
- Backpressure theo byte/hàng đợi trên đĩa được công khai; bỏ phụ thuộc cứng “128 job phân loại thì dừng lấy trang” đang trói tốc độ crawl vào AI. Khi chạm giới hạn thật thì pause có checkpoint, không bỏ bản ghi.
- Người dùng có thể thu trước, lọc sau và đổi mức lọc trên dữ liệu đã thu. Không phải crawl hoặc phân rã lại nếu đầu vào/mục tiêu không đổi.
- Chỉ thay đổi bằng chứng ảnh hưởng ngữ nghĩa mới tạo yêu cầu đánh giá mới; gộp các cập nhật gần nhau. Không lặp lại đánh giá toàn bài vì mỗi lần nhìn thấy cùng bài hoặc thay đổi counter.
- Xử lý dở dang, model error và thiếu bằng chứng có trạng thái vận hành riêng. Không ép chúng vào nhãn không phù hợp và không tính như kết quả đạt.

## 5. Thanh gạt ba mức lọc

Tên mode thể hiện công việc thực hiện, không phải phần trăm trí thông minh của model. **Không có nút “dùng 50% năng lực LLM” có thể đo trực tiếp.** Giảm chi phí bằng số vòng, lượng đầu ra, phạm vi kiểm chứng và tái sử dụng kết quả.

| Mức | Hành vi | Đếm mục tiêu | Chi phí model |
|---|---|---|---|
| Không lọc — mặc định lần đầu | Giữ bài tìm được, bỏ trùng chính xác và bản ghi kỹ thuật lỗi; xuất trạng thái chưa đánh giá | N bài gốc duy nhất | 0; không khởi tạo planner/classifier/reviewer/watch |
| Tiêu chuẩn | Một lần đọc ngữ nghĩa theo batch; xét chủ đề, vai và mục đích, bằng chứng ngắn; không kiểm định lại mọi bài | N bài được mức Tiêu chuẩn nhận | 2.5 Flash-Lite; đầu ra gọn, trần chi phí riêng |
| Chất lượng | Tái dùng kết quả Tiêu chuẩn; kiểm tra thêm ca có ràng buộc khó, mâu thuẫn hoặc bằng chứng yếu | N bài được mức Chất lượng nhận | Cùng model; tối đa một lượt bổ sung cho mỗi phiên bản bằng chứng |

### Không lọc thực sự miễn phí API

Nhập trực tiếp danh sách từ khóa hoặc dùng lại kế hoạch đã lưu. Phân rã/hỏi ngược bằng LLM là thao tác có phí riêng, chỉ có khi người dùng bật AI; không gọi ngầm rồi ghi “miễn phí”. Không tự tạo từ khóa giả và gắn nhãn LLM. Không gắn SUITABLE cho bài chưa đánh giá.

### Tiêu chuẩn

- Giữ mục tiêu và các nhánh HOẶC đã chốt. Người đăng, người đại diện và người thụ hưởng tách nhau: phụ huynh tìm giáo viên cho con là nhu cầu học; hỏi mua/mượn/thuê là các ý riêng, không tự thay cho nhau.
- Mỗi câu trả lời chỉ cần ID, kết quả theo mode, vai/mục đích, quote hoặc span thực và lý do ngắn. Không trả lại ma trận 15 tiêu chí với quote lặp cho mỗi nhánh. Bằng chứng và kiểm tra ràng buộc bắt buộc vẫn được giữ.
- Mục tiêu kỹ thuật ban đầu: khoảng 80–160 token đầu ra/bài, batch bị chặn bởi token/byte chứ không chỉ số bài. Đây là mục tiêu để đo, không được cắt mất bằng chứng quyết định để đạt định mức.
- Ưu tiên độ bao phủ; thiếu thông tin phụ không tự thành lý do loại. Không coi ràng buộc bắt buộc đã đạt khi không có bằng chứng. Mơ hồ thật sự giữ trạng thái chưa quyết định và cho người dùng thấy.
- **Trên 60% bài được nhận là đúng nhu cầu** là mục tiêu nghiệm thu trên tập kiểm tra có nhãn, chưa phải thuộc tính đã đạt và không phải confidence do LLM tự chấm.

### Chất lượng

- Chọn trường hợp cần kiểm tra theo dữ kiện: phủ định, ràng buộc số/địa lý, người đại diện, bằng chứng từ bình luận, bất đồng vai/mục đích. Không gọi lại toàn bộ tập đầu ra theo mặc định.
- Vòng sau phải chỉ rõ tiêu chí và bằng chứng làm thay đổi quyết định. Nếu hai vòng mâu thuẫn mà chưa giải quyết được, giữ cả kết quả để xem lại; không lấy vòng sau làm chân lý và loại bài tự động.
- Không tự tăng model và không mở vòng thứ ba để chữa tiếp. Cache đánh giá theo recipe/mode/model; ngân sách mỗi mode vẫn nằm trong ngân sách tổng.
- Kiểm chứng thêm phải làm chất lượng đo được tốt hơn Tiêu chuẩn. Theo dõi cả bài đúng bị bỏ sót; không gọi “chất lượng” chỉ vì tập kết quả ít hơn.

Mốc chi phí mục tiêu ban đầu, cần đo trên mẫu trước: Tiêu chuẩn tối đa 0,20 USD / 1.000 bài gốc được đánh giá; Chất lượng tối đa 0,50 USD / 1.000 bài. Planner ghi riêng và tính vào tổng tiền lượt chạy. Không dùng các mốc này để hứa đủ 1.000 bài phù hợp, vì tỷ lệ phù hợp chưa biết. Tối ưu token/lượt gọi trước khi tăng ngân sách.

## 6. Bỏ chia tỷ lệ Facebook/Threads

Thay `threadsShare`, `desired_platform_weights` và mọi `platformTargets` bằng chính sách `GLOBAL_FIRST_QUALIFIED`.

- Không thay 70:30 bằng 50:50. Mọi mạng dùng chung một mục tiêu N; không có mức tối thiểu hoặc hạn mức kết quả riêng cho một mạng.
- Khi một bài duy nhất được đánh giá đủ điều kiện, transaction cấp `accepted_sequence`. N bài đầu theo thứ tự này là kết quả mục tiêu; không đợi nền tảng còn lại bù tỷ lệ.
- Không lọc dùng thứ tự ghi nhận bài gốc mới; các mức có AI dùng thứ tự quyết định đủ điều kiện hoàn tất. Đây không phải thứ tự ngày đăng bài.
- Khởi động các nguồn bình đẳng và giữ hàng đợi công bằng khi thiếu slot. Công bằng quyền chạy không đồng nghĩa chia đều số kết quả.
- Khi đủ N, dừng nhận trang mới, hoàn tất lưu batch đã nhận. Phần vượt N do yêu cầu đang chạy được lưu riêng, không xóa; UI phân biệt tập N mục tiêu và phần bổ sung.
- Ranking trong tập đã nhận dùng tính phù hợp/khả năng hành động/ngày đăng, không cộng điểm mặc định cho Threads hay Facebook. Metadata nguồn vẫn để kiểm tra.
- Dữ liệu cũ giữ nguyên phiên bản policy/nhãn để audit. Tiếp tục một lượt cũ dưới quy tắc mới tạo revision/migration có backup; không âm thầm dùng lại tỷ lệ cũ hoặc sửa file export cũ.

Các điểm cần thay gồm config/preset/draft, compiler, retained import, pipeline target/stop, progress, renderer và cooler. Chỉ bỏ dropdown ở giao diện là chưa hoàn tất.

## 7. Các chặng triển khai và tiêu chí bàn giao

| Chặng | Công việc | Bằng chứng phải có trước khi sang chặng tiếp |
|---|---|---|
| R0 — kế hoạch và mốc Git | ADR này, model đã chọn, baseline/chi phí, giữ mốc RC7 | Hoàn thành trong lượt này; không paid inference |
| R1 — chặn chi phí, đổi model | Guard dùng chung; 2.5 routing/thinking/pricing; chặn fallback; giữ ledger; mọi script cùng policy | Mock chứng minh không gọi khi hết budget, không reset sau restart, concurrent reserve đúng; metadata 200 chỉ là kiểm tra ban đầu |
| R2 — đường thu miễn phí và mục tiêu chung | OFF không gọi model; raw store/AI queue độc lập; bỏ tỷ lệ nền tảng; bộ đếm toàn cục | Fake gateway có call count=0; đủ N dù chỉ một nguồn có kết quả; model pause không làm mất crawl; Stop/Resume giữ dữ liệu |
| R3 — một tác vụ/cửa sổ mỗi query | Tạo đủ task, adaptive windows, lát thời gian, dedup và checkpoint | Fixture 8 từ khóa × 2 mạng; mọi query có trạng thái; không lẫn observer/cursor; đóng/crash một cửa sổ không phá cửa sổ khác; đo RAM/CPU thực |
| R4 — Tiêu chuẩn | Quyết định gọn một lượt; vai/người thụ hưởng; reuse bằng chứng; UI thanh gạt | Hồi quy trường hợp phụ huynh, cung/cầu, mua/thuê/mượn; đo token/bài và false negative trên mẫu cố định |
| R5 — Chất lượng | Kiểm tra có chọn lọc, tối đa một lượt bổ sung, xử lý bất đồng và cache | Không có vòng lặp tốn tiền; so sánh với Standard trên cùng tập; không tự loại ca bất đồng |
| R6 — thử nhỏ và bản ứng viên | Mẫu có nhãn, đo thật trong envelope được cấp, người dùng thử | Số bài thô/đúng/bị bỏ sót, giá mỗi 1.000 đầu vào và mỗi bài đúng, thời gian, độ phủ query, RAM; rồi mới quyết định phát hành |

R2 là bàn giao hữu ích đầu tiên: thu và xuất không tốn API, không phải chờ hoàn thiện bộ lọc. R3 không phụ thuộc việc dùng hết hạn mức Gemini. Không thay những mốc này bằng chỉnh giao diện thương mại hoặc thêm provider không cần thiết.

### Kiểm thử tiết kiệm nhưng có ý nghĩa

- Dữ liệu piano và bốn bộ AppData trước đó được đọc lại như fixture; nguồn gốc giữ nguyên. Parser/dedup/queue/UI chạy offline.
- Tập ca hồi quy gồm lỗi đã biết; không dùng tỷ lệ đạt trên tập tuyển chọn này làm precision thực tế.
- Chuẩn bị một mẫu ngẫu nhiên cố định khoảng 100 bài gốc piano đã khử trùng giữa hai lượt, gồm cả bài bị loại và chưa xử lý; gán nhãn từ nội dung trước khi xem nhãn candidate. Mẫu độc lập dùng đánh giá, không dùng để chỉnh prompt rồi báo điểm trên chính mẫu đó.
- Báo precision = bài nhận đúng / bài được nhận; recall = bài đúng được nhận / tổng bài đúng trong mẫu; ghi số mẫu và ca chưa đủ dữ kiện. Tập nhỏ chỉ cho bằng chứng bước đầu, không bảo đảm mọi chủ đề >60%.
- Trước paid sample, một kiểm tra cực nhỏ của 2.5 để xác minh generation access trong envelope đã được cấp. Metadata 200 không thay thế phép kiểm tra này. Nếu thất bại, không retry liên tục và không đổi model đắt hơn.
- Mỗi vòng cải tiến nêu giả thuyết, thay đổi, chi phí và kết quả. Chỉ chạy phần bị ảnh hưởng; suite toàn bộ ở mốc tích hợp. Chưa cần đào tạo model/RL: vòng phản hồi là cải tiến có kiểm chứng, không tuyên bố model tự học từ feedback.

## 8. Git và quay lại cải tiến từng phần

Một nhánh tích hợp mới `codex/csd-rebuild` từ RC7, tại workspace gốc. Các nhánh dài hạn cũ được giữ làm checkpoint; không xóa worktree, reset hoặc rebase lịch sử đã bàn giao.

Khi bắt đầu từng chặng, tạo nhánh ngắn `codex/csd-r1-cost`, `codex/csd-r2-raw`, `codex/csd-r3-windows`, `codex/csd-r4-standard`, `codex/csd-r5-quality` từ rebuild mới nhất. Chưa tạo hàng loạt nhánh rỗng. Mỗi chặng có commit rõ phạm vi, kiểm tra rồi merge `--no-ff` vào rebuild. Interface dùng chung/migration tách commit khi cần.

- Tag hiện có `csd-next-rc7-20261103` giữ nguyên.
- Tag kế hoạch mới: `csd-rebuild-plan-20261103` — chỉ chứng nhận kế hoạch/Git, không phải bản phần mềm đã hoạt động.
- Khi từng bản chạy đạt tiêu chí mới tạo tag `csd-rebuild-rN-YYYYMMDD`; không gắn tag hoàn tất trước khi có bằng chứng.
- Giữ raw collector và filter engine qua interface/version riêng. Khi bộ lọc chưa đạt, sửa nhánh lọc hoặc chọn mode OFF/recipe cũ tương thích; không quay lùi cả crawler.
- Revert một thay đổi phải xét phụ thuộc. Git không tự bảo đảm code sau revert vẫn tương thích; tag/worktree là mốc để đối chiếu, không thay kiểm thử.
- `codex/csd-production` và remote chưa nhận bản rebuild. Chỉ promote mốc đã được người dùng chấp nhận; local commit không được trình bày như đã publish.
- File xuất bài người dùng đang có trong workspace, AppData, API key và portable không được stage/commit. Không sửa bộ dữ liệu để làm đẹp kết quả đo.

## 9. Trạng thái sau lượt lập kế hoạch

Đã tạo nhánh, ghi kế hoạch/giới hạn phát triển và lưu bằng chứng aggregate; GET model metadata thành công. R1–R6 còn phải triển khai. Runtime/binary RC7 đang có vẫn giữ hành vi cũ cho tới khi bàn giao bản mới; chưa được gọi là đã đổi model hay đã có bộ lọc ba mức.
