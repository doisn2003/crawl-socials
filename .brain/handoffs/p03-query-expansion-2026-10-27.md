# Handoff P03.02 — Query expansion có giới hạn

Ngày 2026-10-27, owner `/root/csd_adapter`, gửi lead `/root`. **Sẵn sàng nghiệm thu**, chưa tự cập nhật task/gate. Theo [dispatch](lead-post-login-dispatch-2026-10-27.md).

## Files tự sở hữu

- [src/application/query-expansion.ts](../../src/application/query-expansion.ts): `expandCampaignQueries(intent, options)`, types/options/result/error contract, grammar hữu hạn và implementation limits.
- [tests/query-expansion.test.ts](../../tests/query-expansion.test.ts): 18 tests về scope/bounds/provenance/determinism/Unicode/fallback.
- [Evidence/API/lệnh kiểm](../evidence/p03-query-expansion-validation-2026-10-27.md), [manifest](../evidence/p03-query-expansion-manifest-2026-10-27.json), handoff này; compile output riêng `.test-build-expansion`.

## Hành vi chính

Giữ originals, sinh BFS với ba strategy bật/tắt độc lập: spelling café, cách diễn đạt cùng intent, thêm địa danh cấu hình. Parent/root/rule/reason/version/source refs đều có; dedup NFC/case không merge accent alias. BRAND/EXACT_PHRASE và unknown grammar giữ nguyên. INCLUDE không vay preferred place ngoài required list; query có địa danh không bị thay địa danh.

Caps thực áp trên tổng queries, depth và mọi candidate checks. Cap nhỏ hơn số seeds lỗi rõ thay vì drop seed. Candidate quá dài được đếm/skip. Exclusions chưa đánh giá hoặc geography chưa giải quyết → giữ originals và report; không tự nới nghĩa. FROZEN_ALLOWLIST chỉ phát entry có đường dẫn parent/rule hợp lệ trong list, report các entry chưa phát; không bịa parent hoặc phát intermediate query ngoài list.

Result bất biến, replay cùng input giống nhau. IDs là cục bộ trong result. Đây là proposals, không sửa campaign/filter/source permission và không thực thi query. API và các giới hạn đọc tại evidence.

## Verification và phạm vi

Compile riêng PASS, **18/18 tests PASS**. Đã sửa edge lead phát hiện về place sát text cap trước DISABLED, có regression cho DISABLED/all-off/enabled. Lệnh tái kiểm đầy đủ trong evidence; không cần build chung.

Chưa có planner P03.03, semantic classifier, entity resolver, network/LLM/service hoặc bảng SQLite. Không thay package/tsconfig/campaign-intent/shared/master/README. Không thao tác app/session, không thu Facebook và không thay gate sau login. Lead tiếp nhận review và quyết định công việc kế tiếp; agent dừng tại handoff này.
