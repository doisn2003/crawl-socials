# Review kết quả nhánh Facebook — 28/10/2026

## Kết luận

**Có giá trị thực: đã lưu 5 bài khác nhau cùng link và metadata từ JSON nhúng trong trang Facebook Search. Chưa có bộ thu tự động nhiều batch, chưa chứng minh phân trang bằng request.** Nên tiếp tục từ đường dữ liệu đã tìm được, không bắt đầu lại vòng sửa DOM/timestamp cũ và không bắt buộc mọi tiến bộ phải đi qua request pagination.

Review này chỉ đọc code/dữ liệu và chạy kiểm offline. Không mở Facebook, gọi nguồn mới, đổi nhánh, khởi động worker hay automation. Không thay trạng thái nghiệm thu master plan.

## Đã kiểm độc lập

- Đọc `branch-request-pagination-result.md`, báo cáo follow-up và code trên hai nhánh thử bằng `git show`.
- Dataset ngoài Git: `C:/Users/Admin/AppData/Roaming/csd-desktop/data/request-experiment-20261028/posts-reviewed.jsonl`.
- File 14.483 byte, **5 dòng, 5 post ID khác nhau, 5 URL khác nhau**. SHA-256 khớp báo cáo: `f4dd99c0c5ecab24678dd6fa78d904a767a20f5e59e5f27963dffaaddc6c4623`.
- Link, text, timestamp và bốn trường counter của 5 dòng đều khớp projection `observed-record-fields.json` được lưu cùng đợt. Đây là đối chiếu các artifact cục bộ, không phải tái xác minh với Facebook hiện tại.
- Dataset phân loại **2 PAGE, 3 GROUP, 0 PROFILE**, cả 5 có evidence PUBLIC được ghi lại. Cả 5 có ngày đăng, tổng reactions, số bình luận và chia sẻ; 3 bài chưa có love_count, được giữ null.
- 2 bài được review là đúng chủ đề quán/café; 3 bài tuyển dụng/sang nhượng đang UNVERIFIED, không tự coi là ngoài phạm vi. Do đó không gọi cả 5 là bài đã nghiệm thu benchmark.
- Đối chiếu lại snapshot DOM `command-1793157030136.json`: **5/5 khớp tiền tố 40 ký tự sau chuẩn hóa NFKD, bỏ ký tự ngoài chữ/số, lowercase**. SHA-256 của trường text trong snapshot là `ee42960a41a6610e8c230737e524a3dfdca1bc434fc2c8345d10c0d99cfc4a50`, khớp evidence. Đây là hash **text**, không phải hash toàn file. Không có bài nào khớp toàn văn theo phép đối chiếu này; không suy thành lỗi vì giao diện có thể rút gọn, nhưng cũng không chứng nhận full text.
- Không permalink nào được mở lại độc lập; cả 5 không có request/response correlation. Giá trị hiện tại là permalink và Story metadata đã quan sát, không phải kiểm chứng mọi mặt của bài.
- Trích parser/test từ nhánh fallback, transpile vào output riêng bị Git ignore, chạy `node --test`: **5/5 test PASS**. Đây là kiểm logic offline; lượt review không chạy full build/typecheck hay nguồn thật.

## Giá trị kỹ thuật

Đã tìm được đường schema thực:

`data.serpResponse.results.edges[].rendering_strategy.view_model.click_model.story`

Điều này cho phép trích link, nội dung và metadata theo Story từ dữ liệu có cấu trúc của trang, không cần mở từng bài hoặc lần theo trang trí timestamp. Pure parser có thể tái sử dụng nằm tại `src/infrastructure/browser/facebook-search-embedded-parser.ts` trên nhánh `experiment/facebook-embedded-link-first`. Nó **chưa được nối vào app**; dedup hiện chỉ trong một lần parse, chưa phải cơ chế resume collector.

## Điều còn thiếu và giả thuyết cần phân biệt

1. **Chưa có batch B:** 0 continuation request, 0 bằng chứng lấy bài mới sau trang đầu. `has_next_page=true` và cursor nhúng chỉ là tín hiệu còn trang; không chứng minh khả năng replay.
2. Phép thử chỉ dùng 2 search load và 2 lệnh `window.scrollTo(0, document.body.scrollHeight)`, host đặt `hidden:true`. Cả hai kết thúc tại cùng vị trí đáy; capturePage báo UnknownVizError. Chưa chứng minh đã kích hoạt đúng scroller/load-more. Visibility, rendering hoặc scroller sai là giả thuyết, **chưa phải nguyên nhân đã xác nhận**.
3. Listener ban đầu chỉ nhận POST có inline postData và operation khớp `^Search|^CometSearch`; body reader lại bỏ request ID chưa được listener ghi nhận. Nhánh quan sát bổ sung có nới việc lấy postData, nhưng vẫn cần audit độ phủ. Không thấy operation trong bộ lọc này không chứng minh toàn bộ trang không gửi phân trang.
4. Runtime thử hardcode thời điểm, query, output và từ chối chạy khi đã có receipt kết thúc. Không dùng nguyên script đó làm sản phẩm hoặc rerun bằng cách xóa evidence.
5. Parser chưa hỗ trợ PROFILE có bằng chứng; strategy quảng cáo đã thấy cũng chưa được hỗ trợ. Không tự suy `GraphQL User = PROFILE`, không loại mọi quảng cáo chỉ vì một strategy chưa parse được.

Trần hai lượt cuộn là ràng buộc của kế hoạch cũ mà agent đã tuân thủ. Không quy việc dừng đúng trần thành bằng chứng agent đã thử hết cách hoặc Facebook bất khả thi. Prompt tiếp nối phải thay phép thử quá hẹp này bằng phát triển bộ thu có đo yield, chẩn đoán theo giả thuyết và tránh lặp vô hạn.

## Tình trạng Git và bàn giao

Khi bắt đầu review: main sạch, HEAD `7bbc231`; baseline `46e7d20b8befc90b2530de54dd86fd09ae693058`. Nhánh request giữ checkpoint `b273bc2a5aedc46cd68f34c5c3a5df18dfa16f90`; nhánh parser giữ `89c844f1ffccea26fa567513ec6b61f96b3a1b55`. Code thử chưa merge main.

Prompt mở để người dùng giao cho agent tiếp tục: [collector-continuation-prompt.md](../collector-continuation-prompt.md). Tài liệu này không tự khởi động công việc. Quyền chạy tiếp bắt đầu khi người dùng gửi prompt cho agent đó.
