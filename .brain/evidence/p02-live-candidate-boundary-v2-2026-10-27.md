# P02.02 — Boundary v2 đã chạy trên DOM thật

Ngày 2026-10-27. Sau [nghiệm thu v2](lead-p02-candidate-boundary-review-2026-10-27.md), lượt15:11Z lead đã thao tác cửa sổ được. Đóng app theo lifecycle, xác nhận PID26904 đã kết thúc, mở đúng profile trên build đã freeze; không kill hoặc nhập credentials. Runtime mới **root22308/main2494008/source4787124**. Search exact cafe Hà Nội, chọn Bài viết công khai, đợi results tải; không scroll, hover hoặc tương tác xã hội. Lần này kết quả đầu đã khác lượt trước nên không so số node như benchmark cùng dataset.

[Summary sanitized nguyên bản](p02-live-candidate-boundary-v2-2026-10-27.json) được copy đúng file đã đọc; không copy candidates/raw DOM/screenshot/profile. SHA256 `bd0c28eef86c14231e35f47fa462657190babb40a45b02482c9b8b419e0facd1`.

- Run `candidate-e6ce30cb-af29-4a10-b15f-b8fc9bb43e7b`, schema2/LIVE.
- UTC `15:14:57.035Z` → `.065Z`:30ms, actions1, candidates0/valid0.
- SEARCH_TOP_MIXED, MAIN_FALLBACK; visited380, examined7, pruned33. Không chạm node/time/candidate/boundary cap.
- First feed được tìm thấy, feedLandmarks=false. FeedExamined6, mainExamined1, fallbackUsed=true, fallbackScan=COMPLETE theo pruning policy; không đồng nghĩa mọi node hữu ích trên trang đã được đọc.
- Rejected NO_HEADER6 và AMBIGUOUS_BOUNDARY1; các reason khác0.
- Feed shapes: DIV/OTHER/SHALLOW/INSIDE,0hints; có hidden prune hoặc nested article prune. Các0ở statePRUNED không chứng minh subtree không có heading/body/public.
- Shape MAIN_ARTICLE: DIV/rolearticle/DEEP/INSIDE, statePRUNED, messageRegions2, outsideHeaderDepth2; heading/temporal/public observed trong header guard đều0. Prunes: hidden7/control14/navigation1/article0/comment0. Chưa biết hai message regions là hai body độc lập hay marker lồng nhau.
- Discovery: articles1, outsideFeed4, các landmark counters khác0. Discovery không đếm lại toàn nội dung của article đã đưa sang examine.
- Payload rỗng SHA256 `31fb3f07d001c60c41b3f7a44e0e1f8c5904ffadb3aae05ae0d6d90e12cfe412`; không cần đọc/dump.
- Script `086660031bf0d691fe4a1826ae8387dd2cf78706043e88869000826ea02c8588`, controller `2e5f09d418e93254798649fdbc49dc39c647a736ae6d6e4aa56791c7ee44712b`.

UI có một bài nhóm với globe/date/text/image và một bài được tài trợ bên dưới. Không xác nhận article trong report là bài nào trên UI, không chép author/body/contact. Không auth/challenge/deny được quan sát. Không suy nguồn cạn hoặc Facebook chặn.

## Bước kỹ thuật tiếp

Đường fallback thực sự chạy và đã xem một article. Thiếu quan sát tập trung ở pruning layout, quan hệ hai message marker và header sâu hơn6. `rendered()` hiện dùng getClientRects=0 để prune subtree; cần kiểm bằng native fixture xem wrapper `display:contents` có làm mất descendants hiển thị không, chưa khẳng định DOM Facebook đang dùng kiểu này. Hai markers cũng chưa chứng minh hai bài; cần phân biệt nesting với sibling/multiple bodies. Không xóa ambiguity/public guards để ép ra sample.

[Dispatch tiếp](../handoffs/lead-p02-dom-layout-dispatch-2026-10-27.md). Giữ runtime và query/filter;1/3starts của process đã dùng. Chưa continuation, mọi gate/permissionUNKNOWN/benchmarkOFF giữ nguyên.
