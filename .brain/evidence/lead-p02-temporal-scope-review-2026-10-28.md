# P02.02 — Nghiệm thu temporal scope v6 và thử nguồn

Ngày28/10/2026 giờ Asia/Bangkok. [Handoff](../handoffs/p02-header-temporal-scope-2026-10-28.md), [manifest](p02-header-temporal-scope-files-2026-10-28.json), [reviewer lượt13](adapter-p02-public-candidates-review-2026-10-27.md).

Lead đọc scope propagation/collector/append/classifier handoff/schema và limits. Thay ancestor search bằng known scope trong traversal; không tăng header cluster8 hoặc global2500nodes/1giây. Header text96nodes trong96chars là quyết định đã chốt. Metadata chỉ counts/allowlist; validator/writer schema6 khớp.

- Lead fresh compile:12candidate owner tests PASS; sau reviewer cập nhật3assertions schema5→6 và old-schema rejection, fresh compile +42reviewer tests PASS. Tổng **54/54 candidate tests PASS**; không lặp23metadata tests không liên quan và không cộng chúng vào lượt này.
- Reviewer độc lập **42/42 PASS**, giữ R-T1–3 và negative scope, thêm ngưỡng96/97; hashes source trước/sau ổn định. Không có blocker mới trong phạm vi review.
- Lead native temporal **3/3 PASS** trên isolated build: [evidence](lead-p02-temporal-scope-native-2026-10-28.json). Không gán fixture thành source proof.
- **12/12 owned hashes**, `npm run build` PASS, **129/129 frozen entries** khớp. Script `cde0d7ac60865910ba4d5eddae5252542a6ba67eb99b7734d6dca474130cb462`, compiled controller `3173cd4847594a8c4d153a6e76e9a0942cd394ff6bb028deeef3ccdc4396b15f`.

Đóng runtime6680 qua lifecycle và xác nhận process kết thúc; mở runtime20188/main1511604/source6361794 cùngprofile, session tự khôi phục. Không kill/copy cookies hoặc nhập credentials. Screenshot được trả có lớp tối và vùng con quanh con trỏ, nhưng AX đúng CSD/Facebook, inventory không trả lock/security surface; không suy đó là Facebook challenge hoặc sửa thiết lập màn hình. Dùng AX state hiện hành và tọa độ quan sát được để thực hiện thao tác. Một click offscreen bị tool từ chối ngoài window bounds; reobserve rồi Ctrl+End/refresh, không click mù.

Query/public filter xác nhận qua AX; chạy **1lượt LIVE v6**, xem [evidence](p02-live-temporal-scope-v6-2026-10-28.md). Sau run giữ runtime20188/source6361794,1/3starts. Chưa gate/benchmark/continuation; chuyển task theo kết quả thật.
