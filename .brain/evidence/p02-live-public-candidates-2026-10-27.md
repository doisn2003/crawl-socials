# P02.02 — Lượt trích ứng viên đầu tiên trên Facebook

Ngày 2026-10-27. Lead thực hiện sau [nghiệm thu code và đóng2findings](lead-p02-public-candidates-review-2026-10-27.md):39tests/6native cases/13owned+129build hashes PASS. Worker không chạy nguồn thật.

Lead đóng app theo lifecycle, mở cùng profile trên bản mới: root PID26904, main4656052, source3476960. Session đăng nhập tự khôi phục. UI preparation mở lại query `cafe Hà Nội`, áp dụng `Bài viết công khai`, đợi kết quả tải. Có một lần chọn gợi ý làm query thành `cafe hà nội view đẹp`; đã sửa về exact query trước khi gọi probe, không chạy extractor trên query ngoài phạm vi. Không nhập credentials, không thay remember-password settings, không scroll/continuation/social interaction. UI prep không nằm trong `actions=1` của script run.

## Report thật

- Run `candidate-cb43ac32-9e81-4ff1-8b92-d97cf60935bf`.
- Bắt đầu `2026-10-27T14:46:04.059Z`, kết thúc `.078Z`:19ms.
- LIVE, diagnostic_only=true, platform_permission=UNKNOWN, benchmark_eligible=false, verified_valid_count=0.
- Route SEARCH_TOP_MIXED, query CAFE_HA_NOI, root FEED_IN_MAIN.
- Một read/action; visited54, examined7, pruned6; node/time/candidate/boundary limit đều false.
- Status **NO_PUBLIC_CANDIDATE**, candidate_count0.
- Rejection **NO_HEADER=7**, tất cả reason còn lại0. Đây là reason đầu tiên không đạt, không chứng minh temporal/publicity đều có hoặc đều thiếu.
- Candidate payload không có sample; identity_missing_count/text_missing_count0 vì samples0, không phải đủ trường.
- Fixed script hash `5ac3ae298e281911c02d637d213562e184adbc79edb91e23b51dc2a2f7622ed9`.
- Compiled controller hash `7ebc11183a88d2167e7cf3e3c5b6c956ff00fa6322eec74254ddef48730acf6f`.
- Summary SHA256 `a78d5221551269095934dfc93938cc2aff1a3937113aa5267d2f552bbc2b9702`.
- Candidates file SHA256 `013632b3eaa0c163aa28dd14a72869ee02b7120e26ca577f6d26fee42626dd54`.

Output local `%APPDATA%/csd-desktop/public-candidate-diagnostics/<run>/`; chỉ summary/hash được đọc và ghi ở đây. Payload rỗng không cần dump. Retention tới `2026-11-03T14:46:04.074Z`, manual cleanup.

## Kết luận kỹ thuật

UI vẫn có bài, dấu globe, ngày và nội dung; không quan sát auth/challenge/deny. Heuristic `first feed → direct children → header depth≤6` chưa khớp DOM. V2 metadata trước đó đã đi1320nodes trong main; candidate path chỉ đi54nodes rồi NO_HEADER7. Cần xác định feed đang chọn có phải vùng chứa bài chính, và header có bị nested article/hidden pruning hoặc depth guard loại nhầm. Chưa có evidence để khẳng định nguyên nhân cụ thể trong ba khả năng này.

Không suy nguồn hết bài/Facebook chặn hoặc lọc công khai thất bại. Không chạy lại cùng script trên cùng trang vì không giải thêm thiếu quan sát. [Dispatch sửa boundary](../handoffs/lead-p02-candidate-boundary-dispatch-2026-10-27.md), chưa continuation/benchmark/G00 PASS. Giữ cửa sổ và profile hiện tại.
