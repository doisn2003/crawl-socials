# ADR-013 — Không dùng chữ phụ làm điều kiện đọc nội dung bài

28/10/2026 Asia/Bangkok; lead trong phạm vi diagnostic ADR-010/012. LIVE v11 đã có một header public cluster đầy đủ, body marker duy nhất; candidate vẫn loại vì OTHER geometry. OTHER hiện gom mọi text ngoài body/temporal, gồm chữ author, decoration, engagement và nhãn khác. Không có bằng chứng mọi chữ đó là trường bắt buộc để giữ body snippet.

Cho phép refine uncertainty theo dữ liệu thực sự cần xuất. **Text ngoài body không được dùng làm heading/publicity/identity/temporal proof và không xuất vào snippet** có thể bị bỏ qua khi geometry chưa rõ, thay vì poison toàn candidate. Đây là bỏ trường phụ, không coi nó visible hoặc suy nó không có nội dung. Không đổi geometry epsilon/partial threshold.

- Heading/publicity vẫn cần positive `visibleSignal` và same-header structural proof; UNKNOWN ở signals đó tiếp tục loại. Body text, boundary traversal, body grouping, alias/private/ad/embedded/quoted guards giữ nguyên. Không nhận field không đọc được.
- Exact restricted/ad signals ở text phụ chưa rõ vẫn veto bảo thủ nếu không ở body/quote/author theo scope đã chốt. Attribute signals không được bỏ. Nếu negative label có nhiều node, phải kiểm trong semantic scope hẹp đã duyệt hoặc giữ uncertainty cho scope đó; không ghép tùy ý toàn header/whole page. Review phải có split restricted/ad case để tránh bỏ negative vì bỏ text phụ.
- Text phụ bị bỏ phải có enum/count sanitized; không raw text/path/author/URL. Nhánh mới chỉ được admission khi mandatory signals/body independently đã đạt; có thể yêu cầu single heading/body và body text như optional-time để tránh làm nhánh legacy quá rộng.
- UNKNOWN khác (visibleSignal, BODY, missing treeparent, cap/time/barrier) không đổi thành benign. Missing date và identity vẫn ghi đúng; candidate chưa là bài valid/public independently verified.

Điều này thay phần OTHER luôn poison trong ADR-012 với scope trên. Không mở continuation/scale/benchmark; cap5/2500/1s giữ nguyên. Nếu chưa thể xác định text là phụ, dùng diagnostic role/reason tối thiểu để phân biệt, không bỏ guard chung hoặc tự đoán raw DOM.
