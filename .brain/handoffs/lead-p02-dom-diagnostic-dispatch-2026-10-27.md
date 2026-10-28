# P02.02 — Triển khai diagnostic DOM Facebook thật

> Lượt tiếp sau nghiệm thu bản đầu lúc 20:44: UI thật dùng exact `/search/top/` + cafe Hà Nội, có Page/post và filters bài viết. Đọc bổ sung ADR-010 và lead-p02-dom-diagnostic-review-2026-10-27.md. Main sửa guard/script/validator để nhận thêm đúng route này dưới `SEARCH_TOP_MIXED`, không mở `/search/*` chung hoặc gán Posts-only. Thêm regressions metadata-only/mode route và native fixture; reviewer review scope/phân loại. Build riêng; lead giữ quyền nạp/runtime. Không làm extractor khi chưa có DOM thật.

Ngày 2026-10-27. Quyết định hiện hành: [ADR-010](../decisions/ADR-010-bounded-source-diagnostic.md), thay blocker blanket G00 cho đúng diagnostic này. Login/search đã được xác nhận; không hỏi lại user. P02.02 IN_PROGRESS; mọi gate chưa đổi.

## CSD agent — triển khai

Sở hữu `src/main/index.ts`, các file mới `src/main/facebook-dom-diagnostic*.ts`, `tests/facebook-dom-diagnostic*.test.ts`, `scripts/facebook-dom-diagnostic*.mjs` nếu cần, và handoff/evidence mang prefix `p02-dom-diagnostic`. Chỉ chạm BrowserHost nếu không thể dùng `observerTarget` hiện có; báo lead trước khi đụng policy/session/shared APIs. Không sửa master/README/ADR hoặc file worker review.

Mục tiêu đầu ra đầu tiên là một đường chạy được trong native CSD để inspect **trang Posts hiện có của owned profile**, bằng một script đọc DOM cố định. Không bắt phải có parser Facebook hoàn chỉnh trước lần quan sát schema. Có thể dùng native menu chẩn đoán hoặc điểm kích hoạt main có scope hẹp; không làm UI framework mới hoặc arbitrary evaluate bridge. Lead sẽ dùng điểm kích hoạt đó sau nghiệm thu. Mô tả chính xác cách dùng trong handoff.

Output đầu chỉ cấu trúc đã làm sạch: trạng thái trang/auth/challenge, các count có giới hạn, thông tin schema semantic phục vụ chọn card/identity/public label/text. Không ghi toàn bộ text/HTML, tên người hoặc raw URL/query/token. Các selector heuristic chưa được quan sát phải được ghi là thử nghiệm, không claim đã đúng DOM thật; zero-match phải báo UNSUPPORTED/NO_MATCH, không source exhausted. Metadata phải đủ để quyết định bước parser cụ thể mà không tạo chuỗi framework/offline mới.

Giới hạn: 1 query cafe Hà Nội, 1 batch, tối đa 5 candidates ở bước sau, 5 phút, 3 controlled actions; bước inspect chỉ cần 1 read. Chưa navigation/filter/scroll tự động trong module inspect; kiểm page route ở main và trong script, stop auth/challenge/owner change. MAIN phải validate output untrusted, bound bytes/nodes/time, reject result muộn, không chặn UI vô hạn. Output outside repo, unique run id + time + code/script hash + mode LIVE + diagnostic_only + benchmark_eligible=false + platform_permission UNKNOWN, valid count0. Mẫu thật chỉ ở bước sau khi có cấu trúc/publicity đủ bằng chứng.

Kiểm bằng synthetic DOM/native fixture thích hợp, và unit lifecycle/limits/redaction. Build riêng `.test-build-csd-dom` / `.build-csd-dom`, không shared `dist`, không restart hoặc điều khiển phiên thật. Không ghi synthetic evidence thành LIVE. Bàn giao file/hash/test + cách lead chạy và giới hạn chưa kiểm.

## /root/csd_adapter — review độc lập

Read-only code và quyết định mới. Sở hữu duy nhất `.brain/evidence/adapter-p02-dom-diagnostic-review-2026-10-27.md` và tests mới `tests/facebook-dom-diagnostic-review.test.ts` nếu có phát hiện cần regression độc lập. Build `.test-build-adapter-dom`. Không chỉnh implementation của CSD agent, không runtime/build chung.

Review script có scope đúng Posts/owned view; dữ liệu riêng/tokens/names không vào diagnostics; deadline/node/output bounds; auth/challenge; provenance và no false gate; các giả định selector được ghi rõ. Không yêu cầu Meta grant như precondition của diagnostic theo ADR-010. Báo lỗi có repro/file:line; chờ implementation thực để review, không làm thêm research/report framework.

## Lead

Lead duy nhất sửa task/gate và shared build, giữ max 2 workers. Sau review phù hợp sẽ nạp build, dùng lại profile và chạy diagnostic; nếu phải có human xác minh thì chỉ hỏi đúng thao tác đó. Dùng quan sát thật để giao extraction <=5 public candidates, sau đó mới continuation. Không mark P02.02 DONE hoặc G00 PASS từ fixture/diagnostic.
