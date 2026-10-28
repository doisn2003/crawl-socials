# ADR-015 — Đối chiếu một route bài đã quan sát

28/10/2026 Asia/Bangkok. Theo ủy quyền tự chủ nghiên cứu nguồn của người dùng và ADR-010/014. LIVE v15 đọc được một body cùng context hint từ URL thực; chưa chứng minh route mở lại cùng nội dung. Cho phép triển khai một phép kiểm kỹ thuật nhỏ, review rồi lead chạy; không mở benchmark hay continuation.

## Phạm vi

Một action native mới đối chiếu **bài vừa đọc thành công trong chính process/profile hiện tại**. Anchor phải do current-post controller vừa tạo: đúng một sample, một public-group signal, một context hint hợp lệ, không barrier/cap/incomplete. Anchor nằm trong main memory, gắn profile/owned view và hash. Không nhận URL, ID, script, file path hay payload tùy ý từ renderer/menu/CLI; không nhập anchor cũ sau restart.

Main lấy chính observed_route đã bỏ tracking và được parser kiểm tra, mở lại tối đa **một lần** trong owned view đó, không tự tạo `/posts/` hoặc đường dẫn thay thế. Chờ một document generation mới và đúng route trước một lần đọc fixed current-post script; nội dung động chưa sẵn sàng thì ghi chưa đủ dữ liệu, không loop retry. Navigation có timeout tối đa 10 giây; fixed read vẫn 4 giây/main, 1 giây/script, 2.500 work steps, 800 ký tự, một candidate. Stop/close/view replacement/route khác/auth/challenge/deny chấm dứt phép kiểm, không lấy kết quả muộn. Anchor hủy khi owner/profile/route đổi ngoài operation; đóng/mở process không tự khôi phục anchor.

Giữ combined starts 3/process dùng chung các diagnostic. Verification tiêu thụ một start; trước đó phải có một successful current-post start. Một operation đang chạy chặn action khác; không bỏ pending execution fence sau timeout. Không scroll, See more, search expansion, đọc mạng/hidden state, bình luận, Join hoặc vượt checkpoint. Nếu BrowserHost cần primitive navigation, chỉ expose cho main với ownership/allowlist rõ, không mở IPC navigation tùy ý.

## Kết quả và bằng chứng

Kết luận kỹ thuật REOPEN_MATCH chỉ khi route/ID nhóm/ID bài khớp chính xác dạng string, đúng một post dialog/public-group header/single message group, body không rỗng và nội dung đã redact khớp byte/hash anchor. Khác body, route, source hay thiếu evidence là mismatch/inconclusive, không ép thành match hoặc suy bài đã xóa. Truncated/partial không chứng minh full text; giữ trạng thái chất lượng. Không mượn ID/link/body của comment hoặc nested share.

Lưu hai run refs/hashes, observed route và IDs trong artifact local ngoài repo, TTL 7 ngày. Summary `.brain` chỉ enum/count/hash/ref/timing, không raw URL/ID/body/account. Không sửa artifact nguồn hoặc context hint UNVERIFIED đã ghi. REOPEN_MATCH là bằng chứng route-body đối chiếu được, **chưa tự gán canonical permalink, source AVAILABLE, relevance ACCEPT, valid unique hoặc gate PASS**. Task tiếp sau quyết định mapping vào record dựa trên evidence thực.

Worker chỉ fixture/native offline. Lead nghiệm thu source/tests và độc lập review trước LIVE. Bộ kiểm tra tập trung route swap/redirect/Stop/late result, same versus changed body, auth/challenge/deny và anchors khác profile; không xây framework thu hàng loạt. Khi có kết quả thật, lead giao bước đọc thêm tối đa vài public candidates rồi continuation theo P02.02.
