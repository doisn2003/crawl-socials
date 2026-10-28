# P02.02 — Xác định chính xác subtree bị loại trên nguồn thật

28/10/2026, Asia/Bangkok. [V23 LIVE](../evidence/p02-live-observed-header-v23-2026-10-28.json), tiếp tục ADR-016. R-OH1/R-OH2 đã CLOSED sau lead24owner+2repro/3native, reviewer51checks/4native;28owned/135frozen khớp. Runtime22288/main2490572/source5114108,2/3starts đã dùng.

## Điều vừa quan sát

Lượt00:36:49Z:81ms/2004steps, hai qualified headers; timestamp trong viewport vẫn SEARCH_PLACEHOLDER/BLANK, subtype UNSUPPORTED. UI AX không có group-post link. Lead thực hiện đúng một right-click trên timestamp đang hiển thị rồi Escape; không chọn menu, mở tab hay phát click điều hướng. Sau đó UI có1group-post link thay cho1placeholder. Chưa tách riêng tác dụng mouseenter, pointer event hay contextmenu.

Lượt00:39:35Z:55ms/2007steps xác nhận cùng hướng thay đổi: OBSERVED_POST/target ABSENT/viewport PASS/header COLOCATED, dừng MEDIA_OR_HEADING với subtree UNSUPPORTED. Temporal record LIMITED, không được suy ra ngày giờ.0click/read ở cả hai lượt, không auth/challenge/deny. Một placeholder khác vẫn BLANK ngoài viewport. Đây là nguồn cung cấp link thật sau tương tác con trỏ, không phải bằng chứng Facebook đang từ chối tài khoản.

## CSD agent

Sửa hẹp classifier hiện có để xuất **lý do đầu tiên loại subtree** và vị trí cấu trúc dạng enum. Mục tiêu phân biệt HTML tag chưa hỗ trợ, namespace, attribute, style/effect, SVG tag/ink, limit/API. Với lỗi tag/attribute, trả closed tag/attribute-name enum thường gặp (DIV/SPAN/BR/SVG/G/TEXT/TSPAN/OTHER; CLASS/STYLE/ROLE/ARIA_HIDDEN/ARIA_LABEL/ARIA_LABELLEDBY/ID/OTHER hoặc tương đương), độ sâu bounded; không raw value/text/href/ID/markup/DOM dump. Facts cần có cả preflight của target BLANK và guard thực. Chỉ ghi sự kiện từ traversal hiện có hoặc bounded read cùng budget; không scan ngoài target, không gọi source/network/frame.

Giữ nguyên quyết định eligibility, whitelist, proof, binding, runtime caps. Không tự cho phép DIV/aria/style/unknown vì phỏng đoán; chưa thêm automatic hover hay đổi popup policy. Mỗi failpoint phải có lý do đủ để sửa chính xác ở lượt sau, tránh chỉ trả UNSUPPORTED một lần nữa. Tối đa5shapes/32KiB/1s/2500steps; metadata phải bị final budget guards chặn action nếu hết ngân sách. Native fixture kiểm một wrapper-tag và một wrapper-attribute rejection, cùng SVG positive và budget/equivalence; chỉ focused checks cần thiết.

Ownership production/tests/build giữ như dispatch observed-header-link; handoff/evidence prefix p02-subtree-rejection-. Không shared dist/runtime/profile/.env/master/README hoặc reviewer files. Freeze xong báo lead, không chạy nguồn.

## csd_adapter

Review độc lập failpoint attribution/redaction/bounds và decision equivalence, đặc biệt partial/incomplete không bị nâng thành pass và không lặp traversal làm sai budgets. Có thể đọc mẫu metadata mới trước freeze; giữ output riêng. Khi owner freeze, kiểm code/hash và focused fixtures. Không kiểm rộng các invariants đã không đổi, không runtime/source.

## Lead sau freeze

Nghiệm thu rồi nạp bản mới, khôi phục query/public filter/profile và một lượt facts. UI interaction có giới hạn đã được ADR-016 cho phép; không tuyên bố automatic search→post đã thành công. Dùng failpoint thật để chỉnh cấu trúc hẹp. Sau khi subtype được hỗ trợ, kế tiếp là bước pointer activation có ràng buộc vào header đã quan sát nếu cần; thiết kế này chưa được bật trong collector. Permission UNKNOWN/benchmark OFF/valid0/gates giữ nguyên.

## Tiếp tục sau phiên bị ngắt — heartbeat 00:53Z

Snapshot chat chính báo turn trước interrupted/notLoaded, chưa có handoff/freeze. Lead đã gửi yêu cầu tiếp tục phần source đang làm, không khởi động lại task; snapshot kế tiếp xác nhận turn 01a18002-5972-76c2-82ee-f985ce0d371e đang active. Cursor b99b0493-0c7c-4652-95dc-0cbce8b6d117:2. Reviewer csd_adapter xác nhận phiên vẫn tiếp tục được, baseline/report còn nguyên, hiện idle chờ freeze. Một worker đang triển khai; reviewer chưa chạy kiểm final. Runtime/build và gate chưa đổi. Khi owner freeze: lead kiểm code/hash/focused checks, gọi followup_task cho reviewer, sau đó mới nạp bản mới và chạy LIVE theo mục trên.
