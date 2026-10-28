# P02.02 — Từ search đến một bài bằng timestamp đã quan sát

28/10/2026, Asia/Bangkok. Thực hiện ngay theo [ADR-016](../decisions/ADR-016-observed-search-post-open.md). Không tiếp tục refactor trace khi lỗi đã được giải quyết.

## Evidence và bài toán

- [LIVE v18](../evidence/p02-live-subframe-v18-2026-10-28.json): một anchor225ms; một reopen/read thành công3426ms; REOPEN_MATCH, body/context/quality khớp; không barrier/caps. Đây là một bài kỹ thuật, không hai unique records hoặc benchmark.
- Lead trở lại `cafe Hà Nội`, lọc Bài viết công khai, quan sát hai public-group headers trong AX. Cả hai timestamp link có host `www.facebook.com`, path `/search/top`, query keys `__cft__[0]`, `__tn__`. Không có numeric group/post route trong hai href đó. Đây là quan sát hẹp, không kết luận mọi link Facebook đều vậy.
- Click UI timestamp trước đó mở được nhóm và một post dialog. Cần nối đúng thao tác này trong CSD; không bịa post URL từ placeholder.

## CSD agent — implementation

Đọc current search candidate/header code và tái dùng phần có giá trị. Thêm smallest fixed discovery/click action cùng native menu/controller để mở một candidate header rõ ràng và gọi current-post reader. Discovery có thể mô tả tối đa5 targets, nhưng lượt đầu chỉ click một target, không batch loop. Nếu timestamp là DOM placeholder, click đúng element đã bind vào header; không loadURL placeholder với hy vọng thành bài.

Sự gắn kết candidate phải chống stale/replacement/ambiguous header và loại author/group title/body/comment/interactive actions. Không lấy global first link. Tái kiểm owned profile/view/document/route trước click; mọi selector/action đều fixed main-owned code. Không tạo DOM marker chứa PII hoặc API injection tùy ý. Nếu cơ chế không đủ evidence để chọn target thì trả lý do sạch; không mở rộng ngoài scope.

Tests cần chứng minh placeholder với click handler mở đúng post, read đúng body; stale target, sai/ambiguous link, owner/route thay, challenge, Stop/late result không tạo sample hợp lệ. Native Electron fixture thực có search placeholder và SPA route transition qua menu/watchers; không chỉ mock controller. Fixed post script giữ nguyên nếu không có lý do thực tế phải đổi.

Ownership: source/main/fixture/owner tests và isolated build như trước; thêm file module nhỏ nếu cần. Không reviewer files, shared dist, runtime/profile/.env, master/README hoặc task/gate. Freeze/handoff gồm đường thực thi menu và evidence để lead nạp ngay. Không làm queue/SQLite/framework.

## csd_adapter — independent review

Trước tiên hoàn tất audit v18 refs/hashes/relevance đang nhận; không in raw data. Sau đó review thiết kế và code ADR-016: target binding, no-action-on-ambiguity, owned navigation, barriers và lifecycle. Tests/evidence riêng; native thật sau freeze. Không tạo thêm worker hoặc chạm LIVE.

## Lead

Lead giữ PID27512/main3867858/source9109972, search công khai `cafe Hà Nội` đang mở;2/3 combined starts đã dùng. Chờ code được review mới activation, bảo toàn profile. Sau khi click tự động và đọc được bài, chuyển ngay tới pilot nhiều candidates (tối đa5), rồi continuation có giới hạn. Chưa nâng gate/valid/source availability từ REOPEN_MATCH.

## Ghi chú review trước implementation

Reviewer đã hoàn tất audit v18 và [review chuẩn bị](../evidence/adapter-p02-search-post-open-review-2026-10-28.md); đang chờ bản freeze, không phải đang chạy tests. Main tiếp tục triển khai. Lead đã chuyển các điểm binding/group-public/SPA lifecycle cho main.

Candidate admission `HEADING_PUBLIC` không chứng minh một link bất kỳ là timestamp. Cần proof riêng gắn link với đúng header; exact group-public phải có trong search context. Temporal text match là một tín hiệu tốt, nhưng không tự đặt nó thành điều kiện duy nhất: timestamp LIVE đã obfuscate và temporal hiện UNREADABLE. Nếu có unique structural header-link proof thay thế, phải giải thích cách loại author/group/body/action links và giữ zero-action khi mơ hồ hoặc node/wrapper/owner thay. Không chọn link đầu tiên toàn trang. Guard/barrier cần kiểm lại ngay trước action, và event đã xảy ra trước click không được nhận là kết quả click.

### Review sơ bộ 22:38 UTC — cần sửa trước nghiệm thu

Lead đã đọc code và nhận hai repro từ reviewer: placeholder có `aria-haspopup="true"` hoặc `rel="author"` vẫn bị chọn/click. Snapshot riêng có 2 positive/ambiguity PASS và 2 negatives FAIL; xem report/repro linked ở trên. Main đã nhận yêu cầu sửa explicit popup/author exclusions, giữ fallback timestamp cấu trúc, thêm negative native. Reviewer giữ failed snapshot và tiếp tục kiểm controller lifecycle khi pending click/read (owner native Stop hiện chỉ kiểm pending discovery). Không đưa bản đang viết này lên nguồn thật. Đây là lỗi code được tái hiện trên fixture, không phải lỗi Facebook đã quan sát.
