# ADR-017 — Mở URL bài đã quan sát và ràng buộc với header

28/10/2026, Asia/Bangkok. Quyết định của lead trong phạm vi thử nguồn nhỏ được người dùng giao. Tiếp nối ADR-010/015/016; không thay mục tiêu/gate hoặc quyền platform.

## Căn cứ và lựa chọn

[V24](../evidence/p02-live-subtree-rejection-v24-2026-10-28.json) và [v25](../evidence/p02-live-passive-aria-v25-2026-10-28.json) có link bài thật duy nhất trong header nhóm công khai, target ABSENT, header/visibility/viewport đạt. Subtree whitelist lần lượt dừng ở aria-labelledby và style. Đây là hạn chế parser CSD; chưa có challenge/deny ở các run này. Nội dung trang trí ngày giờ không cần làm bằng chứng định danh khi href bài đã xuất hiện.

Chọn một nhánh mở **đúng URL bài quan sát từ DOM**, sau revalidation của cùng header/node/document và same-owner checks, qua navigateObservedRoute đã có. Tối đa một navigation và một fixed current-post read. Không chạy handler click của timestamp cho nhánh này. Placeholder search vẫn không được xem là URL bài; không tự tạo URL từ group/post IDs hoặc dùng dữ liệu hidden/network.

## Proof trước navigation

- Fixed main-owned DOM script trên search hiện tại, không selector/script/URL do renderer hay CLI truyền vào. Link phải thuộc header đã qua public-group/body association hiện có, ngoài heading/body/comment/quote/author/navigation/action controls; target visible, trong viewport và ancestor scopes hợp lệ.
- Đúng một observed post link trong header, bounded scan. Giữ kiểm target role, download, disabled, popup, author/action label và tính duy nhất. Không dùng aria/style/temporal text hoặc descendant presentation whitelist làm bằng chứng identity. Không đánh dấu một subtree chưa hiểu là đã hiểu; nhánh URL dùng proof riêng, các thông tin trang trí chỉ diagnostic.
- Lần đầu chỉ hỗ trợ **GROUP_QUERY đã thấy ở UI**: HTTPS host/path được hỗ trợ, một multi_permalinks hợp lệ; query key/count/length có giới hạn, không credentials/hash/action URL. `__cft__[0]` là key tracking đã được UI quan sát, cần validator thống nhất với current-post reader. Không mở path posts/permalink hoặc dạng khác nếu chưa có scope và evidence phù hợp.
- Capture raw/absolute observed href trong private in-memory binding. Fixed revalidation kiểm target/root/header/public/body/href identity, connectedness, document/owner/search URL và MutationObserver. Binding dùng một lần; hết budget hoặc stale/ambiguous thì zero navigation. Không phục dựng URL khác hoặc loại query trước navigation.
- Controller kiểm lại route trước dispatch, giữ nguyên exact URL quan sát và không nhận URL tùy ý qua IPC/menu/CLI. Owner/view/document phải khớp ở ranh giới dispatch.

## Sau navigation

Tái dùng capability navigateObservedRoute và nguyên tắc route verifier: một navigation, 10 giây; main-frame start/commit phù hợp, route không đổi sang post khác hoặc redirect ngoài expectation. Chỉ sau fresh owned destination phù hợp mới gọi fixed current-post reader một lần, tối đa4giây/1giây script. Dừng đúng run khi Stop/timeout/owner loss/auth/challenge/deny; không retry, popup, tự search/scroll/hover hoặc thêm read ngoài giới hạn.

Giữ ≤5headers/12examined/2500steps/1s scan,32KiB output,3combinedstarts/process,5phút/run. Chia rõ navigation_count và click_count=0, không ghi thành đã click. URL/IDs chỉ trong private evidence được bảo vệ; summary/brain dùng enums/count/hash/timing. Evidence phải nối discovery→revalidation→exact navigation→fresh read.

Worker chỉ fixture; lead review code/test trước khi LIVE. V25 vẫn chưa tự mở/đọc bài. Việc hydration hiện vẫn có một thao tác con trỏ khảo sát thủ công, chưa được coi là tự động toàn luồng. Permission UNKNOWN, benchmark OFF, valid0, gates giữ nguyên.
