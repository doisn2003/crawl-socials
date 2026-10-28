# ADR-016 — Mở bài từ kết quả tìm kiếm đã quan sát

28/10/2026, Asia/Bangkok. Tiếp nối ADR-010/014/015 và ủy quyền điều phối của người dùng. V18 đã REOPEN_MATCH trên nguồn thật. Trở ngại tiếp theo: timestamp trong hai header nhóm công khai mà lead vừa quan sát có href `/search/top` kèm tracking, không phải URL bài. UI click timestamp đã mở được bài và route thật. Không tạo URL `/posts/` hoặc query từ suy đoán.

## Phép thử kế tiếp

Cho phép một action native có giới hạn: trên search `cafe Hà Nội` hiện hữu của owned profile, nhận diện tối đa 5 candidate headers trong ngân sách discovery hiện có, rồi **mở đúng một timestamp được gắn với header nhóm công khai** và đọc một bài bằng fixed current-post reader. Đây là bước chứng minh tự động từ search sang bài, trước pilot nhiều bài và continuation.

Timestamp phải thuộc main DOM, visible, trong header đã qua guard public-group, không là author/group title/body/comment/ảnh/Like/Join/menu/share/See more. Href chỉ được là dạng Facebook post đã thực sự quan sát hoặc placeholder search thuộc origin/path đang được hỗ trợ. Không chấp nhận javascript/data/external URL, không dùng script từ trang. Click phải dùng target đã ràng buộc bởi discovery trong chính owned view/document; nếu stale hoặc mơ hồ thì không click. Không nhận CSS selector, script, URL hoặc ID tùy ý từ renderer/CLI/artifact.

Chỉ một click điều hướng, tối đa 10 giây để có route bài nhóm được parser hiện có chấp nhận, sau đó một fixed read tối đa 4 giây/main và 1 giây/script. SPA navigation hợp lệ không bắt buộc document generation tăng; phải chứng minh chính click được chọn dẫn tới route đã quan sát trong cùng owner. Owner/view loss, navigation ngoài phạm vi, Stop/timeout/auth/challenge/deny dừng operation. Same-document và iframe no-op đã review được giữ; không vô hiệu hóa guard chung.

Giữ 3 combined starts/process, 5 phút/run, 2.500 work steps cho mỗi fixed scan/read, discovery tối đa 5 headers/12 examined, một candidate body tối đa 800 ký tự, output có giới hạn. Không scroll, tự search lại, retry, click nhiều lần, hover mở rộng, See more, đọc network/hidden state hoặc frame con. Thiếu timestamp đủ tin cậy là kết quả cụ thể để lead khảo sát thêm, không chọn bừa.

Lưu proof của discovery → click → route → read ở userData: refs/hashes/owner và observed route; TTL 7 ngày, manual cleanup. Summary trong `.brain` chỉ enum/count/hash/timing. Candidate/identity/source còn UNVERIFIED, permission UNKNOWN, benchmark OFF và valid0. Không ép kết quả thành đủ 5 bài; sau khi một click tự động thành công mới mở pilot tối đa 5 và continuation theo evidence.

Worker fixture-only, lead review rồi thực hiện LIVE. Không thêm SQLite, queue/framework hoặc đổi backend trong bước này.

## Bổ sung sau preflight LIVE v22 — 28/10/2026

Preflight thực đã xác định timestamp có target BLANK, semantic/header/visibility đạt nhưng bị media predicate và viewport loại. Lead được thực hiện tối đa3 scroll UI, tổng delta không quá2.000px, trong khung kết quả để đưa header đã quan sát vào vùng nhìn; dừng cuộn khi thấy header, rồi dùng một start còn lại của diagnostic hiện có. Lần đầu650px chỉ hiện một quảng cáo kế tiếp nên hạn mức khảo sát tính cả bước đó. Đây là khảo sát vị trí hiển thị, không bật auto-scroll/retry/continuation trong collector. Các giới hạn script, click, read, stop và process giữ nguyên; chỉ lead thao tác UI.

## Link bài thật sau khi đưa header vào viewport

Lượt v22 lúc00:06:15Z đã quan sát OBSERVED_POST/target ABSENT/viewport PASS trong header công khai, nhưng không đọc được temporal text và blanket media predicate loại. Cho triển khai proof riêng UNIQUE_HEADER_POST_LINK cho một link bài thật duy nhất, cùng các ràng buộc public/header/body/visibility/binding hiện có. Không giả lập bằng chứng ngày giờ. Phân loại media phải phân biệt được inline SVG text có cấu trúc chặt chẽ với ảnh/video/control/heading/unknown; unknown/incomplete tiếp tục chặn. Đây là thay đổi dự kiến cần code review và native fixture trước LIVE, chưa kết luận cấu trúc Facebook là SVG text. Target BLANK và popup policy chưa thay. [Dispatch cụ thể](../handoffs/lead-p02-observed-header-link-dispatch-2026-10-28.md).

## Khảo sát UI bổ sung sau v23

V23 LIVE đã thấy placeholder BLANK ngay trong viewport và subtype UNSUPPORTED; chưa có link OBSERVED_POST dù trước đó v22 đã thấy. Để kiểm tra việc UI chỉ cung cấp href sau tương tác con trỏ, lead được mở đúng một context menu bằng chuột phải trên timestamp đang hiển thị, quan sát rồi Escape đóng. Không chọn lệnh menu, copy/share/mở tab mới hoặc phát click điều hướng; không coi giả thuyết lazy href là kết luận trước quan sát. Đây là thao tác khảo sát thủ công có giới hạn, chưa bật hover/scroll tự động trong collector. Có thể chạy một start diagnostic còn lại nếu UI/link thật sự đổi; không lặp nguồn không đổi.

## Wrapper accessibility đã được xác định ở v24

V24 LIVE xác định first failure ATTR_NOT_ALLOWED/SPAN/ARIA_LABELLEDBY/D1, trước và sau khi href thành OBSERVED_POST/target ABSENT. Cho sửa classifier hỗ trợ aria-labelledby như metadata thụ động trên SPAN hiện có, trong cùng caps; không dereference IDREF, không dùng nó làm bằng chứng thời gian/nội dung/public hoặc bỏ qua descendants/visibility. Phải review/native trước LIVE. Scope action không đổi. [Dispatch](../handoffs/lead-p02-passive-aria-wrapper-dispatch-2026-10-28.md).
