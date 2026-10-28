# ADR-009 — Giới hạn vận hành cho phép thử nguồn nhỏ

Ngày 2026-10-27, Asia/Bangkok. Người quyết định: lead `/root`, trong phạm vi người dùng giao điều phối/phát triển CSD tự chủ. Đây là lựa chọn kỹ thuật cho một phép thử P02.02; **không phải** ngân sách sản phẩm/benchmark 24 giờ đã được người dùng chốt, không phải quyền của Meta và không làm G00 PASS.

## Quyết định

Áp dụng đề xuất nhỏ của [protocol 1.0.0](../specs/benchmark_protocol.md): tối đa 3 query `quán cà phê`, `cafe Hà Nội`, `Tiny Cafe`; 30 phút từ Start; 100 candidates; 20 controlled collection actions gồm retry; 5 batch/query; 50 MB dữ liệu/evidence; 10 phút thao tác trong run; 1 retry/batch với lỗi transient. Hai batch không tiến triển dừng nhánh theo protocol. Dừng khi auth/challenge/access denied/schema failure; không đổi account/proxy tự động để tiếp tục.

Chi phí dịch vụ ngoài **0 VND**: không mua proxy, credit, Actor hay API. 20 actions không phải hard cap toàn bộ HTTP requests phát sinh từ browser; telemetry phải nói rõ coverage. Các ngưỡng là mức trần thử kỹ thuật, không hứa số bài thu được.

Dữ liệu probe chỉ lưu cục bộ trong namespace CSD ngoài repository và `.brain`, chỉ phục vụ đánh giá khả thi. Giữ phần cần đối chiếu trong tối đa 7 ngày sau run; sau đó cần xử lý hết hạn có kiểm soát, không hứa đã có retention scheduler. Không thu media hàng loạt, credentials, danh bạ hoặc thông tin không phục vụ bài toán. JSONL records + JSON summary là output tối thiểu; không upload hoặc chia sẻ ra ngoài. Trong `.brain` chỉ lưu summary đã làm sạch, refs và hashes.

Decision reference cho manifest sau này: `evidence://lead-probe-limits-2026-10-27`, trỏ tới quyết định này qua evidence map của run. Người ký là lead, không ghi `user-approved`. Manifest template chung giữ DRAFT/PROPOSED; run cụ thể chỉ bind quyết định này khi host thật đã triển khai và kiểm đúng các giới hạn. O04/O06 cho sản phẩm và benchmark chính thức vẫn mở.

## Điều kiện còn thiếu

- Host probe nhỏ có counters/deadline/stop/redaction/output thật; pin version/hash sau khi owner bàn giao. Không cần SQLite hoặc UI hoàn chỉnh.
- Route-condition assessment cho cách thu cụ thể với nguồn chính thức và kết luận có giới hạn. Ghi account thường/chưa có Meta grant như đã biết, không tự đổi thành được nền tảng cho phép.
- Phiên CSD do người dùng thiết lập hoặc route anonymous có evidence setup phù hợp. Không lấy credentials/profile/cookie từ ứng dụng khác.

P02.02 được chuẩn bị offline ngay. Phần chạy live chỉ bắt đầu sau lead review điều kiện G00; không hỏi lại câu cũ về Meta API và không yêu cầu proof search/paging/1.000 bài trước phép thử nhằm đo chúng.
