# P02.02 — Nghiệm thu sửa frame con (v18)

28/10/2026, Asia/Bangkok. Lỗi được ghi trực tiếp trong LIVE v17: subframe history làm hủy phép mở lại dù main context không đổi. Phạm vi theo `../handoffs/lead-p02-subframe-events-dispatch-2026-10-28.md`.

## Kiểm tra của lead

- Đọc implementation của cả reader watchLoss và verifier watchNavigation. Frame con không được dùng làm route bài. No-op yêu cầu main URL chính xác, owner/view và document generation còn đúng; main navigation/redirect/Stop/barrier vẫn chặn.
- Fixed script chỉ đọc document chính, không truy cập document của iframe; hash không đổi `613d6e954927f34539ce25c86e7332c7fb5c496ba8755f40d0733604db2aa3cd`.
- Compile riêng và 152 targeted tests PASS.
- Native `iframe-read`, `iframe-barrier`, `iframe-main-change`: 9 outcomes PASS. Các event iframe thật đi qua cả reader và verifier. Barrier vẫn trả CHALLENGE, main URL đổi vẫn hủy. Không request ngoài hoặc cửa sổ/webContents còn lại.
- `npm run build` PASS, 21 owned files và 131 frozen artifact/input hashes khớp manifest `p02-subframe-files-2026-10-28.json`. Verifier compiled `84657c05fa61115f4c6e6e85489d02a140b12d8207c851d8f541f76a447397f6`; reader giữ `d2309718815267a5bbd4bddb5728f172a9c07d1f0b81d71c50403f4997eb5558`.

Reviewer chốt [review cuối](adapter-p02-subframe-events-review-2026-10-28.md): 50 tests và 6 native scenarios/18 outcomes PASS; 21 owned hashes khớp. Lead nghiệm thu cho lượt LIVE nhỏ.

## LIVE v18: REOPEN_MATCH

Lead đóng bình thường bản cũ, nạp PID27512, mở profile đã lưu; không dùng `.env` hoặc thao tác đăng nhập lại. Tìm `cafe Hà Nội`, lọc công khai, mở timestamp trong header có nhãn nhóm công khai.

- Anchor `candidate-019a4d43-4871-4827-9e91-5b4f11ebd492`: SAMPLES_READY,1sample/1hint,225ms,1.854 work steps.
- Verification `candidate-4431a802-2f77-41ad-a98b-1455a717a2cd`: **REOPEN_MATCH / MATCHED**,3.426ms,1navigation/1fresh read.
- Fresh read `candidate-01a77755-a83f-47b2-ac54-3bb71ff18089`: SAMPLES_READY,1sample/1hint,3.052ms,1.859 work steps. Không script/node cap hoặc barrier. Thời gian này gồm chờ script trong trang đang tải; không suy thành tốc độ thu ổn định.
- Body hash anchor/fresh cùng `0561033b0991cf0740e3051eec27b003076e3dec46e23dc5792049e066d37d61`; context/quality khớp, vẫn VISIBLE_SNIPPET.
- Trace có một SUBFRAME history ở NAVIGATING và hai MAIN same-document exact-URL events ở READING. Cả ba NO_OP với main context giữ nguyên; không cancellation/overflow. Đã kiểm chứng lỗi hủy nhầm được xử lý ở lần thật này.

[Evidence sạch cùng summary/payload hashes](p02-live-subframe-v18-2026-10-28.json). Đây là một bài được đối chiếu lại, không hai unique records; chưa chứng minh full text/canonical permalink hoặc năng lực1.000bài.

[Audit độc lập v18](adapter-p02-v18-live-sample-audit-2026-10-28.md) đã tính lại 6/6 hashes, đối chiếu proof refs và xác nhận snippet373 ký tự/context/quality khớp. Relevance ACCEPT theo rubric hiện tại vì nội dung tuyển nhân sự cho quán cà phê, không chỉ trùng keyword; không gọi đây là mẫu review quán. Lead nhận kết luận audit ở đúng phạm vi đó. Body boundary/source/identity/full text và tổng năng lực thu vẫn chưa được nâng trạng thái.

Lead đã quay về search công khai và quan sát hai timestamp link đều có href giữ chỗ `/search/top`, không có post route. Giao bước tự mở đúng timestamp đã bind header theo [ADR-016](../decisions/ADR-016-observed-search-post-open.md) và [handoff](../handoffs/lead-p02-search-post-open-dispatch-2026-10-28.md), trước pilot tối đa5/continuation. Main triển khai; reviewer audit v18 rồi review độc lập. Runtime27512/main3867858/source9109972,2/3starts đã dùng. Giữ permission UNKNOWN, benchmark OFF, valid0 và gates chưa đánh giá.
