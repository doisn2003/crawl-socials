# E2E cafe chill và gặp gỡ/giao lưu — 06/11/2026

Trạng thái: COMPLETE; lỗi cuối: không. Model: gemini-3.1-flash-lite. Tổng chi phí API $0.484191 / $5; held $0.000000; 318 calls.

## Prompt cuối dùng để thu

A: Tìm nhu cầu tìm quán cafe chill; chia sẻ trải nghiệm đi cafe chill; thảo luận về quán cafe chill.

B: Tìm nhu cầu hẹn hò với người chưa quen; gặp gỡ và giao lưu với người lạ; tìm bạn mới hoặc bạn trò chuyện; rủ người chưa quen đi cà phê.

Tiếng Việt, POST_ONLY; địa bàn không bắt buộc; tuổi bài không giới hạn.

## Kết quả

| Chủ đề | Mode | Raw duy nhất | Được nhận | Bị loại | Pending | Tỷ lệ nhận/raw | USD tăng thêm | Phút lượt cuối |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| A | CONSISTENT | 470 | 293 | 142 | 35 | 62.3% | $0.007794 | 2.6 |
| A | STANDARD | 470 | 269 | 166 | 35 | 57.2% | $0.003113 | 0.2 |
| A | QUALITY | 470 | 236 | 153 | 81 | 50.2% | $0.076060 | 1.3 |
| B | CONSISTENT | 331 | 209 | 93 | 29 | 63.1% | $0.102531 | 3.3 |
| B | QUALITY | 331 | 118 | 137 | 76 | 35.6% | $0.062184 | 1.0 |

Chi phí chung cho lỗi chuẩn bị, các lượt dừng/sửa và thử lại: $0.232510; đã nằm trong tổng. Thời gian toàn nhiệm vụ tính từ 2026-11-06T09:26:23.886Z; bảng phút chỉ tính lượt cuối của từng case.

## Đối chiếu

- Các root được khử trùng theo platform+root_id. Kiểm tra raw cap, POST_ONLY và tham chiếu evidence đều đạt.
- Cùng tập raw cho A STANDARD/QUALITY và B CONSISTENT/QUALITY. Hash tiêu chí tương đồng: A=true; B=true. Nếu false, phép so còn chịu ảnh hưởng của diễn giải planner giữa các lượt.
- Ba mode A dùng cùng470root và hai mode B dùng cùng331root. Cả hai lượt thu đều dừng NO_PROGRESS trong các query đã lập; không chạm raw cap hoặc trần tiền. A dùng9query, B dùng11query. Đây không phải số bài tối đa trong lĩnh vực.
- A CONSISTENT của lượt cuối đã nạp lại462root thu trước rồi tìm thêm8root; số phút lượt cuối không phải thời gian thu470root từ đầu. Tổng nhiệm vụ gồm chuẩn bị, sửa lỗi và các lượt bị dừng.
- Tỷ lệ nhận là kết quả model, không phải độ hữu ích được gán nhãn độc lập. Chưa đủ căn cứ xác nhận CONSISTENT >50% hay STANDARD 60–80% hữu ích.
- Chi phí tăng thêm có hưởng cache; không dùng nó để báo giá một lượt độc lập không có cache.

## Lỗi E2E và bản sửa trong nhiệm vụ

- Phân rã câu địa bàn ưu tiên và danh sách loại trừ thành query dương; thiếu đủ bảy trường intent: đã bổ sung kiểm tra/hướng dẫn và hồi quy. Prompt dài đầu tiên vẫn cho thấy planner nhạy với ràng buộc; các phản hồi lỗi được giữ.
- Thiếu query chủ đề trần: đã giữ các anchor có từ gốc. Cần đo thêm mức đa dạng và số root mới theo nhóm; có24 nhóm trong taxonomy không đảm bảo mỗi plan có24 nhóm.
- Nhường cửa sổ do CPU trong lúc replay checkpoint: đã bảo vệ lượt tải lại tới một trang mới, giữ dừng khẩn cấp khi RAM thấp.
- Tầng điều phối từng requeue cả frontier đã STALLED: đã nhận đúng tín hiệu dừng không tiến triển, giữ checkpoint để resume rõ ràng; không gọi STALLED là nguồn đã cạn.
- Bộ đếm no-progress bị reset giữa các slice3trang trong khi ngưỡng4trang: đã lưu qua checkpoint, replay không tự xóa hay cộng bộ đếm. NO_PROGRESS là dừng vận hành có thể resume, không phải chứng minh hết dữ liệu.
- Runner từng đặt output trong workspace và sai cờ truy cập BrowserHost: đã sửa, giữ các lần thử0raw trong artifact và tính toàn bộ chi phí.

## Nguồn và dữ liệu

- Sổ model, task/status, trial-before-fix-*, kết quảJSON/XLSX nằm trong artifacts/cafe-social-e2e-20261106; dữ liệu thu thực tế nằm ngoài workspace, xem live-data-path.json.
- verified-report.json lưu số liệu, hash và đối soát. Không sửa ledger lịch sử, không đưa raw/key/cookie vào commit.
- Chi phí là token usage nhân bảng giá Standard, chưa phải hóa đơn Google. [Giá Gemini](https://ai.google.dev/gemini-api/docs/pricing?frmapp=yes).

## Kiểm thử phần mềm và phạm vi E2E

- `npm run check`, build và **1.070/1.070 tests** đạt; Electron UI smoke đạt, không network/modelcalls và không lỗi renderer trong smoke.
- E2E thu thật qua Electron/ProductionService cho A CONSISTENT và B CONSISTENT; các mode còn lại đánh giá lại cùng raw cố định qua pipeline thật. UI smoke riêng dùng mockhost, không dùng số test pass để khẳng định chất lượng phân loại.
- Dữ liệu A có62root Facebook/408root Threads; B có53/278. Hai topic trùng9root; tổng thu có792root phân biệt xuyên topic. Không phải792người tiêu dùng duy nhất.

## Diễn giải chất lượng

- QUALITY A có81pending:33primary chưa giải quyết,34mâu thuẫn fact giữa hai lượt đọc,12thiếu evidence,2chưa xác minh ngôn ngữ. QUALITY B có76pending, gồm30mâu thuẫn fact và các lỗi/thiếu bằng chứng khác. Pending không phải bài đã được chứng minh không phù hợp.
- Với A, STANDARD/QUALITY cùng nhận234root;35root chỉ STANDARD nhận (31bị QUALITY loại,4chờ),2root chỉ QUALITY nhận sau review. Chênh lệch bao gồm cả review sự kiện và chính sách nhận, không phải một ngưỡng phần trăm đơn giản.
- Chưa có nhãn tham chiếu độc lập đủ mẫu. Rà soát20raw trung gian của trợ lý chỉ là kiểm tra định tính, không chứng minh độ hữu ích >50% hoặc60–80%.

## Kết luận nghiệm thu

A CONSISTENT chưa đạt target1000 được nhận. Không thể xác nhận cam kết500–5000 bằng kết quả này. Cần ưu tiên mở rộng truy xuất, giảm replay và đo số root mới thực sự tăng thêm trước khi phát hành.
Nếu các mode dùng dưới1000raw, chỉ kết luận trên tập đã thu; không nội suy thành kết quả1000raw. Chưa nghiệm thu100bài/tháng.

## Bàn giao

Email khởi đầu, hai email tiến độ và email tổng kết đã gửi từ `trangnguyen208203@gmail.com` tới `ngocdoisamsung@gmail.com` qua Gmail plugin. Email tổng kết có nhãn SENT, message ID `1a1b06a72f88d239`. Lịch `email-ti-n-e2e-csd` đã PAUSED sau hoàn tất. Cumulative DEVELOPMENT đã đóng; không có giữ chỗ chi phí.
