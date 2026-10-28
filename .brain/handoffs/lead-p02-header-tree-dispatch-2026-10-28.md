# P02.02 — Header theo cấu trúc cây đã duyệt

28/10/2026, sau [LIVE v10](../evidence/p02-live-optional-temporal-v10-2026-10-28.json). Owner CSD agent source/tests/build riêng; reviewer csd_adapter tests/report riêng; lead runtime/shared dist/task/gate. Runtime11256/source1576380,1/3starts, không worker UI/.env.

**Evidence ưu tiên:** feed child có heading1/public1/body1, textUnknown0, groupingComplete=true nhưng NO_HEADER_CLUSTER, ancestorLimit=true. Current `cluster` chỉ truyền heading/pub/time tối đa8ancestor trong khi body32; có thể bỏ lỡ cùng header nếu Facebook bọc nhiều DIV/SPAN. Cần kiểm chứng bằng native repro, không khẳng định8là nguyên nhân duy nhất hoặc bỏ co-location rule.

1. Tái hiện header hợp lệ với nhánh heading/public bọc hơn8wrapper trung tính và body nằm ngoài header. Sửa khả năng nhận diện cụm bằng quan hệ cây/boundary đã duyệt: tìm cụm chung chứa heading+directpublic, không chứa body, không đi qua article/comment/quote/navigation hoặc boundary khác. Dùng các node đã duyệt/cached ancestry khi có thể. Không tăng global2500/1s/12boundaries/5samples; mọi traversal mới phải charge budget. Không chỉ tăng cap mà vẫn báo proof khi bị cắt.
2. Giữ nhánh temporal/optional theo ADR-012; date null, public/body/mixed/negative guards. Header split mà LCA chứa body vẫn reject; public ở body/quote/sidebar, hai bài/private sibling vẫn không ghép. Đừng bỏ predicate chỉ để lấy sample.
3. Metadata nhỏ đủ phân biệt **headerPublicCluster** và temporal cluster, ancestry budget incomplete với không có cluster thực. Summary hiện chỉ clusterFound temporal nên không giải thích được optional-time. Dùng enum/count/depth buckets, không raw DOM/path/class/text/author/URL hoặc tọa độ. Nếu helper vẫn không xác định được header thật, metadata phải chỉ rõ để lead tiếp tục, không công bố heuristic là verified.
4. Hai unknownOTHER/range chưa ưu tiên sửa tùy tiện; metadata cần biết scope của range-invalid nếu sửa scope chung. Không epsilon clipX/subpixel vì chưa đủ evidence. Ưu tiên boundary sạch mà NO_HEADER_CLUSTER trước.
5. Native positive shallow/deep/mixed wrappers và negatives header split/two bodies/body-public/private/ad; reviewer độc lập giữ case khó, test global budget và unsupported ancestry. Freeze manifest/handoff sớm sau checks đủ để lead nạp thử nguồn; không build UI/DB/scale hoặc thêm framework.

## Baseline độc lập 02:03 ngày28/10
Reviewer lượt23:4targeted,2PASS/2FAIL. R-H1 xác nhận header neutral wrappers12/40 bị bỏ lỡ; R-H2 xác nhận body sâu40 không propagate qua cap32 làm LCA haiheader bị hiểu nhầm là khôngbody, nhận1sample sai. Lead đã chuyển cả2repro cho owner; structural aggregation phải bao gồm body qua toàn cây đã duyệt. Đây là fixture, không suy raw DOM Facebook giống hệt. Chưa có v11ready; runtimev10 giữ1/3starts.

## Review v11 lúc02:14
Owner16unit/6native; lead16unit+3native PASS,14owned/129frozen khớp và shared build đã dựng, nhưng **chưa activation**. Reviewer R-H1/R-H2PASS, full69=68PASS/1FAIL: R-H3 quoted nested message marker bị bỏ mà text vẫn nhậpouterbody. Lead tái hiện targeted nested-marker test trên outputriêng (1FAIL). Owner đã nhận sửa trước LIVE. Runtime vẫnv10 root11256/source1576380,1/3starts; shared dist đangv11pending nên phải build lại bảnfix/freeze trước mọi restart.
