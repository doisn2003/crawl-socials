# CSD — Vấn đề của nhánh hiện tại và hướng phát triển đề xuất

Ngày: **01/11/2026**, Asia/Bangkok. Workspace: C:/OwnProject/crawl-socials.

**Cập nhật checkpoint theo yêu cầu commit/push của người dùng:** baseline runtime/tests/benchmark RC4 đã được commit tại cee0e8b; tiện ích Excel cục bộ tại 0689653. Remote origin đã cấu hình tới https://github.com/doisn2003/crawl-socials.git. Check kiểu và 889/889 tests PASS trong lượt checkpoint. Mục 3 bên dưới ghi lại trạng thái trước checkpoint để giải thích vấn đề lịch sử, không phải khẳng định code vẫn chưa commit. Các hướng kiến trúc mới vẫn chỉ là tài liệu bàn giao; chưa triển khai hoặc merge main.

Tài liệu tổng hợp nghiên cứu code, dữ liệu và trao đổi với người dùng. **Đây là tài liệu bàn giao để quyết định hướng phát triển, không phải xác nhận đã triển khai kiến trúc mới.** Lượt này chỉ viết tài liệu và phân tích; không merge, reset, đổi nhánh, chạy crawler hoặc gọi LLM.

## 1. Điểm dừng và yêu cầu mới nhất

Mục tiêu lâu dài là bộ máy **đa chủ đề**, có khả năng thu 1.000 bài tinh tổng Facebook + Threads; ưu tiên Threads:Facebook 8:2 hoặc 7:3. Không nắn một dataset café để đủ số. Kỳ vọng 2.000–3.000 raw và dưới $3 API/1.000 đầu ra đúng cần được đo theo từng phạm vi; chưa phải bảo đảm mọi ngành.

Đã dừng cải tiến bộ máy sau lượt tai nghe theo yêu cầu người dùng. Sau đó hoàn tất hai yêu cầu hẹp: Excel theo cấu trúc café có comments, portable RC3; rồi nhập/lưu Gemini API key trong UI, portable RC4. Xem [báo cáo điểm dừng](.brain/reports/csd-progress-review-2026-10-31.md), [RC3](.brain/evidence/portable-excel-rc3-2026-10-31.md), [RC4](.brain/evidence/gemini-key-ui-rc4-2026-10-31.md).

Người dùng hiện muốn bàn kỹ tại chat mới về hướng sau:

- Nhiều cửa sổ Facebook/Threads tìm các từ khóa song song, đưa dữ liệu qua chống trùng vào kho chung.
- Dừng discovery khi tới giới hạn raw; phân loại vẫn chạy đồng thời phía sau kho.
- **Đầu ra sản phẩm đổi thành hai nhóm Phù hợp / Không phù hợp**, thay ba nhóm hiện tại. Code/schema/UI hiện chưa đổi.
- Bình luận có kho và cơ chế thu riêng, hoạt động ngay trong thời gian crawl từ khóa; thiết kế chi tiết phải được bàn ở chat mới.
- Planner phải có vòng hỏi–đáp có cấu trúc để hiểu nhu cầu, làm rõ đối tượng và phạm vi trước khi sinh/chốt truy vấn; không chỉ nhận một prompt rồi tự đoán toàn bộ mục tiêu.
- Quản lý nhiều cấu hình từ đầu vào đến kết quả, có version, vòng đời, tái lọc và gộp các bộ kết quả không trùng bài.
- Hướng sản phẩm có điều khiển từ xa, quyền sử dụng API theo gói mua, backup và tải dữ liệu từ xa. PostgreSQL trên Supabase là ứng viên để bàn; chưa chọn kiến trúc cloud hoặc triển khai dịch vụ.
- Chưa chọn A/B/C/D về Git; chưa cho phép tự merge hoặc bỏ nhánh.

Các đề xuất trong tài liệu này là phương án để thảo luận. Yêu cầu mới về hai nhóm phải được ưu tiên khi chốt thiết kế thay cho mô hình ba nhóm trong ADR-022 cũ; không tự sửa nhãn lịch sử.

## 2. Thành tựu cần giữ

| Thành phần | Khả năng đã có | Giới hạn cần nhớ |
| --- | --- | --- |
| Electron và phiên đăng nhập | Facebook/Threads, phiên persistent, portable | Chưa hỗ trợ nhiều cửa sổ độc lập trên cùng profile theo kiến trúc mới |
| Thu/lưu/lọc | Lưu raw trước, phân loại đồng thời; hai nền tảng thu song song | Trong từng nền tảng, các truy vấn còn chạy tuần tự |
| Dữ liệu hội thoại | Bài, comments, parent/root, evidence spans, snapshot/revision | Coverage bình luận hạn chế; dữ liệu thiếu không đồng nghĩa không có nhu cầu |
| Vận hành | Stop/Resume, durable jobs, chống trùng, budget ledger, backpressure | Cần thiết kế lại lifecycle nếu tăng số worker/browser window |
| Tái sử dụng | Campaign drafts/presets, tái lọc dữ liệu giữ lại, nguồn thư mục ngoài | Thư mục dữ liệu ngoài không phải registry nhóm/page/profile để đi crawl |
| UI và xuất dữ liệu | JSON, Excel có Conversations/Comments/DecisionHistory/Manifest; API key mã hóa trên Windows | Hai nhóm mới sẽ cần schema/export migration có version |
| Kiểm chứng | Hồ sơ RC4 ghi check/build và 889 tests PASS | Không chạy lại tests trong lượt tài liệu; không suy ra chất lượng ngữ nghĩa từ số tests |

Dataset café 1.000 bài được người dùng đánh giá khoảng 80% yêu cầu là tín hiệu sử dụng tích cực, không phải benchmark gold. Lượt tai nghe trước đó: 75/98 bài model chọn được tham chiếu AI xác nhận; precision Threads 88,1%, Facebook 53,3%; chỉ 29/310 bài được thử capture bình luận. Các số này không chứng minh chất lượng của mọi chủ đề hay model/version mới.

## 3. Trạng thái Git: nguyên nhân gây bối rối về phiên bản

Đọc tại thời điểm lập tài liệu, trước khi thêm chính tài liệu này:

| Lớp | Trạng thái quan sát |
| --- | --- |
| Nhánh hiện tại | codex/csd-production |
| main cục bộ | ac0994d; package.json trong commit ghi 0.1.0 |
| HEAD nhánh hiện tại | 2a6e4a9; package.json trong commit ghi 0.2.2 |
| Chênh lệch commit với main | main không có commit riêng; nhánh hiện tại ahead 3 commit |
| Working tree | package.json ghi 0.3.0-rc.4; 24 tracked files đã sửa, 131 untracked files theo status -uall |
| Staging / remote | Không có staged diff; không cấu hình Git remote tại thời điểm đọc |
| Artifact đã bàn giao | Portable RC4 có bằng chứng/hash riêng; tên version không tự chứng minh khớp source hiện tại |

**Nhiều phần planner/filter/comments/RC4 đang ở working tree, chưa nằm trong commit. Merge HEAD của nhánh chỉ mang các commit, không mang toàn bộ các file chưa commit.** Một phần sự bối rối đến từ việc đã phát hành artifact nhưng chưa hoàn tất checkpoint source và bản đồ version dễ hiểu. Không mặc định mọi file chưa commit đều do một agent tạo; cần review trước khi đưa vào baseline.

### Khuyến nghị A/B/C/D

| Lựa chọn | Đánh giá |
| --- | --- |
| A. Merge main rồi tiếp tục | Có thể làm sau checkpoint/review; merge ngay chưa giải quyết source chưa commit và cách quản lý recipe |
| B. Bỏ nhánh, làm lại từ đầu | Không khuyến nghị: mất nền Electron/session/storage/export/evidence đã dùng được; lỗi chủ yếu tập trung ở các module có thể thay |
| C. Giữ thành tựu, bỏ cơ chế sai | Đúng ở mức kiến trúc; không nên hiểu là chọn vài file rồi cherry-pick mù khi các module đang phụ thuộc nhau và chưa thành commit |
| D. Tiếp tục từ nhánh hiện tại | Khuyến nghị trước mắt để bảo toàn trạng thái; checkpoint baseline trước, sau đó sửa từng module trên nhánh phát triển có tên rõ |

Trình tự đề xuất: kiểm kê và review working tree → tạo checkpoint source có chọn lọc, giữ cả tests/docs cần thiết → ghi manifest/tag baseline → phát triển thay đổi tách biệt, có thể trên codex/discovery-v2 từ checkpoint → merge main sau review/checks và ghi rõ mức chất lượng đã nghiệm thu. Tag baseline là mốc khôi phục, không đồng nghĩa production đã đạt. Những bước Git này **chưa được thực hiện** trong lượt tài liệu.

Không đưa dataset, API key, cookies, browser profile, app data hoặc release EXE vào source commit. Không dùng reset/clean/xóa nhánh để dọn phần việc chưa phân loại.

## 4. Bước đầu hiện thực sự làm gì: prompt → kế hoạch → queries

Nguồn chính: [compile-campaign.ts](src/application/compile-campaign.ts), [campaign-drafts.ts](src/application/campaign-drafts.ts), [campaign-plan.ts](src/domain/campaign-plan.ts).

### 4.1 Chuỗi xử lý

1. Nhận prompt, brand context, các constraint tường minh và seed queries nếu có.
2. Gửi cho Gemini một system prompt cố định trong code và đầu vào dạng JSON.
3. Yêu cầu model trả CampaignPlan theo JSON schema: topic, audience, needs, participation/research intents, inclusions/exclusions, assumptions, queries và constraint evidence.
4. Code kiểm tra và chuẩn hóa output, lọc queries, chống trùng, bổ sung explicit seeds; lưu kế hoạch và recipe/hash.
5. Người dùng có thể sửa draft. Query do người dùng sửa được coi là tường minh, không bị áp lại whitelist từ vựng của query tự sinh.
6. Khi chạy, pipeline lấy các query cho nền tảng và truyền danh sách text cho collector. Query family hiện chưa được dùng để đảm bảo phân bổ ngân sách hoặc độ phủ.

Đây là **LLM sinh kế hoạch dưới ràng buộc prompt/schema, sau đó code hậu kiểm**. Chưa có bộ phân rã ontology riêng, thuật toán mở rộng từ khóa học từ dữ liệu hay semantic retrieval trong đường chạy chính.

### 4.2 Cách điều khiển LLM và cấu hình

| Hạng mục | Hiện tại |
| --- | --- |
| Planner mặc định của campaign mới | grounded-constraints-v1; recipe campaign-planner-v1.2.1-grounded-constraints |
| Chỉ dẫn queries | Thường 8–24 queries; schema cho 4–48; từng query 2–5 phần cách nhau bằng whitespace |
| Từ vựng được phép | Từ xuất hiện trong prompt/brand/geography/seeds + tập DISCOVERY_WORDS cố định |
| Constraint | Quote chính xác từ prompt/brand, phân biệt REQUIRED/PREFERRED; trường mơ hồ vào unresolved |
| Primary model campaign mới trong source hiện tại | gemini-3.5-flash-lite nếu chưa có ledger/routing; run cũ giữ routing hoặc legacy 3.1 |
| Low-level gateway | Riêng hàm createGeminiGateway vẫn default 3.1; không dùng điều này để kết luận model của toàn ứng dụng |
| Request cho 3.1/3.5 Lite | systemInstruction + JSON input; responseMimeType application/json; responseJsonSchema; temperature 0; thinkingLevel minimal |
| Output planner | Grounded tối đa 9.000 tokens; legacy 6.000 |
| Vận hành gateway | Mặc định timeout 60 giây, tối đa 2 attempts, khoảng cách khởi tạo call 4,5 giây; serialize requests; shared budget/cache |
| UI chỉnh được | Prompt, brand context, target, tỷ lệ nền tảng, raw cap, budget, bật comments, draft criteria/queries, key |
| Chủ yếu nằm trong code | System prompt, JSON schema, whitelist từ, model routing default, generation parameters, taxonomy và ranking |

Nguồn: [campaign-model-gateway.ts](src/infrastructure/llm/campaign-model-gateway.ts), [gemini-gateway.ts](src/infrastructure/llm/gemini-gateway.ts), [user-config.ts](src/infrastructure/config/user-config.ts). Đây là cấu hình đọc từ source, không phải khẳng định mọi EXE/run lịch sử dùng cùng model. Temperature 0 và schema không bảo đảm kết quả ngữ nghĩa đúng hoặc tuyệt đối tất định.

### 4.3 Lỗi đã xác nhận trên bất động sản

Nguồn dữ liệu: C:/Users/Admin/Downloads/bds.json và app data của run crawl-dc867aca-820c-4b99-826e-31054b80d8fb. Không sao chép raw posts hoặc dữ liệu cá nhân vào tài liệu.

Planner trả 8 queries, hậu kiểm giữ 5. Ba query bị loại đều có 6 phần cách nhau bằng khoảng trắng:

- bàn luận đất đai quy hoạch
- bất động sản khu công nghiệp
- tìm mua đất đai nhà ở

Chúng bị chặn bởi giới hạn 5, dù các từ chủ đề đã có trong prompt. Không có bước tạo query thay thế để phục hồi nhánh bị mất. Ngoài ra, probe offline với prompt này cho thấy mua đất/bán đất/mua nhà/bán nhà được validator chấp nhận nhưng planner không sinh; chính chủ bán đất/cần mua mảnh đất/sổ đỏ bị whitelist chặn; đất/nhà đơn lẻ bị giới hạn tối thiểu 2 chặn.

**Cần sửa cả cách sinh lẫn cách kiểm tra.** Phát biểu 90–95% bài thực tế bị bỏ lỡ trong problems.md chưa có phép đo xác nhận; thiếu query không đủ để suy ra recall toàn mạng.

### 4.4 Yêu cầu mới: vòng lặp hiểu nhu cầu và hỏi ngược người dùng

Đây là khả năng cần bổ sung, chưa có đầy đủ trong planner hiện tại. Người dùng phải có thể diễn đạt tự nhiên; hệ thống giúp chuyển thành mục tiêu rõ ràng qua hội thoại, thay vì bắt họ tự viết một prompt hoàn hảo.

Luồng đề xuất: **prompt → bản hiểu nhu cầu → phát hiện điểm mơ hồ quan trọng → câu hỏi có cấu trúc → câu trả lời → cập nhật bản hiểu → kế hoạch có thể xem/sửa/lưu/chạy**. LLM không được tự biến một giả định thành yêu cầu đã được người dùng xác nhận.

Ví dụ với bất động sản:

| Trường cần làm rõ | Câu hỏi có thể hiển thị | Kiểu trả lời |
| --- | --- | --- |
| Đối tượng cần tìm | Bạn muốn tìm người đang rao bán, người đang hỏi mua, hay cả hai? | Chọn một trong ba phương án |
| Phạm vi thảo luận | Bạn có muốn lấy thêm các bài hỏi về pháp lý, quy hoạch hoặc kinh nghiệm giao dịch không? | Chọn nhiều chủ đề; có thể không chọn |
| Cơ hội mong muốn | Bạn muốn tìm đối tượng để cung cấp dịch vụ, hay tìm cuộc thảo luận để thương hiệu tham gia? | Chọn mục tiêu hoặc mô tả thêm |

Đây là ví dụ có điều kiện, không phải bộ câu hỏi bắt buộc cho mọi campaign. Prompt đã nói rõ người mua và người bán thì không hỏi lại; chỉ hỏi phần còn mơ hồ có thể làm thay đổi đáng kể kết quả. Mỗi lượt nên có ít câu hỏi ưu tiên, chẳng hạn 1–3, cho phép nhập tự do bên cạnh lựa chọn và quay lại sửa câu trả lời. Những mở rộng tùy chọn như pháp lý không được tự bật khi người dùng chưa chọn. Chưa trả lời câu hỏi quan trọng thì giữ draft; không lấy thời gian chờ hoặc lựa chọn được tô sẵn làm sự đồng ý.

LLM cần trả một cấu trúc để UI dựng câu hỏi, không chỉ đoạn văn chat. Ví dụ hợp đồng dự kiến, chưa phải schema runtime:

~~~json
{
  "state": "NEEDS_CLARIFICATION",
  "intent_revision": 2,
  "questions": [
    {
      "id": "target_role",
      "target_field": "target_roles",
      "type": "single_select",
      "prompt": "Bạn muốn tìm người đang rao bán, người đang hỏi mua, hay cả hai?",
      "options": [
        { "id": "seller", "label": "Người rao bán" },
        { "id": "buyer", "label": "Người hỏi mua" },
        { "id": "both", "label": "Cả hai" }
      ],
      "required": true,
      "reason": "Lựa chọn này quyết định loại bài được coi là phù hợp."
    }
  ],
  "unresolved_fields": ["target_roles"]
}
~~~

Code kiểm tra schema, question ID, kiểu câu hỏi, lựa chọn hợp lệ và revision mà câu trả lời thuộc về. Lưu cả câu trả lời gốc, giá trị cấu trúc, nguồn của điều kiện (prompt/câu trả lời/chỉnh sửa trực tiếp) và các giả định chưa xác nhận. Trả lời chậm cho một revision cũ không được âm thầm ghi đè bản mới.

Kết thúc vòng hỏi–đáp, hiển thị bản tóm tắt ngắn: tìm ai, để làm gì, nhận/loại trường hợp nào, phạm vi chủ đề/địa bàn/thời gian và kế hoạch truy vấn. Người dùng có thể sửa và lưu thành cấu hình dùng lại. Khi họ bấm chạy, đóng băng version của cấu hình; đổi yêu cầu sau đó tạo version mới. Nếu dữ liệu thăm dò cho thấy kế hoạch chưa hiệu quả, hệ thống được đề xuất mở rộng để người dùng chọn, không tự đổi mục tiêu đã chốt.

Hai đầu dùng cùng bản mục tiêu này: query planner sinh từ khóa theo đối tượng và phạm vi đã làm rõ; classifier nhận đúng các tiêu chí đó. Ví dụ chọn tìm người bán thì rubric phải có cách đánh giá người chào bán, tránh việc planner tìm người bán nhưng filter mặc định loại họ như quảng cáo.

## 5. Bước cuối hiện thực sự làm gì: ngữ nghĩa, phân loại và ranking

Nguồn chính: [classification-service.ts](src/application/classification-service.ts), [conversation-store.ts](src/infrastructure/storage/conversation-store.ts).

### 5.1 LLM chịu trách nhiệm gì?

Default filter là conversation-opportunity-v2.0.3. LLM nhận campaign và snapshot bài + comments, parent IDs, metadata, coverage, các đoạn text có evidence IDs. Ảnh/video chỉ có tín hiệu has_media; model không được cung cấp nội dung media để đọc hiểu trong đường chạy này.

System prompt chứa rubric cho 10 case codes và 6 ví dụ minh họa, trong đó nhiều ví dụ café. LLM trả cho mỗi snapshot: snapshot_id, case_code, evidence_ids, need_summary. Phần phán đoán liên quan chủ đề, nhu cầu và cơ hội **chủ yếu là prompt-based LLM classification có ví dụ**. Chưa có embedding classifier, model tự huấn luyện, calibrated probability hay learning-to-rank riêng trong đường chạy chính.

### 5.2 Code chịu trách nhiệm gì?

Code ánh xạ case thành nhóm:

| Case model chọn | Nhóm hiện tại |
| --- | --- |
| OPPORTUNITY_REQUEST / EXPERIENCE / DISCUSSION | Phù hợp |
| RELATED_PROMOTION / CHECKIN / NO_OPENING / RESOLVED / CONSTRAINT_MISMATCH | Chưa phù hợp |
| UNRELATED_TOPIC | Không phù hợp |
| INSUFFICIENT_CONTEXT | Pending; chưa có nhãn ngữ nghĩa đủ căn cứ |

Code kiểm tra snapshot, missing/duplicate/alien IDs, case hợp lệ, evidence tồn tại, action target thuộc đúng bài/comment. Evidence đầu tiên của kết quả Phù hợp xác định nơi nên tham gia. Các kiểm tra này xác nhận tính nhất quán và liên kết dữ liệu; không tự chứng minh model hiểu đúng nội dung.

Mỗi batch mặc định tối đa 8 snapshots; snapshot quá 120.000 ký tự spans được giữ pending cần windowing, không cắt âm thầm. Có vòng format recovery cho item lỗi; transport retry khác với sửa lỗi format. Verifier/escalation có code tùy chọn, không có nghĩa mọi lượt UI mặc định đều được hai model đọc chéo. Bản temporal 2.1 vẫn opt-in sau kết quả kiểm chứng chưa đạt.

Nói thẳng: nhận định của người dùng rằng đang nhờ LLM đọc và phân loại **đúng về phần quyết định ngữ nghĩa**. Xung quanh có kiểm tra, lưu vết, cache và quản lý lỗi/budget; không nên mô tả các lớp đó như bằng chứng đã có một thuật toán ngữ nghĩa riêng bảo đảm độ tinh.

### 5.3 Ranking khác phân nhóm

Ranking hiện là so sánh lần lượt: nhóm → REQUEST trước DISCUSSION trước EXPERIENCE → brand fit → participation context → freshness → source priority. SQL xếp trước LIMIT, UI/export dùng cùng quy tắc. Đây là sort theo quy tắc, không phải score có trọng số được học từ dữ liệu.

Schema v2.0.3 không buộc model trả các thuộc tính brand fit/freshness/participation, nên nhiều giá trị được code gán UNKNOWN. Trong 139 kết quả model-selected của bds.json, cả ba thuộc tính này đều UNKNOWN; 137 action targets ở POST, 2 ở COMMENT. Chưa có ranking theo độ đa dạng hoặc chất lượng tương đối trong toàn bộ tập ứng viên.

### 5.4 Xung đột tiêu chí cần giải quyết

Prompt bất động sản muốn cả người hỏi mua lẫn chào bán. Rubric mặc định lại coi nhà cung cấp chào bán chưa có câu hỏi người tiêu dùng là RELATED_PROMOTION. Cần xác định cơ hội theo mục tiêu campaign: tìm người mua, tìm người bán, hay tìm thảo luận để thương hiệu tham gia. Giữ mặc định đã thống nhất là thảo luận; việc bổ sung các mục tiêu khác cần bàn với người dùng.

Khi chuyển sang hai nhóm, đề xuất giữ riêng các trường relevance, reason, evidence, assessment_status. REJECT có thể là ngoài chủ đề, liên quan nhưng chưa có cơ hội, đã giải quyết hoặc không đáp ứng điều kiện. Pending/lỗi kỹ thuật không phải REJECT. Dữ liệu liên quan bị từ chối vẫn trong raw để nghiên cứu và có thể được đánh giá lại khi có comments mới; không cần duy trì giỏ Chưa phù hợp trên UI.

## 6. Discovery và comments: bằng chứng vận hành

| Vấn đề | Bằng chứng | Hệ quả |
| --- | --- | --- |
| Dừng theo đủ suitable | BDS Facebook chưa chạy 2/5 queries; Threads mới chạm 2/5; cả hai receipt INTENT_TARGET_REACHED | Các nhánh sau không được thăm dò |
| Đào sâu trước khi phủ rộng | Production config 20 scroll/query; từng nền tảng chạy queries tuần tự | Thứ tự query ảnh hưởng mạnh tới dữ liệu |
| Chưa có source discovery chuyên biệt | Facebook dùng search/top; source_priority chủ yếu ở ranking | Ưu tiên group/profile không tự làm crawler tìm trong group/profile |
| Ít bài được mở comments | Toàn database BDS: 38/681 roots có attempt, 643 chưa thử; tổng 288 comments | Nhiều cơ hội ở comments có thể chưa được nhìn thấy |
| Partial error kết thúc job | 16/38 captures có RESPONSE_READ_FAILED, coverage PARTIAL; jobs kết thúc SUCCEEDED | Không tự có retry chỉ vì partial read failure |
| Enrichment phụ thuộc query end | Tối đa 3 lượt sau mỗi query, final drain tối đa 12 mỗi nền tảng | Discovery dừng sớm làm giảm lượt đọc comments |
| Ranking có ít tín hiệu | Ba thuộc tính quan trọng UNKNOWN trên toàn 139 output BDS | Không phân biệt tốt cơ hội rất tốt và vừa đủ liên quan |

bds.json là export nhóm model chọn: 139 conversations, không phải toàn 681 raw. Số coverage 38/681 lấy từ database đầy đủ; không nhầm với 8/139 có attempt trong export. Các nhãn BDS chưa được đánh giá gold, không dùng 139 như số cơ hội xác nhận đúng.

Nguồn code: [opportunity-pipeline.ts](src/application/opportunity-pipeline.ts), [production-service.ts](src/application/production-service.ts), [discovery-frontier.mjs](scripts/discovery-frontier.mjs), [conversation-collector.mjs](scripts/conversation-collector.mjs).

## 7. Đánh giá hướng nhiều cửa sổ và kho chung

**Hướng này phù hợp để tiếp tục thiết kế.** Electron hỗ trợ nhiều cửa sổ dùng cùng persistent session. Nhưng nhiều cửa sổ không tự giải quyết query sai, phân loại sai, độ phủ hoặc giới hạn truy cập của cùng tài khoản. Cần phân biệt task tìm kiếm với số cửa sổ vật lý.

### 7.1 Thiết kế đề xuất để bàn

~~~mermaid
flowchart TD
  P[Prompt của người dùng] --> H[LLM lập bản hiểu nhu cầu]
  H -->|Còn điểm mơ hồ quan trọng| U[Câu hỏi có cấu trúc và câu trả lời]
  U --> H
  H -->|Đủ thông tin| K[Kế hoạch người dùng xem sửa và lưu]
  K --> Q[Danh mục query và nguồn]
  Q --> S[Bộ điều phối - giới hạn đồng thời và raw]
  S --> W[Nhóm cửa sổ tìm kiếm]
  W --> I[Ingest chung - chống trùng bằng ID]
  I --> R[Kho raw posts và observations]
  I --> J[Hàng chờ thu bình luận]
  J --> CW[Worker bình luận trong cùng lượt chạy]
  CW --> C[Kho comments liên kết root và parent]
  R --> V[Snapshot hội thoại có phiên bản]
  C --> V
  V --> F[LLM rubric và kiểm tra bằng chứng]
  F --> A[Phù hợp]
  F --> N[Không phù hợp - có lý do]
  I -. Số mới, trùng, backlog .-> S
  F -. Hiệu quả quan sát .-> S
~~~

Mỗi cửa sổ xử lý một task query tại một thời điểm, xong một phần thì nhận task khác. Ví dụ 20 query được phục vụ bằng vài cửa sổ có giới hạn, thay vì mặc định mở 20 cửa sổ. Có thể thử tăng từ 1 lên 2 cửa sổ/nền tảng để đo RAM, tốc độ, lỗi và yield; đây là giả thuyết thử nghiệm, chưa phải cấu hình đã nghiệm thu.

### 7.2 Các ràng buộc trong code hiện tại

- [browser-host.ts](src/infrastructure/browser/browser-host.ts) giữ một view/window cho mỗi profile. open cùng profile trả view cũ; observer cũng gắn theo profile. close profile đóng kết nối của session. Không thể chỉ chạy N collector với cùng profile và coi chúng là N cửa sổ độc lập.
- Collector hiện sở hữu vòng đời mở/đóng profile. Cần chuyển quyền sở hữu sang session manager/window manager, có windowId riêng và reference/lifecycle rõ ràng.
- Raw collector stores dùng Map trong bộ nhớ và file checkpoint/.next cố định. N writer instances cùng ghi một output directory có thể tranh ghi. Không nhân bản các store đó cho từng cửa sổ.
- Conversation store đã có single-writer lock/worker. Nên giữ một ingest/storage owner nhận sự kiện từ các collector, thay vì cho mỗi cửa sổ tự mở writer.
- Gateway model đang serialize requests. Tăng tốc browser phải đi cùng backpressure; không tự mở thêm model clients để vượt budget/throttle chung.

### 7.3 Kho chung và chống trùng

- Khóa post là platform + post_id; comments là platform + comment_id. Không dùng text giống nhau để xóa mất hai cuộc trao đổi độc lập.
- Gặp lại cùng post qua query khác: không tăng raw unique count, nhưng giữ provenance/query/window và cập nhật quan sát mới. Bài cũ có comments mới vẫn cần ingest và đánh giá lại.
- Fuzzy/embedding dedup chỉ hỗ trợ gom nội dung gần giống, giảm lặp trong ranking; không thay identity dedup.
- Một bộ đếm raw toàn campaign sau exact dedup; không cấp mỗi cửa sổ riêng N bài. Việc nhận ID mới và cập nhật counter phải nhất quán khi nhiều cửa sổ trả cùng lúc.
- Raw cap dừng các lệnh thu mới. Cần chốt cách tính batch đang về: giữ toàn bộ đã quan sát và báo phần vượt có giới hạn, hoặc tách admission cap và overflow backup. Không âm thầm bỏ raw đã nhận để làm số tròn.
- Đạt cap discovery không đồng nghĩa classifier/comments đã xong. Cần mốc hoàn tất riêng và ngân sách thời gian/model/comments riêng. Người dùng Stop vẫn phải dừng tất cả worker đúng hợp đồng.
- Cần quota thăm dò tối thiểu theo nhóm query: nếu các cửa sổ đầu chạy nhanh dùng hết cap thì nhiều query sau vẫn chưa được chạm, dù đã có song song.

### 7.4 Kho comments riêng

Đề xuất tách logic thành posts, comments, observations, capture_jobs và assessments; có thể cùng một SQLite database để giữ khóa liên kết/transaction. Kho riêng không nhất thiết là một database hoặc dịch vụ riêng.

Lưu root_post_id, parent_comment_id, platform, thời điểm quan sát, provenance, coverage và lỗi từng capture/nhánh. Comment tìm thấy trước root có trạng thái chờ resolve. Không cộng comment/reply candidate vào chỉ tiêu bài gốc.

Thu comment hiển thị trong response tìm kiếm ngay khi parser nhận diện được. Với comment chưa tải trên bề mặt tìm kiếm, cần task mở permalink/nhánh bình luận trong cửa sổ được cấp riêng hoặc time slice riêng. Không điều hướng cửa sổ đang tìm kiếm sang bài khác trong lúc observer còn hoạt động.

Comments có thể được thu đồng thời với discovery ở mức hệ thống; điều này không có nghĩa mỗi cửa sổ vừa cuộn search vừa điều hướng đọc một post. Pool và giới hạn hoạt động phải dùng chung theo profile/nền tảng.

Ưu tiên bài liên quan nhưng thiếu text, có dấu hiệu trao đổi, quảng cáo có khách hỏi và các trường hợp thiếu context; dành một mẫu thăm dò ngẫu nhiên để kiểm tra cơ hội bị bỏ sót. Retry lỗi kỹ thuật có giới hạn; partial, empty, inaccessible và exhausted cần phân biệt. Thiết kế phân trang/parent chains/coverage và watch phải được bàn riêng ở chat mới như người dùng yêu cầu.

## 8. Hướng thuật toán đề xuất

1. **Mục tiêu có cấu trúc qua hỏi–đáp:** xác định ai, nhu cầu gì, điều kiện và loại cơ hội được nhận; hỏi ngược những điểm mơ hồ quan trọng và lưu câu trả lời cùng phiên bản cấu hình. Giữ tiêu chí tìm kiếm và tiêu chí quyết định output nhất quán.
2. **Query expansion có kiểm soát:** tách constraint phải có căn cứ khỏi từ đồng nghĩa/cách nói thông dụng được phép thăm dò. Lưu nguồn gốc, nhánh ý nghĩa và lý do thêm/bỏ query; bảo đảm nhánh quan trọng có phương án thay thế.
3. **Phủ rộng trước, đào sâu sau:** thăm dò từng nhóm query/source với budget nhỏ, rồi phân bổ theo số cơ hội mới có bằng chứng, trừ ảnh hưởng trùng lặp và chi phí. Giữ ngân sách khám phá để tránh tự củng cố thiên lệch đầu vào.
4. **Nguồn và feedback:** phát hiện nguồn có ích từ search, duy trì registry profile/group/page đã xác minh có thể truy cập; dùng từ thực tế trong dữ liệu phù hợp để đề xuất query mới. Không tự giả định ngành ít thảo luận chỉ vì search hiện tại ít kết quả.
5. **Bình luận theo giá trị thông tin:** điều phối độ phủ trước khi chỉ tăng số comment tối đa/bài; phát hiện và phân tích nhánh trao đổi, không xem quảng cáo là lý do bỏ qua mọi comments.
6. **Eligibility trước ranking:** hai nhóm theo rubric campaign; bên trong Phù hợp xếp theo nhu cầu/bằng chứng/khả năng tham gia/độ mới đã biết. Không biến UNKNOWN thành tín hiệu tốt.
7. **Embedding đúng chỗ:** tìm lại kho lưu, gom từ/cụm nội dung, chọn nhánh comment, hỗ trợ reranking đa dạng. Không giả định vector search tự truy cập được toàn bộ Facebook/Threads. Chưa cần vector DB riêng hoặc learning-to-rank trước khi sửa các lỗi xác định được.

Giữ raw phục vụ nghiên cứu; ghi provenance và chiến lược lấy mẫu. Tập dữ liệu tối ưu cho cơ hội tham gia không tự là mẫu đại diện thị trường.

## 9. Quản lý version rõ hơn

Một tên 0.3.0-rc.4 không đủ mô tả hành vi. Mỗi bản build/run nên công bố manifest tối thiểu:

| Lớp version | Cần ghi |
| --- | --- |
| App/source | App version, Git commit, trạng thái dirty, build timestamp, artifact SHA256 |
| Planner | Policy/version, system prompt + schema + validator hash |
| Model | Model ID, model_version trả về nếu có, generation settings, routing changes |
| Campaign | Prompt/constraints/overrides, phiên hỏi–đáp và answer provenance, config version, plan hash và query plan revision |
| Filter | Rubric/schema/validator version, model configuration, nhãn binary/legacy |
| Ranking | Policy version, thứ tự/weights, diversity policy nếu có |
| Storage/export | Schema và migration version, dataset membership/snapshot watermark, sync/backup format, cấu trúc workbook |
| Evaluation | Bộ dữ liệu/tham chiếu/version, phạm vi và kết quả kiểm chứng |

Hiện đã có planner-recipe.json, filter-recipe.json, ranking-recipe.json, campaign.json, model-routing.json, ledger/cache và mismatch checks khi Resume. Cần giữ những bảo vệ này, bổ sung manifest cấp release và UI giải thích phiên bản. Pin/hash không biến provider model alias thành model snapshot bất biến.

Thay rubric/validator phải tạo version mới; run cũ tiếp tục recipe cũ hoặc được nâng cấp bằng thao tác có lưu vết. Dữ liệu ba nhóm lịch sử giữ nguyên; phiên đánh giá binary mới có context/version riêng, không sửa ngược nhãn cũ.

## 10. Lưu trữ, vòng đời cấu hình/dữ liệu, gộp kết quả và tái lọc

Yêu cầu mới là người dùng quản lý được nhiều cấu hình và các kết quả liên quan trong một thư viện. Chọn SQLite hay PostgreSQL chỉ là một phần; cần định nghĩa đối tượng và quyền sở hữu trước. Một cấu hình có nhiều lượt chạy; một bài có thể xuất hiện trong nhiều lượt chạy hoặc bộ kết quả, không vì thế tạo nhiều bản sao bài độc lập.

### 10.1 Mô hình dữ liệu đề xuất

| Đối tượng | Trách nhiệm |
| --- | --- |
| Workspace/người sở hữu | Phạm vi quyền truy cập, cấu hình, dữ liệu, quota và thiết bị |
| Cấu hình và các version | Tên, prompt, lịch sử hỏi–đáp, mục tiêu/tiêu chí, queries, nguồn, ngân sách, recipe/model versions; version đã chạy bất biến |
| Lượt chạy | Tham chiếu config version, thiết bị, trạng thái, thời điểm, counters, chi phí, checkpoint và lỗi; không đồng nhất với cấu hình |
| Bài, bình luận và observations | Identity ổn định, nội dung/metadata theo thời điểm, provenance, parent/root, coverage; tách nội dung thu được khỏi nhận định của model |
| Phiên đánh giá | Input snapshots + tiêu chí/model/rubric version + kết quả/evidence/chi phí; một bài có thể có nhiều nhận định hợp lệ trong các mục tiêu khác nhau |
| Bộ dữ liệu/kết quả | Danh sách thành viên và mốc dữ liệu, nguồn từ run/evaluation/merge; không cần nhân bản toàn bộ raw cho mỗi bộ |
| Backup/export | Manifest về phạm vi, version, checksum, thời điểm, trạng thái tạo/tải và hạn lưu; có liên kết về bộ dữ liệu gốc |

UI cần cho phép đặt tên, tìm kiếm, nhân bản và sửa cấu hình; xem các lần chạy/kết quả; chọn dữ liệu để gộp, tái lọc, xuất, backup hoặc lưu trữ. Trạng thái xử lý, đồng bộ và backup phải được thể hiện riêng; chạy xong không có nghĩa đã backup.

### 10.2 Chống trùng luôn sẵn sàng và gộp A+B

Một cơ chế identity/dedup thống nhất phục vụ ingest, import, gộp kết quả, đồng bộ và restore. Trong cùng phạm vi sở hữu, post dùng platform + post_id, comment dùng platform + comment_id; backend nhiều khách hàng cần thêm phạm vi tenant/workspace vào khóa và kiểm tra quyền. Không tự gom dữ liệu giữa các khách hàng chỉ vì cùng ID bài; URL chưa xác định được ID phải giữ trạng thái chờ resolve, không đoán bằng text.

Ví dụ A có 100 bài, B có 80 bài, giao nhau 30 ID: bộ C có **150 bài duy nhất**, vẫn giữ nguồn A/B, các quan sát và bình luận của cả hai. Làm lại cùng thao tác hoặc retry đồng bộ không nhân đôi bản ghi. Khi cùng ID có các phiên bản nội dung khác nhau, giữ observations/revisions và quy tắc chọn snapshot có lưu vết, không ghi đè mù hoặc bỏ comment mới như một bản trùng.

Cần tách hai thao tác:

- **Gộp danh sách kết quả:** tạo C là hợp các thành viên đã chọn từ A và B, chống trùng, giữ nhãn và tiêu chí nguồn. Không cần gọi LLM chỉ để gộp. Nếu A và B dùng tiêu chí khác nhau, không gọi C là kết quả đã đạt một tiêu chí chung mới.
- **Gộp rồi tái lọc:** dùng tập hợp raw/snapshots làm đầu vào cho một tiêu chí được chọn; tạo evaluation và bộ kết quả mới. Không ghi đè nhãn hoặc làm thay đổi bộ A/B.

Bộ dữ liệu đã xuất cần có phiên bản/mốc snapshot cố định. Một chế độ xem cập nhật liên tục có thể được cung cấp riêng và phải ghi rõ tính chất đó; không để bộ kết quả lịch sử âm thầm thay đổi khi một run mới cập nhật cùng bài.

### 10.3 Tái lọc và quản lý vòng đời

- Tái lọc từ raw đã lưu, kể cả bài trước đó REJECT hoặc pending nếu người dùng chọn phạm vi đó; không chỉ lấy các bài từng được ACCEPT. Thiếu raw thì báo rõ phần không thể đánh giá lại.
- Mỗi phiên tái lọc ghim tiêu chí, input snapshots, phiên bản rubric/model và thời điểm đánh giá. Cache chỉ dùng khi toàn bộ ngữ cảnh liên quan khớp; thay tiêu chí hoặc thời gian có ý nghĩa không được tái dùng nhãn cũ tùy tiện.
- Tách vòng đời cấu hình (draft/ready/archived), lượt chạy (queued/running/paused/completed/failed/cancelled), bộ kết quả và trạng thái đồng bộ. Đổi tên/archive cấu hình không được vô tình xóa dữ liệu dùng lại.
- Xóa một bộ kết quả thường là xóa membership; chỉ thu hồi raw dùng chung khi không còn tham chiếu cần giữ và đúng chính sách retention. Nếu có thao tác xóa toàn bộ nội dung, phải xử lý cả các tham chiếu/exports theo phạm vi mà người dùng chọn.
- Có chính sách dung lượng và hạn lưu riêng cho raw, comments, revisions, logs, cache và backups; trước khi thực hiện phải chốt mặc định và cách khôi phục. Khi sync, truyền dấu xóa để máy khác không tải lại dữ liệu đã xóa.
- Backup cần bao gồm cấu hình/answers, dữ liệu được chọn, comments/relations, các recipe/evaluation/history cần tái lập và manifest/schema/checksum. Tạo snapshot nhất quán, không copy tùy tiện database đang ghi. Không kèm API keys, cookies hoặc browser profile trong gói dữ liệu người dùng tải.
- Restore/import kiểm tra định dạng, checksum và version; mặc định tạo một bộ dữ liệu phục hồi riêng, chống trùng khi nhập. Không tự khởi động jobs/crawls của bản backup cũ.

## 11. Điều khiển từ xa, gói sử dụng và phương án Supabase

### 11.1 Yêu cầu sản phẩm và phần còn là lựa chọn

Hệ thống cần có đường phát triển tới quản lý cấu hình/kết quả từ xa, quyền dùng dịch vụ theo gói mua, backup và download dữ liệu người dùng. **PostgreSQL trên Supabase là ứng viên phù hợp để đánh giá; chưa chốt phải chuyển toàn bộ lưu trữ và thực thi lên đó.** Phân biệt backend điều phối/lưu trữ với máy thực thi crawler có phiên Facebook/Threads.

Phương án đề xuất để bàn là vẫn lưu và điều phối công việc cục bộ, đồng bộ lên backend theo phạm vi rõ ràng:

| Thành phần | Vai trò đề xuất |
| --- | --- |
| Electron + SQLite | Nhận/lưu dữ liệu ngay, queue/checkpoint, cache và vùng làm việc trên máy; giữ được dữ liệu khi kết nối backend gián đoạn |
| Supabase Auth + PostgreSQL | Tài khoản/workspace, cấu hình có version, metadata run/dataset/evaluation, quyền gói, quota và dữ liệu post/comment đã chọn đồng bộ |
| Supabase Storage hoặc object storage tương đương | Gói backup, file export và payload lớn nếu cần; PostgreSQL giữ metadata/tham chiếu thay vì nhét mọi file binary vào bảng |
| Backend/API hoặc worker dịch vụ | Xác thực quyền, điều phối lệnh, quản lý model credentials, gọi LLM theo gói, kiểm soát chi phí và tạo export/backup |

Đây là đề xuất kiến trúc của CSD, không phải tính năng sync/remote-control có sẵn chỉ cần bật Supabase. Có thể triển khai cloud theo hai mức: trước hết lưu cấu hình + danh mục và gói backup để tải về; sau đó đồng bộ dữ liệu từng bản ghi nếu cần tìm kiếm/gộp/tái lọc trên web. Mức đầu không đáp ứng truy vấn toàn bộ nội dung trực tiếp trên cloud nếu chỉ upload file backup. Cần chốt phạm vi tải lên với người dùng; không mặc định chuyển toàn bộ app data hiện có lên mạng.

### 11.2 API key theo gói mua

Đề xuất cấp cho người dùng **quyền gọi dịch vụ CSD và hạn mức**, thông qua đăng nhập hoặc token riêng có thể thu hồi. Backend giữ Gemini/provider key, kiểm tra gói/quota, dành trước ngân sách trước call rồi ghi usage và đối soát sau call. Retry cùng request không được tự gây ghi phí hai lần; timeout chưa rõ usage phải được ghi nhận để đối soát. Nguồn xác nhận gói và bộ đếm hạn mức ở phía server, không dựa vào client tự báo.

Không phân phối một Gemini key dùng chung của dịch vụ tới các bản EXE như cách kiểm soát thuê bao; khi đã nhận key, client có thể dùng ngoài CSD. Nếu cần hỗ trợ người dùng tự mang key (BYOK), giữ đó là chế độ riêng với key được bảo vệ cục bộ như hiện tại. Gói do CSD thanh toán và BYOK phải có chính sách quota/chi phí rõ ràng, không tự chuyển sang key khác để vượt hạn mức.

Đối với Supabase, key publishable đi cùng phiên người dùng có thể nằm ở client; secret/service-role key chỉ ở backend vì có thể bỏ qua RLS. Đăng nhập xác định người dùng, còn API key của project không thay thế việc phân quyền theo người dùng. [Tài liệu API keys](https://supabase.com/docs/guides/getting-started/api-keys)

### 11.3 Đồng bộ, quyền truy cập và lệnh từ xa

- Dữ liệu có owner/workspace rõ ràng; bảng và object storage phải có chính sách truy cập tương ứng. PostgreSQL RLS có thể giới hạn hàng theo danh tính và quyền thành viên; backend dùng quyền cao vẫn phải tự kiểm tra phạm vi trước khi thao tác. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) · [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- Không giả định Postgres tự đồng bộ với SQLite. Cần outbox, ID thao tác ổn định, acknowledgement, retry, sync cursor, kiểm tra version và dấu xóa; cùng thao tác gửi lại phải cho cùng kết quả. Chỉnh cùng cấu hình từ hai máy tạo revision/conflict để giải quyết, không âm thầm dùng last-write-wins cho tiêu chí.
- Chốt nguồn có thẩm quyền: quyền gói/quota ở server; config versions và observations là bản ghi có version; current pointers cập nhật có kiểm tra revision; thiết bị giữ các việc chưa sync. Quyền ghi không được quyết định từ trường owner do client tự gửi.
- Remote commands là các lệnh có cấu trúc, giới hạn phạm vi như chạy/tạm dừng/hủy run, tạo backup/export; có command ID, thiết bị đích, hạn hiệu lực, lease/ack và trạng thái kết quả. Không biến điều khiển từ xa thành thực thi JavaScript hoặc shell tùy ý trên máy người dùng.
- Một run có một chủ thể thực thi hợp lệ tại một thời điểm; retry/reconnect không mở hai crawler cho cùng lệnh. Server chỉ ghi queued khi máy chưa nhận, không báo running thành công chỉ vì đã tạo dòng trong database.
- Crawl từ xa trên máy desktop cần app/worker chạy, máy online và phiên nền tảng hợp lệ. Máy tắt thì lệnh chờ hoặc hết hạn; muốn chạy khi máy tắt cần thiết kế cloud runner riêng. Khi mất mạng, local storage vẫn giữ dữ liệu đã thu; gọi model theo gói qua backend có thể phải chờ kết nối, không cam kết toàn bộ pipeline chạy offline.

### 11.4 Backup/download và chi phí vận hành

Phân biệt backup phục hồi toàn hệ thống với gói dữ liệu của từng người dùng. Người dùng tải dataset/backup thuộc phạm vi của họ, không tải bản dump chung chứa dữ liệu của mọi khách hàng. Backend xác thực quyền trước khi tạo gói, ghi manifest/checksum và trạng thái ready; có thể tải private object bằng request có xác thực hoặc URL có thời hạn. [Supabase private downloads](https://supabase.com/docs/guides/storage/serving/downloads)

Backup của PostgreSQL trên Supabase **không bao gồm nội dung object trong Storage**, chỉ có metadata của chúng. Vì vậy cần kế hoạch backup/restore riêng cho các gói hoặc payload trong object storage, đồng thời kiểm tra restore cả phần dữ liệu và liên kết file. [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)

Ngân sách dưới $3/1.000 bài tinh trước đây là mục tiêu API đã thảo luận; gói thương mại phải tính thêm database, storage, tải xuống, backup, backend, các lượt tái lọc và chi phí vận hành. Cần đo dung lượng/egress/usage thực tế và chốt quota/retention theo gói trước khi cam kết giá. Chưa có phép đo chi phí cloud trong lượt tài liệu này.

## 12. Trình tự triển khai đề xuất sau khi chốt tại chat mới

| Đợt | Công việc | Bằng chứng cần có |
| --- | --- | --- |
| 0 | Review/checkpoint working tree; manifest baseline; chốt hai nhóm, raw cap và mục tiêu campaign | Có thể tái build/truy nguồn; không bỏ sót untracked dependencies; quyết định được ghi rõ |
| 1 | Vòng hỏi–đáp có cấu trúc; sửa planner/validator, độ phủ query và rubric mục tiêu | Làm rõ đúng điểm mơ hồ; prompt và câu trả lời cùng chi phối search/filter; không mất nhánh quan trọng hoặc bịa hard constraints |
| 2 | Session/window pool, scheduler và single ingest writer; exact dedup/cap/backpressure | Concurrent duplicates, shared budget, Stop/crash/Resume, một window đóng không phá window khác |
| 3 | Comments worker/kho riêng về logic, retry partial, snapshot/reclassify; binary UI/export version | Coverage theo root/nhánh, cơ hội tìm được nhờ comments, migration không mất lịch sử |
| 4 | Source discovery, feedback query expansion, ranking nâng cao | Cải thiện có đo trên nhiều chủ đề, cùng ngân sách và bộ tiêu chí cố định |
| 5 | Thư viện nhiều cấu hình/version, dataset membership, union/dedup, tái lọc và retention | A+B đúng số unique, retry không tạo trùng, giữ provenance/comments/nhãn nguồn; tái lọc không đổi kết quả cũ |
| 6 | Backend theo gói, sync/backup/download từ xa; đánh giá Supabase | Cách ly quyền giữa người dùng, quota phía server, xử lý mất mạng/retry, restore đầy đủ, không đưa shared provider key ra client |

Đây là thứ tự bàn giao dự kiến, không yêu cầu xây cloud ngay. Hợp đồng identity, ownership, config/evaluation version và dataset cần được chốt trước khi thay schema ở các đợt 2–3; màn hình quản lý và tính năng cloud có thể bổ sung sau. Không trì hoãn thiết kế dữ liệu tới cuối rồi di chuyển toàn bộ một lần.

Benchmark đề xuất: bất động sản, gà ta, spa và café đối chứng; so baseline và từng thay đổi để phân biệt nguyên nhân. Dùng kiểm tra kỹ thuật đúng phạm vi và đánh giá ngữ nghĩa độc lập. Agent tự xử lý gán nhãn/đọc chéo; thiếu chứng cứ giữ unresolved, không gọi nhãn AI là human gold.

Đo riêng: độ phủ nhánh truy vấn; số cơ hội mới đúng trên thời gian/chi phí; tỷ lệ trùng; attempted/nonempty/partial/error comments; precision output; recall trong tập tham chiếu đã quan sát; precision phần đầu danh sách; chi phí trên output đúng. Không tuyên bố recall toàn mạng từ tập đã crawl. Kiểm tra live nhiều cửa sổ chỉ sau khi có thiết kế được người dùng chọn, không tự khởi động từ tài liệu này.

Các ca nghiệm thu bổ sung: prompt đã rõ không bị hỏi lại; câu trả lời sửa phạm vi search và rubric nhất quán; answer revision cũ không ghi đè mới; gộp 100+80 với 30 bài trùng cho 150 unique; nhập/sync lại không tăng số bài; delete một dataset không xóa raw còn được tham chiếu; tái lọc khác tiêu chí có kết quả/version riêng; tải/restore đúng dữ liệu và comments; tenant A không đọc dữ liệu hoặc dùng quota của tenant B; thiết bị offline không nhận trạng thái chạy giả.

## 13. Nội dung bàn giao cho chat mới

Có thể dùng lời nhắn sau:

> Đọc some-problems-in-this-branch.md, phần hiện hành của .brain/master_plan.md và báo cáo dừng sau tai nghe. Kiểm tra Git/status thực tế trước khi làm vì nhiều thành tựu chưa commit. Tôi muốn bàn thiết kế CSD đa chủ đề: LLM hỏi–đáp để hiểu nhu cầu; pool nhiều cửa sổ tìm kiếm, ingest chung chống trùng, raw cap chung, lọc streaming ra hai nhóm và kho/worker bình luận riêng; thư viện nhiều cấu hình/version, dataset, gộp và tái lọc; điều khiển/quyền dùng API theo gói và backup/download từ xa. Đánh giá SQLite cục bộ kết hợp backend PostgreSQL/Supabase và object storage, chưa mặc định đã chọn cloud. Trước mắt giải thích và cùng tôi chốt các lựa chọn, chưa merge/reset/bỏ nhánh/chạy crawl/đưa dữ liệu lên cloud. Phân biệt rõ code đang có, hướng tôi đã yêu cầu, đề xuất chưa chốt và bằng chứng đã đo. Sau khi tôi giao triển khai, làm từng module có checkpoint và kiểm chứng; giữ dữ liệu, key/session và lịch sử run an toàn.

Những quyết định còn cần bàn:

- Hai nhóm đánh giá theo loại cơ hội nào trong từng campaign; người bán có thể là đối tượng phù hợp khi nào?
- Luồng hỏi–đáp, trường nào bắt buộc làm rõ, cách hiển thị bản hiểu nhu cầu và lưu/chỉnh cấu hình dùng lại.
- Pool/window/session ownership; số cửa sổ thử nghiệm và điều phối search/comments.
- Giới hạn raw là ngưỡng dừng nhận thêm hay yêu cầu output đúng tuyệt đối N; cách giữ batch đang về.
- Budget comments và điều kiện kết thúc sau khi discovery đạt raw cap; mức coverage muốn đạt.
- Checkpoint/nhánh làm tiếp/merge main; manifest và version schema binary.
- Vòng đời cấu hình/run/dataset/evaluation; gộp danh sách hay gộp rồi tái lọc; chính sách snapshot, retention, xóa và restore.
- Mức đồng bộ cloud: cấu hình + file backup hay dữ liệu từng bản ghi; phạm vi người dùng chọn tải lên; nguồn có thẩm quyền khi có nhiều thiết bị.
- Quyền API theo gói/BYOK, quota, lệnh từ xa và điều kiện máy online; chọn Supabase hay backend khác sau khi chốt hợp đồng dữ liệu và chi phí.

## 14. Tài liệu kỹ thuật tham khảo

- Electron hỗ trợ persistent session dùng chung giữa các trang cùng partition: [Session API](https://www.electronjs.org/docs/latest/api/session). Cần thiết kế app ownership tương thích, không đồng nghĩa host CSD đã hỗ trợ nhiều window/profile.
- SQLite cho nhiều transaction đọc, chỉ một transaction ghi đồng thời: [Transactions](https://www.sqlite.org/lang_transaction.html). Đây là một cơ sở cho đề xuất single writer, không khẳng định mọi thiết kế nhiều connection đều không thể dùng.
- Mở rộng từ kết quả ban đầu có thể lệch hướng: [Stanford — pseudo relevance feedback](https://nlp.stanford.edu/IR-book/html/htmledition/pseudo-relevance-feedback-1.html).
- Giảm trùng lặp khi rerank tập đã có: [Carbonell & Goldstein — MMR](https://www.cs.cmu.edu/afs/cs/Web/People/jgc/publication/MMR_DiversityBased_Reranking_SIGIR_1998.pdf).
- Công cụ hỗ trợ retrieval và reranking trên corpus có sẵn: [Sentence Transformers](https://sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html).

Các nguồn này hỗ trợ nguyên lý thiết kế. Chưa có phép đo chứng minh các phương án mới sẽ đạt 1.000 output đúng hoặc ngân sách mục tiêu của CSD.
