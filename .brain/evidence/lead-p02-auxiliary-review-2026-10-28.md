# V12 — Nghiệm thu auxiliary scope và đọc nguồn thật

Lead đọc source field scopes, inherited BODY/FORM, visibleSignal, negative semantic aggregation/audit, schema12 và missing reason. R-A1 được reviewer đóng:79/79; lead fresh compile **97/97 candidate tests PASS** (18 owner+79 reviewer), native auxiliary3/3 PASS, external requests0. Shared build PASS;15/15owned và129/129frozen khớp trước nạp. Native evidence: `lead-p02-auxiliary-native-2026-10-28.json`; reviewer lượt27.

Fixed script `6dd3d58ca42a5d7c16d076cc3c5aab1836a189aa13127bc11a4aa8b382332ca8`; controller `018a7e599b40fd9576a059587f3026240dd74b3b672d5242ad187e8d53657055`. Đóng26476 bình thường, nạp24084/main7082250/source2819162 cùng profile. Phiên tự phục hồi; không đọc `.env`. Xác nhận cafe Hà Nội và Bài viết công khai trước1candidate action.

[LIVE v12](p02-live-auxiliary-v12-2026-10-28.json), run `candidate-7893f163-cbe6-4313-aee5-fcbd23ca4f10`,19:57:57.136–.189Z: **0samples/2500steps/7boundaries/53ms**, node captrue, barrierCLEAR, fallbackPARTIAL. Hai feed boundary đã có heading/body nhưng publicLabels0 → MISSING_PUBLIC; main ARTICLE cuối bị cap trước body/public. AuxiliaryOmitted1, negativeUnresolved0. Không còn OTHER poison trong lượt này; không phải cùng tập kết quả v11, không suy hiệu quả yield từ so sánh số.

Summary SHA256 `d9b55288d342d4519a5b79da1ff7ac2d4500810e603a1f418388fa89985eecf8`. Payload rỗng nằm ngoài repo, SHA `4402761a76608e738bb2f15079e9598fcb1daf403cf863c3c9da4fd705837215`, expires2026-11-03T19:57:57.187Z/manual cleanup. Không dump nội dung payload.

## Quan sát mới từ giao diện thật

Sau lượt đọc, Computer Use AX của cùng cửa sổ/query/filter cho các **graphic**:

- 2 nhãn `Đã chia sẻ với Nhóm công khai`.
- 1 nhãn `Đã chia sẻ với Công khai`.

Chỉ ghi label/count, không ghi author/body/URL bài. Bộ lọc vẫn bật. Đây là bằng chứng accessible label; chưa chứng minh cụ thể attribute DOM nào tạo nó hoặc mapping từng graphic vào rejection boundary. Source v12 chỉ nhận `public`, `công khai`, `shared with public`, `đã chia sẻ với công khai`, nên biến thể nhóm công khai chắc chắn chưa có trong vocabulary. Còn code control pruning trước public recognition là khả năng cần fixture kiểm, chưa gọi là nguyên nhân LIVE đã xác minh.

Giao v13 nhận dạng exact public-group label trong header và kiểm độc lập private/quoted/body/hidden cases. Không dùng filter làm proof, không rộng hóa substring match; source_type vẫn UNKNOWN, public validity chưa independently verified. Nếu exact label vẫn không đọc được, thêm chẩn đoán enum/count đúng điểm bị skip, không dump DOM hay nới budget vô căn cứ. Runtime24084/source2819162 giữ query/filter,1/3starts; không lặp v12. Permission UNKNOWN/benchmark OFF/valid0/gates giữ nguyên.
