# CSD — Crawl Socials Data

**Portable 0.3.0-rc.6 (02/11/2026):** bộ lọc `goal-evidence-v3.0.0` dùng mục tiêu đã xác nhận để phân biệt người cần mua/thuê với người cung cấp. Kết quả cuối có **Phù hợp / Không phù hợp**. Từng điều kiện bắt buộc cần bằng chứng của đúng bài, bình luận và đối tượng; thiếu thông tin hoặc lỗi API vẫn ở trạng thái xử lý riêng. Kiểm định độc lập kiểm tra độ đầy đủ của mục tiêu; lượt kiểm tra riêng bình luận giúp tìm nhu cầu khi bài gốc không phù hợp. Ưu tiên mềm dùng để xếp hạng, không tự thành điều kiện loại. Có kiểm định ngữ cảnh, giá và thời hạn; Excel thêm `GoalEvidence` cho kết quả mới. Các lượt cũ giữ nguyên chính sách đã chạy; dùng **Tái lọc dữ liệu đã lưu** để đánh giá theo cơ chế mới. [Mốc tích hợp và kiểm chứng](.brain/evidence/goal-filter-integration-2026-11-02.md).

**Portable 0.3.0-rc.5 (02/11/2026):** đã tích hợp phương án được duyệt từ Keyword Lab v0.2.1: **phủ ngữ nghĩa có kiểm soát + hỏi ngược bằng LLM khi nhu cầu mơ hồ**. Chọn **Xem tiêu chí trước khi thu**, trả lời câu hỏi nếu có, rồi xem từ khóa và tiêu chí trước khi bắt đầu. Có thể nhập tự do, sửa mục tiêu hoặc quay lại sửa câu trả lời. Campaign mới dùng cùng mục tiêu đã chốt để tìm kiếm và phân loại. [Mốc tích hợp và kiểm chứng](.brain/evidence/semantic-dialogue-integration-2026-11-02.md).

**Portable 0.3.0-rc.4:** nhập **Gemini API Key → Lưu key** ngay trong Cấu hình thu thập của chế độ tìm cuộc thảo luận. Key được mã hóa bằng Windows, lưu riêng theo máy, không đưa vào config/preset hoặc Excel/JSON. Đã lưu trên máy được ưu tiên hơn biến môi trường; xóa key riêng sẽ dùng lại biến môi trường nếu có. Dừng lượt chạy/theo dõi trước khi thay key. Sang máy khác nhập lại key trong giao diện, không cần cấu hình biến môi trường.

**Portable 0.3.0-rc.3 (31/10/2026):** giao diện xuất Excel có phạm vi **Nhóm đang xem** hoặc **Tất cả bài đã thu**. Chế độ intent dùng 4 sheet `Conversations`, `Comments`, `DecisionHistory`, `Manifest`, cùng cấu trúc cột chính của dataset café đã giao; bình luận/trả lời đi kèm đúng các bài được xuất. `Manifest` ghi phạm vi và số dòng xuất. Bản Windows x64 kèm runtime; máy mới cần đăng nhập lại mạng xã hội và cấu hình `GEMINI_API_KEY`. Dataset, tài khoản và key trên máy cũ không nằm trong `.exe`.

Ứng dụng desktop Windows thu bài viết và bình luận từ Facebook và Threads. Chế độ tìm cuộc thảo luận nhận mô tả nhu cầu, lưu dữ liệu thô và phân loại ngay trong lúc thu; kết quả xuất được dưới dạng JSON hoặc Excel. Bộ thu theo từ khóa cũ vẫn có thể dùng riêng.

CSD nhận chủ đề từ prompt, chẳng hạn tìm dịch vụ sửa đàn, lựa chọn tai nghe, học ngoại ngữ hoặc tìm quán café. Café là chiến dịch kiểm thử hiện có, không phải chủ đề cố định của bộ máy. Mục tiêu 1.000 là số bài phù hợp cần tìm trong giới hạn nguồn/ngân sách; kết thúc sớm phải báo thiếu, không nới tiêu chí hoặc đếm bình luận thành bài mới.

## Nhánh phát triển được chọn

Từ ngày **07/11/2026**, **`main`** là nhánh phát triển chính thức của CSD. Các nâng cấp tiếp theo bắt đầu từ `main`, với nền là phiên bản người dùng đã chốt trên `production-v2` tại `7527f17`. Xem [kế hoạch v2](.brain/master-plans_restructor_version2.0.0.md) và [báo cáo triển khai](.brain/reports/csd-production-v2-20261106.md).

## Chạy ứng dụng

Cần Node.js theo `engines` trong `package.json` và Windows x64.

```powershell
npm ci
npm start
```

### Tìm cuộc thảo luận theo nhu cầu

1. Cấu hình `GEMINI_API_KEY` trong biến môi trường Windows của người dùng hoặc môi trường tiến trình. Không ghi key vào repository hay file cấu hình chiến dịch. Key được dùng cho Gemini API; ngân sách API được theo dõi riêng trong ứng dụng.
2. Bật **Tìm cuộc thảo luận phù hợp để thương hiệu tham gia**, nhập nhu cầu và bối cảnh thương hiệu nếu có. Chọn **tổng** mục tiêu, tỷ trọng Threads, giới hạn bài thô và ngân sách AI. Ví dụ 1.000 bài tinh là tổng hai mạng, ưu tiên 800 Threads + 200 Facebook; 700 + 300 cũng được chấp nhận.
3. Đăng nhập và chọn nguồn, rồi bấm **Bắt đầu thu thập**. CSD lưu quan sát thô trước, đồng thời chạy bộ lọc; bình luận thu được sau đó sẽ cập nhật kết luận cho cùng bài gốc.
4. Xem hai nhóm **Phù hợp** và **Không phù hợp**, mở **Đối chiếu điều kiện** để xem bằng chứng. Lỗi API hoặc thiếu dữ liệu nằm ở trạng thái xử lý riêng. Quảng cáo/review được nhận khi đúng mục tiêu người dùng đã xác nhận. Với dữ liệu cũ, hai nhóm loại được gộp để xem; việc gộp không có nghĩa đã chạy lại bộ lọc mới.
5. Chọn nhóm rồi xuất Excel hoặc JSON, kể cả khi lượt thu đang chạy. Workbook có `Conversations`, `Comments`, `DecisionHistory`, `Manifest`, lưu bằng chứng, phiên bản bộ lọc, chi phí và mốc dữ liệu của lần xuất.

Thu bình luận được giới hạn theo lượt và ghi rõ mức bao phủ; CSD không khẳng định đã đọc toàn bộ bình luận của mạng xã hội. Sau khám phá, ứng dụng có thể theo dõi những bài đủ điều kiện theo lịch 2/8/24 giờ, tối đa 72 giờ. **Dừng** lưu hàng chờ; **Tiếp tục** tiếp nối lượt hiện có. Chỉ mở lại ứng dụng không tự chạy lại. CSD tìm cơ hội tham gia, không tự đăng bình luận.

Trước khi thu theo nhu cầu, chọn **Xem tiêu chí trước khi thu**. Nếu có điểm mơ hồ quan trọng, CSD hiển thị tối đa ba câu hỏi mỗi lượt; chưa trả lời thì chưa thu thập. Phần **Xem / sửa mục tiêu đã hiểu** và **Lịch sử trả lời / sửa câu trả lời** gọi AI để cập nhật kế hoạch. Sửa trực tiếp chủ đề, nhu cầu, điều kiện giữ/loại, khu vực, truy vấn và lịch theo dõi trong bảng tiêu chí thì không gọi AI; bấm **Lưu tiêu chí** trước khi bắt đầu. Bấm **Bắt đầu** khi chưa có kế hoạch sẽ lập kế hoạch trước, để bạn xem và bấm lần nữa sau khi sẵn sàng.

Hội thoại, phiên bản kế hoạch và chi phí được giữ qua restart; khi thử lại sau lỗi, CSD dùng cùng mã lượt và sổ chi phí. Câu trả lời/sửa mục tiêu mới thay thế ý cũ của cùng trường nhưng lịch sử vẫn được giữ. Campaign cũ tiếp tục dùng recipe đã lưu; những trường bộ lọc cũ chưa áp dụng riêng vẫn chỉ đọc. Chế độ từ khóa thủ công tiếp tục dùng luồng riêng.

Đặt tên rồi **Lưu bộ lọc** để tái sử dụng toàn bộ tiêu chí. **Áp dụng** khôi phục nhu cầu và bối cảnh thương hiệu của bộ lọc, giữ mục tiêu/tỷ lệ/ngân sách đang chọn và tạo lượt mới; bước này không gọi AI lập lại kế hoạch. Mỗi lượt giữ phiên bản tiêu chí riêng để đối chiếu kết quả.

Chi phí hiển thị được tính từ token sử dụng và bảng giá lưu cùng lượt chạy; các lần gọi không biết mức sử dụng được giữ khoản dự phòng riêng. Hết ngân sách hoặc quota model sẽ tạm dừng, giữ dữ liệu và hàng chờ. Kết quả phân loại là đánh giá của model, cần đọc cùng báo cáo kiểm chứng tại [.brain/evidence/conversation-production-2026-10-30.md](.brain/evidence/conversation-production-2026-10-30.md).

Bản **0.3.0-rc.2** là bản thử nghiệm tích hợp bộ máy này. Kiểm thử phần mềm đã bao phủ nhiều chủ đề; độ chính xác ngữ nghĩa trên nhiều ngành chưa được chứng nhận. Bộ kiểm tra bổ sung và chính sách tự đánh giá lại theo thời hạn đang nghiên cứu không bật mặc định. Bài quảng bá liên quan cũng có thể được theo dõi để phát hiện câu hỏi mới; số đếm bình luận bị thiếu được giữ là chưa biết.

Mã nguồn sau RC2 đã thêm **Tái lọc dữ liệu đã lưu**: lập/lưu một kế hoạch mới, tải danh sách nguồn, chọn lượt dữ liệu rồi bắt đầu tái lọc. Không cần phiên Facebook/Threads cho thao tác này. Hỗ trợ journal hội thoại và file `posts.jsonl` do collector cũ tạo; giữ nguyên nguồn, cố định mốc đọc và tạo sổ chi phí riêng cho lượt mới. Khi cap bài thô nhỏ hơn nguồn, chọn theo tỷ lệ Threads/Facebook của kế hoạch và dùng phần còn lại nếu một mạng không đủ bài. Lượt nhập dở có thể Dừng/Tiếp tục; phân loại chỉ bắt đầu sau khi dựng đủ ngữ cảnh của phần dữ liệu đã chọn. Chưa có nội dung bình luận trong dữ liệu cũ thì không suy ra bình luận từ số đếm.

Nút **Thêm thư mục dữ liệu** cho phép chọn thêm thư mục CSD có `collections`, kể cả dữ liệu nằm ở AppData khác trên Windows. Thư mục nguồn được cố định cho lượt tái lọc; lỗi một nguồn không làm mất danh sách nguồn còn lại. Lượt thu mới áp dụng thứ tự nguồn của kế hoạch như tiêu chí xếp hạng phụ và giữ nguyên thứ tự đó khi Tiếp tục.

Thu trực tiếp có giới hạn dung lượng riêng cho mỗi lượt và kiểm tra dung lượng trống trước khi lấy thêm trang/bình luận. Khi bộ lọc chậm, collector chờ xử lý backlog; khi chạm ngưỡng lưu trữ, nó dừng nhận thêm và giữ dữ liệu đã quan sát. Giới hạn này chưa áp dụng cho đường nhập dữ liệu đã lưu; không tự xóa dữ liệu. [Bằng chứng tích hợp và giới hạn](.brain/evidence/external-source-storage-ranking-2026-10-31.md).

Planner mới lưu trích dẫn và vị trí làm căn cứ cho khu vực, ngôn ngữ, tuổi bài và ưu tiên nguồn; phân biệt bắt buộc với ưu tiên mềm. Khả năng áp dụng từng trường vẫn phụ thuộc phiên bản bộ lọc, được ghi trên giao diện. Planner/chi phí của lượt thử lại được giữ cùng phiên bản; bản nháp đã hoàn tất không phải lập lại. Các thay đổi này đã kiểm thử ở mã nguồn, **chưa nằm trong portable RC2**. Xem [bằng chứng và giới hạn](.brain/evidence/retained-grounded-engine-2026-10-31.md), gồm trường hợp Windows ánh xạ dữ liệu sang AppData riêng của một gói ứng dụng.

### Thu thô theo từ khóa

Tắt chế độ tìm cuộc thảo luận để dùng luồng cũ:

1. Nhập từ khóa, **mỗi dòng một từ khóa**. Rời ô để lưu tự động.
2. Nhập mục tiêu tối thiểu (1–3.000 bài). Rời ô để lưu. **Mỗi mạng được chọn có mục tiêu riêng**; ví dụ nhập 1.000 và chọn cả hai thì mục tiêu là 1.000 Facebook + 1.000 Threads.
3. Đăng nhập tài khoản trong cửa sổ của từng mạng. Chỉ nguồn có phiên đăng nhập mới được tick chọn.
4. Bấm **Bắt đầu thu thập**. Facebook và Threads mở hai cửa sổ riêng và **chạy song song**, mỗi mạng có tiến độ và mục tiêu riêng. Một mạng xong hoặc gặp lỗi không chặn mạng còn lại. Nút **Dừng** dừng cả hai, chờ lưu dữ liệu rồi cho phép xuất số bài đã thu được.
5. Bấm **Xuất Excel .xlsx** hoặc **Xuất JSON**, chọn nơi lưu. Workbook có hai sheet kể cả khi một mạng không có kết quả; hàng tiêu đề xanh, bộ lọc, cố định hàng đầu, ID dạng chuỗi, link bấm được. Giá trị thiếu để trống, không đổi thành 0.

TikTok, Instagram, X, Reddit là badge mờ chưa thể chọn.

Trong chế độ từ khóa, mục tiêu là số bài thô không trùng trong từng lượt: dữ liệu nguồn, phiên hết hạn, mạng, giới hạn 4 giờ/mạng, 50 lần cuộn/từ khóa Facebook và 100 lần cuộn/từ khóa Threads có thể kết thúc lượt sớm. Ứng dụng báo chưa đạt nếu nguồn kết thúc trước mục tiêu. Chế độ này không tự đánh giá mức liên quan. Có thể vượt mục tiêu một batch hoặc khi đi qua các từ khóa.

## Make it cooler

Bật toggle ở góc dưới bên phải để mở cửa sổ terminal khi bắt đầu thu thập. Hai thanh Facebook/Threads cố định phía trên hiển thị tiến độ thật, nền nhị phân xanh hacker chạy nhẹ bên dưới. Bật khi đang thu cũng mở terminal; tắt hoặc đóng terminal không dừng lượt thu. Tùy chọn được lưu qua lần mở ứng dụng tiếp theo. Hiệu ứng dừng khi thu xong, cửa sổ bị ẩn hoặc hệ điều hành yêu cầu giảm chuyển động.

## Phiên và dữ liệu

- `%APPDATA%/csd-desktop/data/user-config.json`: cấu hình thật, ghi nguyên tử; lần đầu danh sách từ khóa trống.
- `data/browser-profiles.json`: giữ nguyên ID và nền tảng của profile cũ.
- `browser/`: partition Chromium `persist:csd-v1-<id>` riêng cho mỗi tài khoản.
- `secrets/`: bản sao session cookie mã hóa bằng Windows safeStorage, không có plaintext fallback.
- `data/collections/crawl-<uuid>/facebook/` và `threads/`: `posts.jsonl`, `posts.json`, config và nhật ký lượt chạy.
- `results.json`: kết quả kết hợp của lượt; `data/latest-run.json`: trạng thái lượt gần nhất. Sau khi đóng bất thường, mở lại sẽ báo gián đoạn và giữ dữ liệu đã ghi; không tự chạy lại.
- `opportunity/`: tiêu chí chiến dịch, công thức lọc bất biến, nhật ký dữ liệu thô, SQLite chứa hội thoại/hàng chờ, lịch sử quyết định và sổ chi phí từng model. `opportunity-results.json` là bản xuất có mốc dữ liệu. Không xóa riêng sổ chi phí khi tiếp tục lượt hoặc đổi model.
- Kế hoạch nháp và các lần sửa được lưu trong thư mục của lượt đã cấp mã trước khi gọi AI; bộ lọc lưu riêng dưới `data/filter-presets/`. Chúng giữ nguồn gốc, phiên bản và recipe, không chứa khóa API.
- `user-config.json.v1.backup`: bản sao cấu hình cũ trước lần lưu cấu hình v2 đầu tiên. Khi quay về binary chỉ hỗ trợ v1, đóng CSD, giữ bản v2 rồi khôi phục bản sao v1; giữ nguyên các thư mục dữ liệu.

Đóng ứng dụng hoặc cửa sổ tài khoản không xóa đăng nhập. Facebook/Threads vẫn có quyền hết hạn hoặc thu hồi phiên; lúc đó phải đăng nhập lại. Ứng dụng chỉ đưa trạng thái phiên ra UI, không đưa cookie hay mật khẩu qua IPC. Khi checkpoint/challenge xuất hiện, bộ thu dừng; người dùng xử lý trực tiếp trong cửa sổ đăng nhập.

## CLI

```powershell
npm run collect:facebook -- --query "từ khóa của bạn" --target 1000
npm run collect:threads -- --query "từ khóa của bạn" --target 1000
```

CLI yêu cầu từ khóa hoặc config rõ ràng, không tự nạp bộ từ khóa mẫu. Đóng ứng dụng trước khi dùng CLI với cùng profile. Điều khiển lượt CLI bằng `collector:control` / `threads:control -- --config <path> --stop` hoặc `--export`; tiếp tục CLI bằng `collect:facebook` / `collect:threads -- --config <path> --resume`. Luồng UI không đọc mật khẩu từ `.env`; helper đăng nhập CLI Threads trước đây chỉ dùng khi chạy CLI.

## Phát triển và đóng gói

```powershell
npm run check
npm test
npm run pack:dir
npm run dist:portable
```

`src/main/index.ts` chỉ có composition root production. `src/application/production-service.ts` quản lý config, đăng nhập, lượt thu và kết quả. `scripts/*-collector.mjs` dùng chung bộ thu đã có cho CLI và UI. `src/infrastructure/export/social-workbook.ts` xuất Excel bằng ExcelJS. `src/renderer/` chỉ gọi bridge hẹp trong preload, không có Node hoặc truy cập tài khoản trực tiếp.

Build xóa output cũ rồi chỉ biên dịch dependency production, copy các bộ thu bài/bình luận, bộ tìm bài gốc và trạng thái tiếp tục truy vấn cùng tài nguyên UI; không đóng gói dữ liệu mẫu, fixture, bootstrap hoặc probe. Unit fixtures và các kiểm tra hồi quy cũ chỉ phục vụ phát triển, không xuất hiện trong ứng dụng. Hướng dẫn cho AI Agent bắt đầu ở [.brain/README.md](.brain/README.md).
