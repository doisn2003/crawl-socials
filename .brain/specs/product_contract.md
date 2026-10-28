# CSD — Product contract 1.0.0

Ngày lập: 2026-10-27, Asia/Bangkok. Phạm vi: P00.01. Nguồn yêu cầu: [master plan, mục 2–3](../master_plan.md). Trạng thái task chỉ nằm trong bảng điều phối của master plan.

Contract này đủ cho thiết kế offline và phân xử các trường hợp đếm. Người dùng đã chốt workload quán cà phê và yêu cầu có kết quả từ cả ba loại nguồn trong phiên 2026-10-27. [campaign.coffee.json](campaign.coffee.json) ghi cấu hình đó; vẫn là DRAFT vì quyền nguồn, ngân sách và chính sách dữ liệu thuộc P00.02/P00.04 chưa được chốt. Không thay các giá trị chưa biết bằng `0` hoặc dùng ví dụ minh họa làm workload thật.

Phạm vi contract 1.0.0 là `collection_scope = PUBLIC_DISCOVERY`. Nhánh R08/JOINED_GROUPS vừa được bổ sung vào master plan thuộc P11.04–P11.08, cần contract/version riêng; bài riêng tư không được tính vào G02 công khai. Schema này chủ động từ chối JOINED_GROUPS/PRIVATE_GROUP. Source/observation/job vẫn phải giữ tham chiếu bối cảnh phiên/quyền để không khóa kiến trúc vào một tài khoản.

## 1. Yêu cầu và quyết định thiết kế

| Yêu cầu đã xác nhận | Cách thể hiện và kiểm chứng |
| --- | --- |
| R01 — CSD = Crawl Socials Data | Tên sản phẩm; tên campaign không đổi tên sản phẩm |
| R02 — Đầu vào là tập từ khóa theo chủ đề | `workload.keywords`, `intent`, `exclusions`; freeze trước Start |
| R03 — Facebook bắt buộc ở bản đầu | `platform = FACEBOOK`; không cộng bài nền tảng khác |
| R04 — 1.000 bài trong tối đa 24 giờ chạy | `target.valid_unique_posts = 1000`, `max_wall_time_seconds = 86400`; đếm tập LIVE đã persist đúng hạn |
| R05 — Được lấy bài cũ | `historical_window = UNBOUNDED` mặc định thiết kế; chỉ áp dụng RANGE khi campaign chủ động giới hạn |
| R06 — Quan tâm bài công khai, nhóm công khai, Pages | Ba source type tách riêng; phạm vi và minimum phải được chốt, chưa cho phép suy thành chỉ Pages |
| R07 — Master plan là bản đồ triển khai | Contract/schema/evidence được liên kết về bảng điều phối; không tạo backlog trạng thái khác |

Quyết định thiết kế 1.0.0: định danh bài khác nhau được giữ riêng dù văn bản giống nhau; bài share có ID riêng chỉ được tính nếu loại `SHARED_POST` được cho phép và đạt mọi tiêu chí khác. Áp dụng “không trùng” theo identity/alias, theo quy tắc O05 của master plan; không có yêu cầu bổ sung gộp nội dung tương tự. Đây là policy kỹ thuật có version, không phải tuyên bố người dùng đã yêu cầu loại copy theo ngữ nghĩa. Nếu cần đổi cách tính, tạo decision và contract mới trước run.

### Workload đã xác nhận: quán cà phê

| Nội dung người dùng chốt | Cách áp dụng |
| --- | --- |
| Tìm quán, review, đi coffee/hẹn hò, cafe Hà Nội, Tiny Cafe/các thương hiệu khác, sự kiện tại quán | Các từ khóa khởi tạo và intent trong campaign.coffee.json; từ khóa là gợi ý discovery, không tự là bằng chứng relevance |
| Công khai từ Page, nhóm và trang cá nhân; không chia quota nhưng phải có cả ba | Cả ba `in_scope = true`, minimum = 1 để biểu diễn điều kiện hiện diện; không áp tỷ lệ hoặc chia 1.000 thành ba quota. Báo số valid riêng mỗi loại |
| Ưu tiên Hà Nội, không chỉ Hà Nội | Geography ANY, `preferred_places = ["Hà Nội"]`; ưu tiên planner và báo breakdown khi đủ bằng chứng, không loại bài tỉnh/thành khác hoặc bài đúng chủ đề chưa rõ địa phương |
| Được mở rộng từ khóa liên quan | Policy BOUNDED_INTENT `coffee-intent-v1` bên dưới; freeze policy trước Start, không cần freeze trước mọi query sẽ sinh |
| Tối thiểu 1.000 bài không trùng trong ≤24h, càng nhanh/càng nhiều càng tốt; bài cũ được phép | Mốc tối thiểu 1.000 và presence cả ba nguồn, đo `time_to_target`; tiếp tục best effort khi còn yield/ngân sách, không có trần 1.000 và không cố kéo dài run đủ 24 giờ |

Rubric `coffee-intent-v1`: ACCEPT nội dung tìm/gợi ý quán, review trải nghiệm/không gian/đồ uống tại quán, địa chỉ/địa điểm đi coffee/hẹn hò tại quán, bài thương hiệu quán hoặc sự kiện được gắn với một quán cà phê. Bài cần có bằng chứng nội dung hoặc venue/brand đã xác minh đủ để kết luận; Tiny Cafe không được nhận chỉ vì tên khớp trong một ngữ cảnh khác. Không yêu cầu bài tự chứa đúng chuỗi keyword. Nội dung chỉ nói bán hạt/công thức pha tại nhà, Java/phần mềm hoặc một địa điểm không liên quan quán không đáp ứng intent; không đặt exclusion riêng cho quảng cáo, tuyển dụng hay ngôn ngữ khi người dùng chưa yêu cầu. Content types nhận mọi loại bài lâu dài trong schema nếu có text/snippet đủ xác minh; bài chỉ có hình/clip mà chưa có bằng chứng nội dung là UNVERIFIED.

Mở rộng có kiểm soát `coffee-intent-v1`: cho phép biến thể cà phê/cafe/café/coffee, cách diễn đạt tìm quán/review/hẹn hò, địa danh (ưu tiên Hà Nội), tên thương hiệu/venue có bằng chứng là quán cà phê, sự kiện gắn với quán. Mỗi query sinh phải lưu query cha, lý do, nhóm mở rộng, bằng chứng venue/brand nếu thêm tên và policy version. Không đổi intent sang toàn bộ nhà hàng, mọi sự kiện, mọi tên chứa “coffee”, danh sách bài có sẵn hoặc bỏ yêu cầu nguồn. Giới hạn query/requests do P00.04 chốt; không mở rộng vô hạn.

## 2. CampaignSpec và kiểm tra đầu vào

- [campaign.schema.json](campaign.schema.json): JSON Schema draft-07, contract/schema `1.0.0`; cấm trường ngoài schema ở các object cấu hình. JSON UTF-8, ID string, timestamp UTC dạng ISO 8601 với `Z`.
- [campaign.example.json](campaign.example.json): chỉ minh họa chủ đề cà phê ở Đà Nẵng, `DRAFT / EXAMPLE_ONLY`; không có tài khoản, token, seed bài hoặc quyền truy cập thật.
- [campaign.coffee.json](campaign.coffee.json): workload người dùng đã chốt, `DRAFT / USER_CONFIRMED`; nguồn/ngân sách vẫn cần P00.02/P00.04, không tự bật BENCHMARK.
- `DRAFT` cho phép null ở quyết định còn mở. `BENCHMARK` yêu cầu workload được xác nhận, từ khóa/intent/content types đầy đủ, geography rõ, từng source có boolean/minimum, ít nhất một source trong phạm vi, budgets có số cụ thể và `open_questions` rỗng. Ngôn ngữ null nghĩa không lọc ngôn ngữ, không phải chưa quyết định.
- `in_scope = true, minimum = 0` nghĩa nguồn được phép nhưng không bắt buộc đóng góp. `false` bắt buộc minimum `0`; `null` nghĩa chưa chốt. Không cộng nguồn `UNKNOWN` vào tổng hợp lệ hoặc quota.
- `geography.mode = ANY` nghĩa không giới hạn địa phương; `preferred_places` chỉ tác động ưu tiên, không tác động ACCEPT. `INCLUDE` cần danh sách nơi và quy tắc bằng chứng; `UNRESOLVED` chặn benchmark. Không suy địa phương của bài từ nơi đặt Page, nơi sống tác giả hoặc từ khóa xuất hiện trong truy vấn.
- Loại nội dung: `SHARED_POST` có ưu tiên phân loại trước; các bài còn lại lần lượt `VIDEO_POST`, `PHOTO_POST`, `LINK_POST`, `TEXT_POST` theo nội dung gắn với chính bài. Comment/reply/story tạm thời hoặc media không xác định được bài đều ngoài phạm vi 1.0.0. Không cần tải media để phân loại; thiếu dữ kiện thì UNVERIFIED.
- `exclusions` rỗng nghĩa không thêm điều kiện loại trừ. Không tự loại tuyển dụng, quảng cáo hoặc sang nhượng nếu intent không yêu cầu. `language` áp dụng cho nội dung, không cho ngôn ngữ giao diện Facebook.
- Window `RANGE` là khoảng nửa mở `[from_utc, to_utc)` theo `published_at` có nguồn gốc kiểm chứng; thiếu ngày đăng thì UNVERIFIED. `UNBOUNDED` cho phép `published_at = null`.
- Seed chỉ là nguồn (Page/Group/public timeline) có xuất xứ và quyền phù hợp. Danh sách permalink bài không là seed discovery. URL seed phải được adapter phân loại/xác minh, không chỉ kiểm tra chuỗi có dạng URL.
- Expansion DISABLED không sinh query mở rộng; FROZEN_ALLOWLIST chỉ dùng đúng danh sách đã freeze. BOUNDED_INTENT cho workload thật dùng policy `coffee-intent-v1` đã mô tả. Không nới nghĩa trong run để bù thiếu bài.

Schema kiểm tra hình dạng, chưa chứng minh quyền nguồn hay việc người dùng thực sự xác nhận. Bước preflight ở P00.04/P08.01 còn phải kiểm tra: timestamp là ngày có thật, `from < to`, từ khóa sau NFC/trim không rỗng/trùng, timezone hợp lệ, seed đúng loại/không có secrets, currency/ngân sách đã được giao, version/rubric/adapter/route được chọn, nguồn đã được P00.02 xác nhận và G00 PASS. Không chỉ sửa `mode` hoặc xóa `open_questions` để bỏ các điều kiện này. [check-p00.cjs](../../scripts/check-p00.cjs) xác minh schema và các ca cấu hình quan trọng; không phải implementation preflight sản phẩm.

`CampaignSpec` không chứa `started_at` tự điền, deadline có thể sửa, cursor hay auth. Khi Start, run mới tham chiếu campaign ID/version cùng hash bản spec/manifest bất biến; thêm `run_id`, `started_at`, `deadline_at`, adapter/code/parser/rule version, capture provenance và ngân sách thực. Chi tiết manifest/protocol thuộc P00.04/P08.01.

## 3. Bài và observation tối thiểu

Các bảng dưới mô tả hợp đồng dữ liệu, chưa triển khai DB ở P00.01. Null chỉ cho phép ở trường có ghi rõ; thiếu trường bắt buộc không được ACCEPT.

| Dữ liệu | Quy tắc |
| --- | --- |
| `platform`, `post_id`, identity/alias | FACEBOOK; `post_id` string hoặc null nếu permalink đã xác minh nhận diện duy nhất; identity proof phải có trước cutoff |
| `canonical_url`, URL evidence | HTTPS permalink tới chính bài; không phải Page/Group/search/comment; giữ tham số định danh `story_fbid`, `id`; chỉ bỏ tracking đã biết |
| `source_type`, `source_id`, context evidence | PAGE / PUBLIC_GROUP / PUBLIC_PERSONAL / UNKNOWN; source ID string hoặc null khi bằng chứng permalink/context vẫn xác minh được; chứng minh bối cảnh xuất bản và công khai trước cutoff |
| `author_type` | PAGE / PERSON / UNKNOWN, có thể không biết; không dùng thay `source_type` |
| `content_type`, `text`, content evidence | Một loại được campaign cho phép; text/snippet được lưu đủ cho rubric xác định đúng chủ đề, địa phương/ngôn ngữ nếu lọc. Không đặt số ký tự tùy ý làm bằng chứng relevance; không đủ nội dung thì UNVERIFIED |
| `published_at`, publication evidence | UTC hoặc null theo window; không dùng ngày search engine index, observed hoặc discovered làm ngày đăng |
| `first_discovered_at` | UTC của lần đầu bản cài biết bài; không quyết định việc hợp lệ trong run hiện tại |
| `observation_id`, `run_id`, `query_id`, `adapter_version`, `parser_version` | Tham chiếu bền vững tới truy vấn gốc/cha, cách phát hiện, seed provenance và code đã dùng |
| `profile_id`, `account_id`, `access_context_id`, `visibility_at_observation` | ID nội bộ/ref tới phiên và danh tính đã kiểm, có thể account_id null khi route thực sự anonymous; `visibility_at_observation = PUBLIC` mới vào G02. Job gắn profile/access context phù hợp; đổi tài khoản không được tự tiếp tục bằng checkpoint/quyền cũ. Không xuất credentials hay danh tính MXH vào `.brain` |
| `capture_mode`, `observed_at`, `persisted_at` | Host gắn LIVE/FIXTURE/REPLAY/IMPORT/CACHE; cả hai thời điểm phải thuộc run và không quá cutoff |
| `record_version`, `evidence_ref`, `evidence_hash` | Nội dung/bằng chứng bất biến dùng cho snapshot; evidence trong data store bảo vệ ngoài `.brain`, không chứa secrets thừa |
| `ValidationDecision` | ACCEPT / REJECT / UNVERIFIED, reason codes, campaign/contract/rule version, cơ chế/người kiểm, thời điểm và record/evidence version đã đánh giá; audit sau cutoff được phép với bằng chứng cũ |

Một post có nhiều observations; retry hoặc phát hiện lại qua nhiều query không tăng unique. Nguồn xuất bản của một identity phải nhất quán. Mâu thuẫn nguồn chưa giải quyết là UNVERIFIED; không gán cùng bài vào nhiều quota. Một Page đăng trong nhóm là PUBLIC_GROUP; một bài Page được share trong nhóm với ID share riêng có thể là hai bài nếu cả hai đáp ứng policy. Chỉ thấy link bài Page trên trang kết quả Group không biến bài gốc thành bài Group.

## 4. Quy tắc quyết định và số đếm

Áp dụng theo contract đã freeze. Khi workload/source còn mở, chỉ tạo quyết định thử nghiệm; không công bố ACCEPT để chứng minh benchmark chính thức.

1. Không phải bài Facebook cụ thể → REJECT `NOT_FACEBOOK_POST` / `NOT_POST`.
2. Định danh/permalink không đủ chắc → UNVERIFIED `IDENTITY_UNVERIFIED` / `PERMALINK_UNVERIFIED`. Không ép ID số dài vào JavaScript number. Alias đã chứng minh về cùng bài chỉ là một identity.
3. Nguồn đã biết ngoài phạm vi hoặc riêng tư → REJECT `SOURCE_OUT_OF_SCOPE` / `NON_PUBLIC_SOURCE`. Nguồn/bối cảnh hoặc khả năng công khai chưa rõ → UNVERIFIED `SOURCE_UNVERIFIED`.
4. Loại nội dung ngoài danh sách, sai chủ đề/địa phương/ngôn ngữ, ngoài window hoặc trúng exclusion đã freeze → REJECT `CONTENT_TYPE_EXCLUDED`, `OFF_TOPIC`, `OUTSIDE_GEOGRAPHY`, `LANGUAGE_EXCLUDED`, `OUTSIDE_PUBLISHED_WINDOW`, `EXCLUSION_MATCH`. Ghi mọi lý do đã chứng minh; không suy từ việc keyword khớp đơn lẻ thành đúng intent.
5. Thiếu bằng chứng cần để phân xử → UNVERIFIED `CONTENT_INSUFFICIENT`, `GEOGRAPHY_UNVERIFIED`, `LANGUAGE_UNVERIFIED`, `PUBLISHED_AT_MISSING` hoặc `EVIDENCE_MISSING`. Nội dung mới hydrate sau cutoff không làm bài cũ đủ điều kiện.
6. Đủ các điều kiện trên → ACCEPT về nội dung. Để được tính G02 còn phải có observation LIVE đủ trường bắt buộc, ghi bền vững đúng run và đúng cutoff; không đủ thì loại khỏi membership hợp lệ với `NON_LIVE_CAPTURE`, `OUTSIDE_RUN_WINDOW`, `PERSISTED_AFTER_CUTOFF` hoặc `NOT_IN_FROZEN_SNAPSHOT`. Một bài replay có permalink thật vẫn không hợp lệ cho benchmark.
7. Một identity chỉ tăng `verified_valid_unique_posts` một lần trong run. Quan sát trùng có nhãn `DUPLICATE_OBSERVATION`, không xóa provenance và không biến bài hợp lệ thành bài sai chủ đề.

`cutoff = min(thời điểm dừng thu thực tế, started_at + 86400 giây)`. `started_at` là lúc Start, không phải response đầu tiên. Pause, sleep, retry, re-login, mất mạng, restart đều nằm trong thời gian này. Sau restart quá deadline chỉ finalise/audit. Phải theo dõi clock drift, không cấp lại 24 giờ khi đồng hồ đổi.

Tập `S` khóa tại cutoff gồm identity, membership, record/evidence versions và hashes đủ điều kiện thu. Sau cutoff được xác minh/loại bỏ dựa trên S; observations mới lưu riêng, không bổ sung hoặc hoàn thiện bằng chứng bắt buộc của S. Quyết định audit mới có thể giảm số hợp lệ. Không lấy một mẫu rồi nhân tỷ lệ để chứng minh 1.000 bài.

G02 chỉ PASS khi đồng thời:

- Manifest/workload/source mix đã chốt trước Start, G00 và các preflight liên quan đạt.
- `|V| >= 1000`, với V là các identity khác nhau trong S được audit xác nhận đạt toàn bộ tiêu chí.
- Mỗi nguồn có `in_scope = true` đạt minimum tương ứng bằng source context đã xác minh. Các nhóm nguồn đếm không chồng nhau; tổng unique tính từ union identity, không cộng raw counters. Quota có tổng lớn hơn 1.000 buộc thu nhiều hơn 1.000.
- Không có membership hoặc trường bắt buộc được thêm sau cutoff để đủ chỉ tiêu; báo rõ thời gian thu, can thiệp trong run và audit sau run.

`new_to_campaign` và `new_to_global_history` báo riêng. Cold run không nhập bài vào đầu ra trước Start; LIVE tìm lại bài lịch sử trong run độc lập được tính một lần cho run đó nhưng không gọi là bài mới xuyên ngày. API/browser request thực có cache phía nguồn vẫn có thể là LIVE; dùng lại dữ liệu cục bộ CSD không thu qua nguồn trong run là CACHE.

Với workload quán cà phê, đo `time_to_target` tại mốc sớm nhất tập ứng viên có đủ 1.000 identity và đủ cả ba nguồn; kết luận thời gian đạt chỉ được xác nhận sau audit trên đúng record/evidence versions ở mốc đó. Một mốc bị audit loại xuống dưới 1.000 không được báo là đã đạt. Khi vượt mốc, giữ thêm bài hợp lệ trong cùng run nếu còn yield/ngân sách; người dùng có thể dừng, các stop conditions P00.04 vẫn áp dụng và cutoff không bao giờ vượt deadline. Báo số cuối, thời điểm đạt được xác minh và cơ cấu nguồn riêng.

Metrics bắt buộc giữ đúng định nghĩa mục 3.4 master plan: raw observations, unique trước relevance, verified valid, unverified, hai novelty counts, duplicates với mẫu số, rejected reasons, marginal yield, access events, operator minutes, audit minutes và cost/1000 (N/A nếu valid = 0). Không dùng số request thay số bài.

## 5. Các ca để hai người kiểm áp dụng giống nhau

Giả sử ca đã có campaign freeze, intent/rubric rõ, đủ quyền và mọi điều kiện khác đạt. Đây là dữ liệu giả về hành vi, không chứa bài hoặc danh tính thật.

| Ca | Kết luận |
| --- | --- |
| Bài năm 2020, LIVE trong run, UNBOUNDED, đủ bằng chứng | ACCEPT, +1; tuổi bài không loại bài |
| Cùng ID qua 3 query và 2 URL alias đã xác minh | Tổng +1, 3 observations; provenance không mất |
| Hai ID khác nhau, nội dung giống hoàn toàn | Tổng +2 nếu đều đạt policy; thêm nhãn similarity, không tự merge |
| Wrapper share có ID riêng, SHARED_POST được phép | +1 nếu chính share đủ dữ liệu, context và relevance; không tự tính thêm bài gốc chưa thu |
| Page là tác giả nhưng đăng trong nhóm công khai | +1 PUBLIC_GROUP; PAGE quota không tăng |
| Bài chỉ thấy snippet keyword, không đủ xác định ý nghĩa | UNVERIFIED CONTENT_INSUFFICIENT, +0 |
| Permalink và text rõ nhưng chưa biết context xuất bản | UNVERIFIED SOURCE_UNVERIFIED, +0 |
| Bài có permalink thật nhưng tới từ fixture/replay/import/cache | +0 G02, dù quyết định nội dung có thể ACCEPT |
| observed lúc 23:59:59, persist lúc 24:00:01 | +0 G02, PERSISTED_AFTER_CUTOFF |
| Tại cutoff thiếu text; mở link sau 24 giờ để lấy text | +0 G02; không dùng text mới lấp snapshot cũ |
| Snapshot đủ 1.020, audit loại 30, sau cutoff thấy 20 bài khác | 990 hợp lệ, G02 FAIL; 20 bài mới không bù |
| Thu 1.000 bài Pages, contract yêu cầu ít nhất 100 PUBLIC_GROUP | G02 FAIL source mix |
| 900 ACCEPT và 100 UNVERIFIED | 900 hợp lệ, G02 FAIL |
| 998 Page + 1 PUBLIC_GROUP + 1 PUBLIC_PERSONAL đều hợp lệ theo campaign quán cà phê | 1.000 hợp lệ, đạt presence cả ba; không áp quota tỷ lệ |
| 999 Page + 1 PUBLIC_GROUP và 0 PUBLIC_PERSONAL | G02 FAIL dù tổng là 1.000 |
| Bài review quán ở Đà Nẵng đúng intent của campaign quán cà phê | ACCEPT; Hà Nội chỉ là ưu tiên |
| Query sự kiện sinh thêm tên quán có venue evidence, bài nói về sự kiện ở đó | Có thể ACCEPT dù không có chuỗi “cà phê”; vẫn cần bằng chứng và source công khai |
| Pause 4 giờ, restart run cũ | Giữ run/deadline; 4 giờ vẫn tính trong 24 giờ |

## 6. Unknown và điều kiện mở benchmark

| ID | Chưa biết | Cách giải quyết / ảnh hưởng |
| --- | --- | --- |
| O01 | Đã chốt trong phiên 2026-10-27 | Page, nhóm công khai, cá nhân công khai đều phải có kết quả; mỗi minimum = 1 chỉ là presence, không quota tỷ lệ; báo riêng |
| O02 | Đã chốt trong phiên 2026-10-27 | Chủ đề/keyword quán cà phê, mở rộng liên quan; ưu tiên Hà Nội, không giới hạn địa phương; nhận các loại bài theo rubric trên |
| O03 | Route/session/API/quyền dùng được | P00.02 xác minh bằng nguồn cụ thể; contract không cấp quyền truy cập; chặn G00 |
| O04 | Chi phí, requests, dung lượng, phút can thiệp | P00.04 chốt; null không nghĩa vô hạn hoặc được tự chi tiền; chặn benchmark |
| O05 | Policy kỹ thuật 1.0.0 đã định nghĩa | Không trùng identity/alias; giữ ID riêng và gắn nhãn similarity, không có yêu cầu gộp copy khác ID; đổi policy phải version contract/decision |
| O06 | Mục đích dùng, thời gian lưu và định dạng xuất | P00.04 chốt trước dữ liệu thật; chưa có policy lưu vô hạn. SQLite nội bộ/JSON evidence không quyết định định dạng xuất sản phẩm |

P00.01 đã có workload cụ thể, contract có thể kiểm tra và unknown còn lại được đánh dấu. P00.02 có thể kiểm tra route/quyền cho đúng ba loại nguồn; một route chỉ có Pages không đáp ứng toàn bộ workload. P01.01 có thể xây offline sau ADR-001; chưa khởi động benchmark hoặc tuyên bố G00 PASS.

Thay keyword/intent/source minima, unique semantics hoặc thời gian nghiệm thu sau freeze phải tạo campaign/contract/run version mới và decision record thích hợp, không sửa lịch sử kết quả cũ. Quy tắc kỹ thuật ở đây sẽ được ánh xạ sang domain và rubric trong P03/P05/P06; P00 chưa triển khai parser/classifier.
