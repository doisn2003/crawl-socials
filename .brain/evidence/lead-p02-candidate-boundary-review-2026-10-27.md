# P02.02 boundary v2 — lead review

Ngày 2026-10-27. **Hiện hành: R-C3 đã đóng, boundary v2 đã nghiệm thu và đã chạy LIVE ở lượt kế tiếp**, xem [evidence v2 thật](p02-live-candidate-boundary-v2-2026-10-27.md). Phạm vi theo [dispatch](../handoffs/lead-p02-candidate-boundary-dispatch-2026-10-27.md), sau run thật NO_HEADER7. Các mục dưới giữ lịch sử review và lần activation bị input guard; runtime26904 đã được thay bằng22308 ở lượt thành công.

Lead đọc script/controller/schema/index/native fixture. V2 thêm lựa chọn từ main khi first feed không cho mẫu, bounded ancestor/co-location và rejection shapes; chung cap2500nodes,12boundaries,5candidates,5shapes. Compile và31tests baseline của lead PASS; chưa đủ để chấp nhận fallback mới.

## R-C3 — deep wrapper bị đánh dấu covered trước fallback

Reviewer tái hiện nghi vấn lead bằng fixture một feed child chứa7div wrappers quanh đúng một post Public/header/time/message. Header vượt depth6, body vẫn được đếm; examine trả NO_HEADER nhưng `c.bodies>0` khiến covered.add(wrapper). Fallback sau đó skip toàn wrapper: mainExamined0/samples0 thay vì1candidate. Counterpart Friends vẫn phải0; không yêu cầu nới public guard hoặc gộp nhiều bài.

Lead chạy lại compiled snapshot reviewer: **12tests,11PASS/1FAIL**. Lỗi ở test `review v2: a single deep feed-child wrapper can be rediscovered without allowing a private counterpart`; observed0, expected1. Source script của snapshot reviewer: `63d44dc1b5d87df2f5c5ce4fe64b2ff57eaea3c4161ae979e40aeb40f50be658`.

Đã gửi owner sửa với tests reviewer giữ nguyên. Chờ fix/native/hashes rồi lead kiểm lại trước nạp LIVE. Các8privacy/lifecycle regressions, auxiliary-feed/outer-article, shared2500cap và shape sanitization của reviewer đã PASS. Chưa nâng gate hoặc gọi source thử lại.

## Nghiệm thu sau fix

Lead đọc fix `exploreWrapper`: chỉ NO_HEADER với≤1body, không restricted/ad và có hint ngoài depth hoặc article bị prune mới không mark covered. Restricted/ambiguous/ad vẫn khóa, public guard và global caps giữ nguyên. Reviewer tests không đổi; counterpart Friends lần này chạy hết và bị loại. Reviewer12/12 PASS, R-C3 CLOSED.

Lead fresh compile và **44/44 tests PASS**. Ba native suites riêng **9/9 cases PASS**: [boundary](lead-p02-candidate-boundary-fixture-2026-10-27.json), [candidate regression](lead-p02-candidate-boundary-candidate-regression-2026-10-27.json), [metadata regression](lead-p02-candidate-boundary-metadata-regression-2026-10-27.json). Manifest owner lúc15:07:15.846Z khớp **14/14 owned hashes**. Shared build đã chạy, **129/129 frozen entries** khớp.

- Candidate script SHA256 `086660031bf0d691fe4a1826ae8387dd2cf78706043e88869000826ea02c8588`.
- Compiled controller SHA256 `2e5f09d418e93254798649fdbc49dc39c647a736ae6d6e4aa56791c7ee44712b`.
- Source script SHA256 `1938bf5a45ec28b24e25ff4f9fac15e0a3fee9c7b756d31aaf1506de4e98df6b`.
- Reviewer test SHA256 `3dc31a18448287eeff1f5b508a480a6197e6044ef3674064633d40944d890aae`.

## Activation chưa thực hiện — thao tác máy đang diễn ra

Lead chọn đúng main4656052 và quan sát UI CSD, nhưng `Alt+F4` bị Computer Use trả `user input was detected in this window; call get_window_state before continuing`. Command launch có guard kiểm PID26904 còn chạy nên dừng trước Start-Process; **không có instance mới và không kill**. Lead refresh thấy cửa sổ bị app khác che; thao tác activate lại cũng bị cùng input guard. Dừng các lần giành focus tiếp theo, giữ phiên. Kiểm process xác nhận26904 vẫn sống.

Hiện tại: shared dist là boundary v2 đã nghiệm thu, **runtime vẫn candidate v1**, main4656052/source3476960; không có run LIVE mới. Main chat đã idle theo cursor `32a77677-5118-4445-9c7c-12dd42f259df:90`, subagent completed. Không gọi cả hai đang triển khai.

Bước tiếp của lead: khi cửa sổ thao tác được, lấy state mới, đóng app theo lifecycle, xác nhận PID cũ kết thúc, mở cùng profile với các cờ đã dùng, khôi phục exact query/public filter rồi chạy một read candidate v2. Không rerun toàn bộ tests/build nếu hash không đổi. Nếu vẫn có input guard, giữ phiên và không lặp giành focus. Không cần hỏi lại login/API/grant; không thêm task framework trong thời gian này. Gate và valid count chưa thay.
