# P02.02 — Sau LIVE v15: đối chiếu route và audit mẫu

Đọc [review/LIVE](../evidence/lead-p02-post-performance-review-2026-10-28.md) và [ADR-015](../decisions/ADR-015-observed-post-route-verification.md). Lượt thật 202 ms đã có một sample + context hint. Không làm lại performance đã nghiệm thu; ưu tiên đưa evidence này tới bước đọc bài có identity/context dùng được.

## CSD agent — implementation owner

Triển khai action đối chiếu observed route theo ADR-015, tối thiểu đủ kiểm trên một bài. File scope: main current-post controller/menu/script/fields; BrowserHost main-only navigation nếu cần; owner tests và fixture/smoke/build riêng. Có thể tạo module nhỏ riêng cho verification để giữ search/current reader ổn định. Không sửa reviewer files, master/README, shared dist, runtime/profile hay `.env`.

Nghiệm thu: anchor từ successful owned current-post run; chỉ một navigation đến route đã quan sát; một new-generation read; body/route/ID match có provenance; changed/empty/ambiguous/barrier/race trả kết quả rõ, không false success. Shared budget/Stop/native pending giữ đúng; sanitized local output, contacts redact, không nâng schema benchmark hay context cũ. Test có ý nghĩa và native fixture cho navigation + security; freeze manifest/handoff sớm để lead LIVE. Báo nếu primitive cần thay contract chung trước khi mở rộng scope.

## csd_adapter — evidence audit rồi review độc lập

Trước khi owner có code: audit relevance của **một sample LIVE v15** theo product contract/relevance_rubric, đọc local payload bằng ref trong summary sạch. Chỉ đọc đúng artifact được chỉ định, không profile/.env/tài khoản/UI/source mới. Kiểm contact redaction/nhầm comment/ý nghĩa nội dung ở mức evidence sẵn có; phân biệt relevance với identity/source/benchmark. Không tự loại sang nhượng theo sở thích, không gọi cả bài đầy đủ chỉ vì VISIBLE_SNIPPET. Ghi quyết định/codes/rationale sạch, evidence hashes và điều chưa xác minh vào `.brain/evidence/adapter-p02-live-sample-audit-2026-10-28.md`; không chép body/IDs/URL.

Sau đó chuẩn bị các ca reviewer trọng yếu cho ADR-015; khi owner handoff thì review source + native proof, file riêng `tests/facebook-post-route-verification-review.test.ts` nếu cần, output `.test-build-adapter-candidate`. Không tự sửa implementation hoặc mở rộng suite không cần thiết. Không kết luận P06.01 DONE từ một mẫu.

## Lead — runtime/integration

Lead giữ shared dist và phiên thật, hiện PID19880/main6293944/source21238024, post dialog,1/3 starts. Sau review sẽ nạp build bảo toàn profile, đọc một anchor mới rồi chạy verification; không lặp build cũ. Chỉ lead sửa status/gates. V13 hai snippets và v15 một sample không chứng minh ba unique. P02.02 IN_PROGRESS; permission UNKNOWN, benchmark OFF, valid0/gates giữ nguyên.
