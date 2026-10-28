# Handoff P03.03 — Planner capability/budget/lineage

Ngày 2026-10-27, owner `/root/csd_adapter`, gửi lead `/root`. **Sẵn sàng review**, chưa tự đổi task/gate. [Dispatch](lead-p03-planner-dispatch-2026-10-27.md).

## Files

- [query-planner.ts](../../src/application/query-planner.ts): module thuần `planQueries`, types/config/decisions, reservations và binding IDs.
- [query-planner.test.ts](../../tests/query-planner.test.ts): 18 tests, gồm một luồng fake qua pagination thật của fixture adapter.
- [Evidence/API/commands](../evidence/p03-query-planner-validation-2026-10-27.md), [manifest](../evidence/p03-query-planner-manifest-2026-10-27.json), handoff này. Output compile `.test-build-planner` riêng.

## Hành vi cần nghiệm thu

1. Originals trước expansions; jobs/query IDs bind đầy đủ plan/capability/context/source, catalog giữ cả ancestor chưa được chọn. Không dùng local q0 làm global request ID.
2. Unsupported language/date defer; geography INCLUDE chỉ POST_VALIDATE có khai báo hoặc defer vì contract không có geography filter. Exact phrase defer vì chưa có syntax capability, brand truyền nguyên text. Không đổi source discovery thành posts hoặc sửa source mix.
3. Candidate/task/global allocations dùng chung qua query × target. Null budget/unit/basis không thành0/unlimited. Chi phí integer units/scale/currency rõ; request units không được đồng nhất với posts. Per-job reservation bao gồm cả continuation/retry, không nhân lại budget.
4. Template chưa có run_id, luôn execution_authorized=false; không Start/deadline/lease. FIXTURE/UNKNOWN không nâng quyền/capability, source mix vẫn unproven. LIVE declarations đầy đủ cũng chưa là quyền execution; host phải recheck preflight.

## Verification / giới hạn

Compile riêng PASS, **18/18 tests PASS**. Fake wiring: 2 adapter calls, 3 observations, 2 identities, nguyên allocation3 và provenance FIXTURE; không nguồn thật. Commands/API/error behavior có trong evidence; không cần Electron hoặc full suite.

Không sửa intent/expansion/shared contracts/registry/fake adapter/package/tsconfig/master/README; không tác động CSD session. Không thêm dependency, scheduler, live driver, SQLite hoặc UI. Budget/ref/capability declarations đến từ caller tin cậy; planner không xác minh quyền qua mạng. Không có blocker cần đổi shared interface ở scope hiện tại. Dừng sau handoff, chờ lead nghiệm thu/giao tiếp.
