# ADR-012 — Tách ngày đăng chưa đọc được khỏi ứng viên bài công khai

28/10/2026 Asia/Bangkok. Lead quyết định trong phạm vi diagnostic ADR-010, dựa trên [LIVE v9](../evidence/p02-live-local-clip-v9-2026-10-28.json) và product contract UNBOUNDED cho phép ngày đăng null.

Hiện extractor bắt buộc heading+temporal+public label trong cùng header. Đây là heuristic triển khai, không phải yêu cầu người dùng mọi bài phải đọc được ngày đăng. V9 cho biết ngày bị clipping uncertainty, dù một MAIN_ARTICLE đã có heading/public label/body. Không được ép chữ partial thành ngày đúng chỉ để tăng số mẫu.

Cho phép thêm đường diagnostic ứng viên **header công khai + một body duy nhất, đồng vị trí trong boundary**, không bắt buộc temporal khi không thể xác minh. Temporal thiếu/unknown phải thể hiện bằng metadata/missing reason và loại boundary mới; không dùng tên HEADER_TEMPORAL hoặc tự điền published_at. Vẫn boundary_verified=false, source_type UNKNOWN, publicity chưa independent verification, verified_valid_count0. Không biến ứng viên thiếu identity thành bài benchmark hợp lệ.

- Chỉ uncertainty của trường temporal tùy chọn được bỏ qua mà không loại cả candidate. Không lấy partial text/substring làm temporal; giữ limited/unmatched và không mượn ngày từ body/quote/heading.
- Public label trực tiếp, heading và body phải cùng cấu trúc bài; cụm header heading+public không chứa body; single body phải được kiểm và có text đọc được ở nhánh mới. Không nhận Page/search/ad card, nested/quoted public, private sibling hoặc mixed wrappers. Filter công khai không là proof.
- Body/publicity/boundary uncertainty và negative restricted/ad vẫn giữ kiểm; global cap/auth/challenge/deny/owner-loss vẫn stop. Không đổi UNKNOWN chung thành visible, không bỏ mọi OTHER unknown hoặc tăng epsilon/caps.
- Các CSS clip chính xác có thể giải nghĩa bằng hình học (ví dụ rect có vùng rỗng) được hỗ trợ bằng native repro; trường hợp unsupported vẫn UNKNOWN. Không suy mọi clip-path/legacy clip đều hidden.
- Schema/validator/writer/fixtures phải đổi cùng nhau; regression cũ dùng temporal làm điều kiện bắt buộc cần tách kiểm classifier khỏi kiểm candidate. Giữ nguyên kỳ vọng không giả date, không lấy private/quoted/partial body; ghi lý do thay assertion theo contract mới.

Đây là điều chỉnh cách khám phá dữ liệu thiếu trường, không đổi tiêu chí bài hợp lệ hoặc gate, không mở continuation/scale. Lead tiếp tục review và thử tối đa5 ứng viên trên một batch.
