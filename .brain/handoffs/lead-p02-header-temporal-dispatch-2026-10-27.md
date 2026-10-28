# P02.02 — Nhận diện thời gian trong header có giới hạn

Ngày 2026-10-27, theo [LIVE v4](../evidence/p02-live-overlay-v4-2026-10-27.md). CSD agent triển khai; `/root/csd_adapter` review độc lập; lead duy nhất sở hữu runtime, shared dist và bảng trạng thái. Không tạo thêm worker.

## Evidence và mục tiêu

V4 đã qua preflight CLEAR, đọc 1151 nodes/7 boundaries/69 ms nhưng 0 ứng viên: NO_TEMPORAL 3, NO_HEADER 4. UI thực có ngày giờ ở header. Không suy Facebook chặn hoặc hết bài. Đây là task extraction, không mở rộng quyền hoặc benchmark.

1. Tái hiện và sửa khoảng trống trong code: temporal text ở span con của anchor, text chia thành nhiều node, role-link và wrapper không có box. Kiểm control pruning ảnh hưởng header; chỉ hỗ trợ control khi có bằng chứng temporal cùng header, không duyệt mọi button hoặc lấy ngày trong body/comment/quote/ad. Không bỏ yêu cầu temporal/public/header cluster để có sample.
2. Phân tích cluster tại common ancestor trong phạm vi hiện có. Giữ body exclusion và không ghép heading của bài A với date/public của bài B. Không tăng cap mặc định hoặc kéo ancestor tới toàn feed/main. Chỉ sửa khi có repro cụ thể.
3. Nếu shape thật vẫn chưa thể biết từ summary, bổ sung metadata **enum/count có giới hạn** trong cùng lần sửa: link/control candidates ở trước body, temporal match từ label/direct text/nested visible text; lý do bỏ qua hidden/control/ancestor limit. Có thể ghi tối đa vài đường tag/role theo enum cố định để phân biệt nesting, không text/aria-label/href/CSS/class hoặc DOM dump. Ưu tiên metadata đủ giải thích lượt LIVE kế tiếp, không xây diagnostic framework mới.
4. Thu text chỉ từ phần đang render, cùng boundary/header; không `.textContent` toàn subtree kéo theo hidden hoặc private content. Mọi lượt walk/ancestor dùng budget chung 2500 nodes/1 giây; không reset budget/deadline. Chạm giới hạn phải báo thiếu, không suy có temporal hoặc public. Giữ tất cả guard v4 và giới hạn 5 ứng viên, 12 boundaries, 32 KiB, 1 action.
5. Native fixture dùng Chromium thật cho nested/split text/layout; giữ regression barrier, private/footer restriction, nested story/comment, identity/contact. Tests chứng minh hành vi, không chỉ mirror implementation. Nếu schema đổi, script/controller/validator/writer đồng nhất. Không lặp mọi suite không liên quan sau mỗi thay đổi nhỏ.

## Ownership và bàn giao

- Owner: `src/main/facebook-public-candidate{,-script,-fields,-fixture}.ts`, `tests/facebook-public-candidate.test.ts`; index/smoke chỉ nếu cần fixture flag. Build `.build-csd-dom`, tests `.test-build-csd-dom`. Handoff/evidence prefix `p02-header-temporal`.
- Reviewer: chỉ `tests/facebook-public-candidate-review.test.ts`, `.test-build-adapter-candidate` và báo cáo review hiện có. Làm baseline độc lập từ v4 frozen trước, không sửa source/owner tests/runtime/shared dist. Khi owner code-ready, kiểm snapshot mới một lần rồi báo finding cụ thể.
- Không sửa BrowserHost/network/policy/session, không tự restart hoặc chạy LIVE. Giữ runtime 2460/source 6492758, query/public filter, 1/3 starts. Không ghi master/README/gates từ worker.
- Owner bàn giao code-ready, hashes, targeted unit/native results, còn gì chưa chứng minh. Lead review, nạp cùng profile và đọc một lần trên build đã nghiệm thu; không yêu cầu người dùng login/search/Meta API lại.

## Baseline đã được lead kiểm lại lúc 16:37Z

Reviewer giữ snapshot compiled v4 tại `.test-build-adapter-candidate/v4-temporal-baseline/`, không compile đè bằng source owner đang sửa. Lead chạy đúng snapshot với `--test-name-pattern='review temporal:'`: **8 tests, 2 PASS/6 FAIL**, khớp [report lượt 9](../evidence/adapter-p02-public-candidates-review-2026-10-27.md). Đây là expected baseline của lỗi/gaps cần sửa, không phải kết quả nghiệm thu implementation mới.

- Năm positive gaps được tái hiện: nested anchor text, split anchor text, role-link, temporal anchor role=button, boxless anchor chứa text đang render. Direct anchor text đối chứng có sample. Counterpart Friends nằm sau assertion lỗi chưa chạy trong các test này.
- **R-T1/P2 OPEN:** `BLOCKQUOTE` hoặc `Q` nằm trước body, bên trong header, chứa anchor ngày bị dùng làm temporal cho bài ngoài. Cả hai cho 1 sample; body/comment/embedded ARTICLE counterparts cho 0 như dự kiến. Owner cần loại contamination này, đồng thời giữ kiểm restricted/ad ngoài body; không chỉ nới parser để positive case xanh.
- Hidden text/ordinary control và date/public của header khác không bị ghép: 2 negative tests PASS.

Lead đã gửi finding cho CSD agent đang triển khai. Reviewer completed/idle chờ code-ready; chưa có snapshot mới để nghiệm thu. Runtime/source và 1/3 starts giữ nguyên, không chạy lại LIVE v4.
