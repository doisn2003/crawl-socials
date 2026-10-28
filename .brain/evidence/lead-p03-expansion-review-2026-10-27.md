# Lead nghiệm thu P03.02 — query expansion

2026-10-27, reviewer `/root`. Đã đọc toàn bộ module/tests, [handoff](../handoffs/p03-query-expansion-2026-10-27.md), [API/evidence](p03-query-expansion-validation-2026-10-27.md). Kết luận **nhận P03.02 DONE** trong phạm vi module thuần offline.

## Kiểm độc lập

~~~powershell
node node_modules/typescript/bin/tsc -p tsconfig.tests.json --outDir .test-build-lead-expansion
node --test .test-build-lead-expansion/tests/query-expansion.test.js .test-build-lead-expansion/tests/campaign-intent.test.js
~~~

Compile PASS; **34/34 tests PASS** gồm18 expansion và16 intent regression. **4/4 hashes** trong manifest bàn giao khớp. Không ghi dist/.test-build chính, không chạy Electron/restart hoặc tác động phiên Facebook.

Lead kiểm nguyên bản được giữ đầu danh sách, bounds trên query/depth/candidate work, provenance parent/root/version, grammar cùng intent, bảo vệ BRAND/EXACT_PHRASE, địa danh INCLUDE không bị preferred nới scope, NFC/case không gộp accent aliases, các fallback giữ nguyên bản và output bất biến. FROZEN_ALLOWLIST bảo thủ: chỉ phát query có đường parent hợp lệ, entry chưa dựng được phải report; đây là giới hạn có chủ đích đã thống nhất.

Lỗi lead phát hiện trước bàn giao: place nằm trong giới hạn1024 nhưng phrase+place vượt giới hạn gây throw ngay khi expansion tắt. Owner đã sửa bỏ query ghép quá dài, đếm oversize vào candidate work; regression DISABLED/all-off/enabled cap1 đạt. Không còn blocker cụ thể trong phạm vi đã kiểm.

Không suy kết quả sinh101 query offline thành sản lượng bài hoặc budget chạy nguồn. Module chưa nối UI/adapter/runtime; giữ unknown grammar/exclusions để bước khác xử lý. Không có LLM/service/network. G00–G05 không thay đổi.

P03.03 đủ dependency P03.02+P02.01, giao một module planner thuần có budget/capability checks theo [handoff tiếp theo](../handoffs/lead-p03-planner-dispatch-2026-10-27.md). Chỉ subagent triển khai phần này; CSD agent vẫn idle vì P02.02 còn disposition/driver/schema nguồn. Không mở scheduler/SQLite/UI hoặc tạo bằng chứng source giả để lấp blocker.
