# P02.02 — Trích thử tối đa5 public candidates

Ngày 2026-10-27, lead `/root`. Theo ADR-010 và [hai lượt v2 thật](../evidence/p02-live-result-region-2026-10-27.md). Đây là bước tiếp cụ thể sau nghiệm thu root diagnostic, không quay về chờ Meta grant/login/search.

## Đầu vào đã biết và điều còn thiếu

Search cafe Hà Nội trên exact `/search/top/`; lead đã áp dụng `Bài viết công khai`. ROLE_MAIN có feed, scan1320nodes/COMPLETE, article1/public-label-hint1, post-like links0. UI có bài nhóm/globe/ngày/text/ảnh. Chưa chứng minh article đang đếm chính là bài này. Không lấy label sidebar, group link hoặc article count làm post identity/publicity.

Mục tiêu lần giao này là đường đọc mẫu nội dung có thể chạy sau review, tối đa5 candidates, đồng thời trả lý do rõ khi thiếu permalink/boundary/public evidence. Không dựng thêm framework chung, queue, SQLite, scale hoặc UI sản phẩm.

## Ownership

- **CSD agent:** source/test/fixture/scripts của diagnostic hiện có; được thêm `src/main/facebook-public-candidate*.ts`, owner tests/fixtures và tích hợp native menu/index tối thiểu nếu cần. Không sửa browser policy/session/general collector gates. Không sửa test reviewer, master/README/ADR. Handoff/evidence prefix `p02-public-candidates`; build riêng `.build-csd-dom` / `.test-build-csd-dom` hoặc output candidate riêng. Không ghi shared dist, không điều khiển Facebook hoặc restart runtime.
- **/root/csd_adapter:** review độc lập boundary/publicity/identity/text limits/lifecycle và viết tests riêng `tests/facebook-public-candidate-review.test.ts`, evidence `adapter-p02-public-candidates-review-2026-10-27.md`; output `.test-build-adapter-candidate`. Có thể đọc code cũ và chuẩn bị adversarial fixtures trước; khi owner báo code ready mới chạy review bản mới. Không sửa implementation, không tác động profile/runtime.
- **Lead:** master/gates, nghiệm thu, shared build và thao tác nguồn thật. Runtime đang mở root1632/main3281454/source2362756, đã lọc công khai; giữ nguyên cho tới khi lead cần nạp code đã review.

## Phạm vi triển khai

1. Trên DOM hiện có, tìm post boundary theo các tín hiệu cụ thể (feed children, heading/time/public-label/link và bounded ancestry). `role=article` chỉ là heuristic; tránh gộp cả feed hoặc nhầm embedded article/comment/Page suggestion/ad thành post. Không hardcode class/endpoint chưa quan sát rồi tuyên bố đã xác minh. Mẫu DOM synthetic phải có visible post ngoài article và embedded article bên trong để bắt lỗi này.
2. Trích bounded visible text/snippet, permalink và post ID nếu thực sự có trong DOM. Giữ ID dạng string; thiếu ID/permalink thì null + reason. Không chế ID bài từ hash text, group ID, author ID hoặc thứ tự. Không gọi text chỉ từ header/ad/comment là nội dung bài. Ghi truncated/partial/source_type UNKNOWN khi thiếu bằng chứng. Ưu tiên không click; không mở rộng Xem thêm/hover/đi link tự động trong lát cắt này.
3. Publicity cần tín hiệu trực tiếp gắn cùng candidate (label/globe có semantic label phù hợp); bộ lọc là provenance độc lập, không tự chứng minh mọi node công khai. Restricted/conflicting/missing evidence: không lưu nội dung vào bộ mẫu công khai, chỉ ghi enum lý do. Tối đa5 candidates có public signal được lưu để review; vẫn `verified_valid_count=0`. Thiếu identity giữ mẫu chưa xác minh rõ ràng, không tính unique/valid. Không thu tên/profile người bình luận, contact fields hoặc nội dung ngoài candidate.
4. Nếu chưa có permalink, trả metadata giới hạn từ chính vùng candidate về link/tag/role/temporal label families để biết thiếu chỗ nào, không dump href/attributes/DOM/AX tree. Chỉ canonical permalink thực sự nhận diện mới được đưa vào payload local; bỏ tracking/query không cần thiết, không persist secret/token. Không thêm request/GraphQL/network-body capture.
5. Một query/batch, tối đa5phút và≤3controlled actions; phiên đầu dự kiến1read, không continuation/cuộn/retry. Giữ global node/time/output bounds và late-result/owner-change/stop/clock checks. Tách metadata diagnostic hiện có khỏi candidate payload có nội dung; định schema/mode rõ. Không biến normal collector fixture thành LIVE.
6. Candidate payload chỉ local ngoài repo trong userData, retention7ngày/manual cleanup theoADR009. Envelope/summary log/.brain chỉ enum/count/hash; không log body/permalink/name. Giới hạn rõ sốchars/bytes và tổng file; dùng writer/containment/atomic or exclusive write hiện có khi phù hợp. Không mở arbitrary evaluate/URL hoặc credential bridge.

Điều kiện để lead chạy: compile + meaningful unit/native fixture PASS; report schema/modes và hashes; review boundary/publicity/header/comment/ad contamination và missing permalink; bảo toàn stop/ownership/output protections. Các tests cần phân biệt nội dung công khai có label trực tiếp, private/conflicting/unknown, Page suggestion/ad/comment, nested article, duplicate aliases, partial scan, timeouts/late result và candidate output không tràn vào summary. Không cần mở rộng regression không liên quan khi không sửa module đó.

Nếu schema thật còn thiếu, owner trả code có thể chạy và lý do thiếu cụ thể; lead dùng một read tiếp để kiểm, không dừng ở tài liệu giả thuyết. Chưa chạy nguồn thật từ worker; lead nhận code rồi thực hiện. PermissionUNKNOWN, benchmarkOFF; G00–G05 giữ nguyên. Không hứa đủ1000 hoặc đủ3nguồn từ mẫu này.
