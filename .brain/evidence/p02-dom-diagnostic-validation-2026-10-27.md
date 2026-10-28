# P02 DOM diagnostic — kiểm chứng của implementation owner

Ngày 2026-10-27. Theo ADR-010 và dispatch; đây là evidence offline/FIXTURE, không phải lần quan sát Facebook thật hoặc kết luận gate.

| Kiểm | Kết quả | Ý nghĩa |
| --- | --- | --- |
| Build riêng `.build-csd-dom`/`.test-build-csd-dom` | PASS | TypeScript main và test chỉ ghi output riêng |
| Unit suite owner | 10 PASS, 0 fail | Route/mode/validation/redaction/lifecycle/budgets/output |
| Native fixture qua menu handler và isolated world | 3 PASS | HEURISTIC_MATCH, NO_MATCH, AUTH_REQUIRED |
| Fixture cấu trúc | 8 article roots, 5 sample tối đa | Chỉ metadata; 0 bài được thu/đếm hợp lệ |
| Fixture network/observer | 0 external / không attach | HTTPS được intercept vào DOM giả cục bộ |
| Fixture shutdown | 0 windows, 0 WebContents | Synthetic child đã đóng; temp data được xóa |
| Facebook thật | Chưa chạy | Phiên người dùng và shared runtime không bị thao tác |

Lệnh cuối đã chạy:

```powershell
node scripts/facebook-dom-diagnostic-build.mjs
node --test .test-build-csd-dom/tests/facebook-dom-diagnostic.test.js
node scripts/facebook-dom-diagnostic-smoke.mjs --output .brain/evidence/p02-dom-diagnostic-fixture-2026-10-27.json
```

Unit regressions có kiểm `readMs+1` bằng injected clock dù native resolve ngay: phải READ_TIMEOUT. Timer thực cũng được kiểm bằng native promise không settle; controller trả READ_TIMEOUT sau khoảng 4 giây và giữ capacity, không tích lũy native reads. Stop/owner loss bỏ payload, tháo listeners, report không đổi khi kết quả muộn trở về. Main validator reject extra raw fields/enum coercion/counters không nhất quán/cap vượt; file hash đối chiếu bytes trên đĩa.

Các combination cờ LIVE với mọi smoke hoặc DOM fixture bị reject trước tạo runtime path; fixture không được gắn LIVE. Exact Posts route được kiểm ở main và script, không dùng selected-tab heuristic. Suspend dừng DOM diagnostic bên cạnh probe cũ trong integration `index.ts`.

Native fixture chứa synthetic tên/ngữ liệu/link/query/token và password để kiểm không lọt ra output. Summary chỉ giữ enums/counts/hash trong [JSON fixture](p02-dom-diagnostic-fixture-2026-10-27.json); raw DOM/report temp không copy vào `.brain`. Không báo public records từ hint labels.

Review script độc lập nằm ở [evidence reviewer](adapter-p02-dom-diagnostic-review-2026-10-27.md), không thay kết luận lead host/lifecycle/runtime. SHA-256 của script source trong manifest phải khớp snapshot reviewer trước khi dùng. Các giới hạn còn mở và cách kích hoạt native được ghi đầy đủ trong [handoff](../handoffs/p02-dom-diagnostic-2026-10-27.md).

Sau owner checks, lead thông báo đã kiểm fix trên snapshot này, compile riêng `.test-build-lead-dom`, chạy **15/15 tests PASS** (10 owner + 5 reviewer), và **3 native fixture cases PASS** trong evidence lead riêng. Owner không chạy hoặc sửa các output đó; nguồn xác nhận là thông điệp điều phối ngày 2026-10-27. Lead tiếp nhận snapshot để đối chiếu hash trước build/nạp và đọc thật.

`platform_permission=UNKNOWN`, diagnostic-only, benchmark ineligible, verified valid count0; task/gate không được nâng từ các checks này. Script selectors chưa được xác minh trên DOM Facebook thật, còn cooperative layout/time và partial-scan limitations.
