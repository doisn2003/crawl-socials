# P02.02 — Kiểm text thực sự render trước khi ghép temporal

Ngày28/10/2026 giờ Asia/Bangkok, theo [LIVE v6](../evidence/p02-live-temporal-scope-v6-2026-10-28.md). CSD agent triển khai, `/root/csd_adapter` review độc lập, lead runtime/task/gates. Cần một patch hẹp và bằng chứng giải thích nguồn; chưa nâng cap hoặc mở continuation.

## Phạm vi

1. Tái hiện native Chromium: parent có box nhưng text node không có area; zero-area client rect; date ngắn cạnh nhiều text fragments không render, trong cùng known link. `visibleText` hiện shortcut parent RENDERED→true; loại shortcut sai bằng kiểm Range/glyph geometry có giới hạn. Wrapper display:contents và whitespace visible phải tiếp tục đúng, không quay lại R-T3 hoặc làm mất body snippet.
2. Tách các dạng hidden/layout/clipping/font nếu có repro cụ thể. Không tự coi mọi màu transparent là hidden khi text-shadow có thể vẽ glyph, không suy mọi offscreen node là private hoặc invisible. Ưu tiên geometry của text và ancestor clip trong phạm vi known record/boundary; mọi probe dùng global budget, không quét toàn DOM hoặc sửa CSS/page để hiển thị nội dung bị ẩn.
3. Giữ toàn bộ cap của v6. Nếu không xác định được visibility hoặc scan không đủ, giữ thiếu/loại record; không lấy prefix hoặc ép regex substring để có timestamp. Không `.textContent` toàn subtree, không GraphQL/response body/hover/see-more/scroll.
4. Bổ sung tối thiểu metadata counts để phân biệt parent-box shortcut cũ với text Range positive/zero-area/clip/unknown. Nếu cần, tối đa5record shapes theo enum/count gồm loại link, segment/char counts bị chặn và lý do; không raw text/date/labels/URLs/CSS/class. Phải đủ trả lời lần LIVE kế tiếp record quá dài do text thực sự render hay predicate sai; không thêm framework.
5. Fixture kiểm positive visible date +noise không render; negative hidden timestamp/private/quote/body; Range API missing/budget exhausted; giữ whitespace,96/97,known scope. Review đúng hành vi, không số test làm tiêu chí duy nhất. Metadata schema đổi phải đồng nhất script/controller/validator/writer.

Chưa khẳng định geometry là nguyên nhân thật; nếu không có repro/repair đủ chắc, bàn giao diagnostic narrow để lead đọc evidence thay vì phát minh nguyên nhân hoặc tăng cap. Runtime vẫn phải tiến tới lượt đọc nguồn kế tiếp sau review.

## Ownership

Giữ ownership candidate/fixture/tests và build riêng của dispatch scope trước. Reviewer chỉ reviewer tests/report/output. Lead shared dist/runtime/master/README. Không đổi BrowserHost/network/session/policy hoặc thao tác máy người dùng từ worker. Runtime20188/main1511604/source6361794 giữ query/public filter,1/3starts.

Bàn giao code-ready/hashes/targeted unit và native temporal/layout phù hợp; giữ unrelated checks đã nghiệm thu, không lặp mọi suite. Lead review/nạp cùng profile/read một lượt. Permission UNKNOWN/benchmark OFF/gates giữ nguyên.
