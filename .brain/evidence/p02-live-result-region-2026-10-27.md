# P02.02 — Vùng kết quả thật sau sửa root

Ngày 2026-10-27, Asia/Bangkok. Lead `/root` review và chạy; nối tiếp [lượt v1 chạm cap](p02-live-dom-structure-2026-10-27.md). Đây là diagnostic theo ADR-010, chưa phải mẫu bài hợp lệ hoặc benchmark.

## Nghiệm thu code v2

Lead đọc controller/script/menu/fixture và review độc lập. Reviewer phát hiện selector có thể nhận chính `nav role=main` hoặc `aside role=feed`; owner đã thêm self exclusion và root guard. Lead compile riêng `.test-build-lead-region`, chạy 14 owner +9 reviewer tests: **23/23 PASS**. Native fixture **3/3 PASS**, summary ở [lead fixture](lead-p02-result-region-fixture-2026-10-27.json). Manifest [owner](p02-result-region-files-2026-10-27.json) khớp **10/10 owned hashes**. Shared `npm run build` đạt; **121/121** entry của frozen build khớp.

- Fixed script SHA256: `f4d32a68fabfa17474b7a52f4ade51ce1d3f81bd74e71b697ec132170b7f323f`.
- Compiled controller SHA256: `fd433cbe1806cd1e839e4f65b85c03d7d3abee94d56ec142c716a1110170210b`.
- Reviewer report: [adapter review](adapter-p02-dom-diagnostic-review-2026-10-27.md).

Lead đóng app theo lifecycle, nạp bản mới cùng profile. Session khôi phục; không nhập credentials. Runtime sau nạp: root PID1632, main window3281454, Facebook source2362756. Không thay profile/cookie, không mở DevTools hoặc network-body observer.

## Hai quan sát thật trên cùng query

| Trường | Trước chọn bộ lọc công khai | Sau chọn bộ lọc công khai |
| --- | --- | --- |
| Run | `dom-ace3d113-feed-4c20-b493-6d4621d91354` | `dom-d4bb636b-52a4-44ad-974a-75ec3484a14a` |
| UTC bắt đầu | 14:12:30.256Z | 14:18:07.072Z |
| Thời gian read | 22ms | 20ms |
| Route/query | SEARCH_TOP_MIXED / cafe Hà Nội | SEARCH_TOP_MIXED / cafe Hà Nội |
| Root / probes / candidates | ROLE_MAIN /3 /2 | ROLE_MAIN /3 /2 |
| Scan | COMPLETE trong vùng chọn sau pruning | COMPLETE trong vùng chọn sau pruning |
| Nodes / pruned | 850 /58 | 1320 /107 |
| Article / feed / main | 4 /1 /1 | 1 /1 /1 |
| Node/time cap hit | false /false | false /false |
| Links post /group /profile /other FB | 0 /3 /2 /8 | 0 /4 /1 /13 |
| Status | HEURISTIC_MATCH | HEURISTIC_MATCH |
| Card có public-label hint | 1 | 1 |
| Candidates / verified valid | 0 /0 | 0 /0 |
| Report SHA256 | `88655e28fe0b045530da963337a71e2286c8b1380d8235da8ea6da2204058c15` | `e18a10797bf66911a41a437ebd53b6d8f0318e7928d744588616169a8ae26cb7` |

Mỗi report `actions=1` là một script read. Ngoài report, lead dùng UI áp dụng **Bài viết của → Bài viết công khai** giữa hai read; nhãn xanh cùng nút bỏ lọc và kết quả tải lại đã được quan sát. Không suy filter đã áp dụng từ menu chỉ đang mở. Không cuộn/continuation, không click tương tác xã hội. Hai read là hai run riêng; khoảng giữa gồm thao tác UI và đánh giá, không là một run kéo dài quá5phút.

Report local tại `%APPDATA%/csd-desktop/dom-diagnostics/<run>/result.json`, version2/LIVE/diagnostic_only, permissionUNKNOWN, benchmarkfalse, valid0. Retention7ngày/manual cleanup; report chỉ counts/enums/buckets, không raw DOM hay nội dung cá nhân. Không copy screenshot/AX tree/profile vào repo.

## Ý nghĩa và vấn đề tiếp theo

Sửa root giúp lần này vào được vùng có article/feed mà không chạm cap2500; trước đó body traversal hết budget trước khi thấy cấu trúc. Đây là bằng chứng cải thiện phép đọc, chưa chứng minh đã chọn đúng từng bài.

UI sau lọc có một bài trong ngữ cảnh nhóm, dấu globe, ngày đăng, nội dung và ảnh. Nội dung nhìn thấy thuộc dạng tuyển dụng ở quán; chưa đánh giá relevance theo rubric. Không chép tên người, số điện thoại hay body vào evidence. Card heuristic chỉ có1 public hint nhưng **không chứng minh card đó chính là bài nhìn thấy**; role=article có thể thuộc embedded card hoặc quảng cáo. `textSize=SHORT` là bucket của từng text node lớn nhất, không phải tổng độ dài bài. Không kết luận post ngắn hoặc không có text.

Vấn đề cần sửa cụ thể: `post-like links=0` và chưa ràng buộc được heading/time/public badge/text với cùng một post container. Nguồn có kết quả hiển thị; không có bằng chứng Facebook đã chặn run hoặc nguồn cạn. Không nâng caps vô hạn, không tự đoán endpoint/ID.

[Dispatch tiếp](../handoffs/lead-p02-public-candidates-dispatch-2026-10-27.md): triển khai trích thử tối đa5 candidates với post boundary/publicity/permalink evidence rõ; trường thiếu giữ null/UNKNOWN. G00–G05 chưa đổi, P02.02 chưa DONE.
