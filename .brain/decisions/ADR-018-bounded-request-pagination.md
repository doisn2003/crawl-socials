# ADR-018 — Thử request continuation trong phiên Electron

2026-10-28, bắt đầu 10:03:49 Asia/Bangkok; baseline `46e7d20b8befc90b2530de54dd86fd09ae693058`.

Chỉ thị mới của user thay DỪNG trong phạm vi branch_plan: một agent, tối đa 60 phút tổng, B00/20 phút, B01/40 phút, B02/60 phút; không worker/automation cũ. Cho phép replay operation đọc search đã quan sát, giữ query/filter/profile và cursor opaque, tối đa 5 continuation tuần tự, 2 search/filter và 2 scroll khám phá. Phạm vi này thay hạn chế passive/DOM-only của ADR-010/017 cho phép thử này. Meta permission vẫn UNKNOWN, benchmark OFF.

Tái dùng browser host, encrypted session persistence và response observer. Request body/headers/cursor và raw responses chỉ trong bộ nhớ Electron; dataset trích lọc nằm ngoài repository. Chỉ ghi metadata operation/hash/drop và dữ liệu bài liên quan. Dừng khi barrier, deadline, cursor lặp hoặc hai batch không mới. Không suy HTTP 200/fixture thành LIVE PASS.

PASS chỉ khi continuation không render có bài mới, ít nhất 20 link thật được persist/dedup và đối chiếu nguồn. Nếu PARTIAL/FAIL: checkpoint nhánh, về main và rebuild trước khi chạy; một bước thay thế tối đa 30 phút, không thêm LIVE vượt ngân sách.
