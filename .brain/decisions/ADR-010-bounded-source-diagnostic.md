# ADR-010 — Gỡ đình trệ bằng thử nghiệm nguồn có giới hạn

Ngày 2026-10-27, Asia/Bangkok. Người quyết định: lead `/root`, theo ủy quyền phát triển/điều phối và yêu cầu mới nhất của người dùng: tìm nguyên nhân rồi khắc phục.

## Nguyên nhân đã xác định

Login và Posts search có kết quả đã được người dùng xác nhận. Không có bằng chứng Facebook hiện chặn mọi bài. Trong code production, `createProbeController` nhận `driver: null`; driver hiện có chỉ gọi loopback fixture. Controller/writer hiện chưa có đường thu bài Facebook. Đây là công việc chưa triển khai, không phải lỗi nguồn đã được chứng minh.

Lead đã để assessment về điều kiện nền tảng trở thành vòng chờ không có hành động, dù UI đã được khảo sát. Dừng cả hai worker mà không đưa ra bước khắc phục cụ thể là lỗi điều phối. Không xóa dự án, không hỏi lại Meta API hoặc login, không tiếp tục thêm framework để thay cho kiểm chứng nguồn.

## Quyết định kỹ thuật và phạm vi thay thế

Cho phép triển khai và, sau review code, chạy một **source diagnostic có giới hạn** bằng phiên CSD do người dùng đã thiết lập. Đây là ngoại lệ hẹp cho bước khám phá kỹ thuật P02.02 trước G00; thay quy định mọi quan sát tự động đều phải chờ G00 trong ADR-008/009, runbook và assessment cũ. Không sửa hay xóa bằng chứng lịch sử.

- Bước đầu: đọc cấu trúc DOM đang hiển thị trên trang Posts bằng script cố định, không gọi endpoint/GraphQL đoán sẵn. Ghi số card, cấu trúc/nhóm URL được chuẩn hóa và lý do thiếu trường; không dump DOM, raw response, tên người, nội dung bài, query/token hoặc toàn bộ accessibility tree.
- Sau khi có cấu trúc thật được review: lấy tối đa 5 ứng viên từ chính trang đó nếu có đủ bằng chứng nội dung công khai. Thiếu publicity/identity/text thì giữ UNKNOWN hoặc loại khỏi mẫu công khai; không suy PUBLIC từ việc tài khoản nhìn thấy bài.
- Một query `cafe Hà Nội`, một batch, tối đa 5 phút và 3 controlled actions cho mỗi run. Không retry, continuation, cuộn hàng loạt, click tương tác xã hội hoặc mở nhóm riêng tư. Phân biệt action với HTTP request trình duyệt tự phát sinh.
- Ưu tiên đọc trang hiện có. Nếu cần nạp build mới, lead đóng app theo lifecycle lưu phiên và mở lại đúng profile; không kill tiến trình hoặc chép cookie/profile sang tool khác. Không bắt người dùng login lại khi chưa có dấu hiệu session hết hạn.
- Auth/checkpoint/challenge/access denied hoặc mất owned view: dừng run và ghi lý do. Không vượt xác minh, đổi account/proxy/fingerprint, mở rộng network allowlist khi chưa có bằng chứng lỗi cụ thể.
- Output nằm ngoài repo trong userData, local-only, retention theo ADR-009. `.brain` chỉ summary/hash. Phải ghi capture_mode LIVE cho quan sát thật, diagnostic_only=true, benchmark_eligible=false, verified valid count=0. FIXTURE và dữ liệu thật không trộn.
- Trusted main sở hữu thao tác, script cố định và giới hạn; không mở arbitrary JS/URL/credentials bridge cho renderer. Stop/deadline/late-result/owner-change phải có kiểm tra.

## Những gì quyết định này không chứng minh

### Bổ sung từ UI thật lúc 20:44 ngày 27/10/2026

Lead mở lại cùng profile sau build; session tự khôi phục, không nhập credentials. Search `cafe Hà Nội` trả đúng `/search/top/`, sidebar chọn `Tất cả` nhưng có bộ lọc bài viết, kết quả nhìn thấy gồm Page card và post card. Native preflight run `dom-5f417a6c-fcf6-4e98-9ab8-eb259241c287` trả UNSUPPORTED_ROUTE/actions0 vì bản đầu chỉ nhận `/search/posts/`.

Cho phép diagnostic cấu trúc **riêng exact `/search/top/` với cùng query cố định**, gắn `SEARCH_TOP_MIXED`, bên cạnh exact `/search/posts/`. Không cho mọi `/search/*`, không gọi mixed route là Posts-only hoặc suy user chọn nhầm Actor/entity. Diagnostic vẫn chỉ metadata, không thu nội dung/định danh và không xác nhận public candidate. Việc phân biệt Page/post/ad là điều schema diagnostic cần làm rõ trước extractor. Bổ sung này dựa trên UI trực tiếp, không đổi mẫu thật thành benchmark hoặc đổi permission.

Người dùng chưa có chấp thuận automation riêng từ Meta: giữ nguyên sự thật đó. `platform_permission=UNKNOWN`, không đổi thành ALLOWED hoặc mô tả lead/user authorization là permission của Meta. Đây là quyết định tiến hành thử nghiệm kỹ thuật trong phạm vi người dùng giao, không kết luận pháp lý hoặc bảo đảm điều khoản cho phép.

G00–G05 vẫn NOT_EVALUATED. Diagnostic không mở khóa benchmark 1.000 bài, sản phẩm thương mại, P04/scale hay collector tổng quát; planner và protocol benchmark giữ gate hiện hành. Kết quả nhỏ chỉ trả lời cấu trúc nào đọc được, trường nào thiếu và chỗ nào cần sửa.

## Điều phối

Theo [dispatch P02.02](../handoffs/lead-p02-dom-diagnostic-dispatch-2026-10-27.md). CSD agent triển khai; `/root/csd_adapter` review độc lập và kiểm giới hạn/provenance. Lead nghiệm thu rồi chạy thử nhỏ, phân loại kết quả trước khi mở rộng. Nếu thất bại, giao sửa nguyên nhân cụ thể từ evidence; không quay lại trạng thái chờ chung chung.
