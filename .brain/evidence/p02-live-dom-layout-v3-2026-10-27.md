# P02.02 — LIVE v3 dừng ở overlay preflight

Ngày2026-10-27. [Review v3](lead-p02-dom-layout-review-2026-10-27.md): lead49tests/12native cases, reviewer17tests,15owned+129frozen hashes đạt trước activation. Đóng root22308 theo lifecycle; chờ process kết thúc rồi mới mở root9532, main3084798/source1511160. Profile tự khôi phục; không nhập credentials. Query cafe Hà Nội và public filter đã áp dụng, results nhìn thấy. Nội dung đầu trang thay đổi so với v2; không phải benchmark cùng dataset.

- Run `candidate-194918ec-c046-4222-901c-77ad1814cb51`, schema3/LIVE.
- UTC `2026-10-27T15:42:10.835Z` → `.867Z`,32ms/actions1.
- **UNSUPPORTED_OVERLAY, root NONE, visited0/examined0/candidates0**. Chưa tới layout/marker/header của bài. Không được dùng counters0 để kết luận v3 sửa sai selector hoặc nguồn hết dữ liệu.
- UI trước/sau run hiển thị results, không có dialog/challenge/auth/access-denied nhìn thấy. Chưa biết DOM node cụ thể đã kích hoạt guard; summary v3 không có metadata barrier.
- [Summary nguyên bản đã làm sạch](p02-live-dom-layout-v3-2026-10-27.json), SHA256 `cce5e436b5fc4a70bf348ea1b7fbed3e2b0c1df95ee447f37c3043ba3ec721f0`.
- Payload rỗng SHA256 `9a82ded46481d3240dba33190c8d0d2ca8a35abb32777216e87c1ee40dfeb601`; không đọc/dump payload.
- Fixed script `0c820ada5aaf8259d6ae2657f9d493217179827044507e9a583f2969eeef7b03`; compiled controller `1e7e54afa3979ee914173b9fd55042b6b6baf86ccccf70600ba27e3cb7b3b63b`.

Code review sau run: `barrier()` dùng `walkable(node)` cho DIALOG/role dialog/alert. Predicate mới chỉ loại HIDDEN, nên một vùng ARIA alert rỗng/boxless cũng có thể kích hoạt UNSUPPORTED_OVERLAY. Đây là đường false-positive cụ thể cần fixture; chưa khẳng định node nào trên Facebook thật là nguyên nhân. Không tắt overlay/auth guard hoặc thử lặp nguyên build.

[Dispatch sửa overlay](../handoffs/lead-p02-overlay-visibility-dispatch-2026-10-27.md). Runtime9532/source1511160 giữ nguyên,1/3native starts đã dùng. Permission UNKNOWN/benchmark OFF/valid0 và gates giữ nguyên. Run đã dừng đúng guard; chưa continuation.
