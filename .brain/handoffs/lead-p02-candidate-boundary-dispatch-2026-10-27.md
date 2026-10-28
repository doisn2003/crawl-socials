# P02.02 — Sửa boundary sau NO_HEADER7 trên DOM thật

Ngày 2026-10-27. Đọc [report thật](../evidence/p02-live-public-candidates-2026-10-27.md) và [review đã đóng](../evidence/lead-p02-public-candidates-review-2026-10-27.md). Đường trích đã có và đã chạy; không quay lại Meta grant/login/API hoặc nhận xét Facebook chặn khi không có bằng chứng.

## Bài toán còn lại

Source nhìn thấy bài nhưng first FEED_IN_MAIN chỉ đi54nodes/7children, cả7 NO_HEADER, pruned6. Metadata main trước đó đi1320nodes. Không biết first feed là nested component, direct children là wrapper, hay header bị prune/depth guard. Tiếp tục sửa ngay đường candidate hiện có, không xây framework mới hoặc tăng cap2500 vô hạn.

## Owner và phạm vi

CSD agent giữ source/controller/script/fields/menu/owner tests/native fixture và handoff/evidence prefix `p02-candidate-boundary`. Subagent giữ test review riêng và evidence prefix `adapter-p02-public-candidates-review`. Lead giữ master/README/gates và shared build/runtime. Outputs cô lập như dispatch trước; không sửa test reviewer/BrowserHost/policy/session. Không worker nào restart hoặc đọc Facebook thật. Runtime hiện tại root26904/main4656052/source3476960, exactquery/publicfilter đã áp dụng; lead đã dùng1/3native starts của process này.

1. Bổ sung **metadata giải thích rejection** có giới hạn và không nội dung: selected root/feed relationship; sampled direct-child tag/role/depth buckets; số heading/temporal/public/message hints trong vùng đã quét; prune reasons (nested article/hidden/control/navigation); hint nằm trong/ngoài feed/header-depth. Mỗi rejected shape phải giữ unknown/partial khi chưa quét hết. Không raw DOM/attribute values/URL/name/text; tối đa5shape samples, chung node/time/output cap. Schema version/validator/report thống nhất. Đây là cách đọc nguyên nhân trong lần run kế tiếp, không một phase framework riêng.
2. Sửa chọn vùng/boundary có fallback bounded từ **main đã quan sát** khi first feed không có post landmarks. Không mặc định role=feed đầu tiên là feed chính; không biến toàn main/feed chứa nhiều bài thành một candidate. Theo dấu co-location header/temporal/public/message trong ancestor hữu hạn, giữ ambiguity khi nhiều posts. Không chỉ nới depth6 hoặc bỏ public guard rồi hy vọng lấy được dữ liệu. Code có thể giữ0sample nếu thiếu evidence, nhưng lần tiếp phải cho biết vì sao.
3. Giữ nguyên ≤5candidate, public proof gắn đúng boundary, không nhầm embedded article/comment, restricted/ad rejection sau body, newline-contact redaction và mọi stop/late/ownership guard. Khi chỉ có shape diagnostic thì payload trống và summary enums; khi đủ tín hiệu thật mới lưu public-signal candidate local. Source type/identity thiếu vẫn UNKNOWN/null, valid0. Không click/hover/Xem thêm/scroll hoặc network-body capture.
4. Native synthetic phải có main chứa bài nhưng nested feed đầu tiên là component phụ; feed child wrapper nhiều tầng; legitimate outer article và embedded article/comment; thiếu/đa marker; cap/partial. Phân biệt bài không tìm được do selector với nguồn rỗng. Handoff nêu selector nào còn giả thuyết, không nói parser đã đúng Facebook từ fixture.

Reviewer đọc kết quả và đề xuất lỗ hổng của fallback trước; review code/tests khi owner báo ready, không polling vô ích. Lead review/hash/native rồi nạp khi cần và đọc đúng1lượt tiếp. Source chưa được chứng minh đủ để continuation/scale; mọi gate giữ nguyên.
