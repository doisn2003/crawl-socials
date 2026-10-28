# P02.02 — Current single-group-post context, v14

Đọc [LIVE v13 + UI evidence](../evidence/lead-p02-public-group-review-2026-10-28.md) và [ADR-014](../decisions/ADR-014-single-post-context-diagnostic.md). Lead nghiệm thu 102 candidate tests +3 native, 14 owned/129 frozen hashes. LIVE có 2 snippets/1997 steps/57ms; không caps/barrier. Cả hai truncated/identity null. Một click timestamp thực mở group route `multi_permalinks` chứa một post ID, inner post dialog có outer wrapper; body đầy hơn và comment phải tách. Không sinh permalink rồi báo verified.

## Owner và phạm vi

- CSD agent: bounded current-post reader/controller/menu binding/tests/fixture/smoke cần thiết; `.build-csd-dom`/`.test-build-csd-dom`, handoff/manifest. Không sửa reviewer files/shared dist/runtime/.env/master/README/gates.
- csd_adapter: review contract/baseline rồi independent tests trên code frozen, report/output riêng. Chỉ tập trung owned dialog/route/body/comment/barrier/bounds, không mở suite vô hạn.
- Lead: activation/runtime/source và nghiệm thu. Runtime25524/main2821588/source1052524 đang post dialog, 1/3 starts; không worker thao tác UI.

## Đầu việc

1. Thêm action rõ trong menu diagnostic để đọc current single-group-post theo ADR-014, tối đa 1 candidate. Fixed main-owned code/input, shared start budget/Stop/late return/frame ownership/session. Không bật production collector, không đụng user credentials.
2. Chấp nhận actual group route và single `multi_permalinks` chỉ như observed identity/context hint. Validate host/protocol/path/query/IDs/duplicates/list chặt; loại tracking khi lưu, không dùng numeric Number. Candidate vẫn unverified. Nếu canonical/permalink cũ không biểu diễn được hint thì dùng field riêng typed, không dán identity hint vào trường verified.
3. Chọn unique content post root với heading/public group/single body; outer dialog wrapper chỉ khi unique nested context. Không blanket ignore barrier; auth/challenge/deny marker/multiple independent dialog phải dừng. Comment/nested story/quote không thành body/identity/date.
4. Native fixture mô phỏng group URL + wrapper dialog + post header + message + comments và negatives: multiple post/list IDs/duplicate param, wrong origin, missing public/private, auth/challenge overlay, ambiguous 2 dialogs/body, comment text/ID/date contamination, cap/Stop/late. Không cần collect actual source trong worker.
5. Freeze/handoff sau checks có ý nghĩa để lead mở đúng post qua UI và đọc source ngay. Nếu thiếu evidence DOM để định root, thêm role/enum/count diagnostic tối thiểu, không raw DOM/strings unbounded. Không DB/UI deep/scale/continuation hoặc thêm framework.

P02.02 IN_PROGRESS. P06.01 chưa DONE từ 2 snippet thiếu bằng chứng; permission UNKNOWN/benchmark OFF/valid0. Mục tiêu tiếp: CSD trả body + observed identity/context của 1 bài thật, sau đó mới continuation.
