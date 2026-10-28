# P02.02 — Thu temporal theo scope đã biết, không mắc giới hạn nesting tùy ý

Ngày28/10/2026 giờ Asia/Bangkok, sau [LIVE v5](../evidence/p02-live-header-temporal-v5-2026-10-28.md). CSD agent triển khai, `/root/csd_adapter` review độc lập, lead runtime và task/gates.

## Việc thực hiện và quyết định giới hạn

1. Thay tìm lại8ancestor trên mỗi text node bằng temporal scope/owner đã truyền trong chính bounded walk, nếu có thể chứng minh node thuộc cùng link record trước body và ngoài heading/quote/comment/embedded story. Không suy owner khi scope không biết, không đọc `.textContent` hoặc subtree ngoài traversal. Giữ whole-string: tail không thu đủ phải vô hiệu record, không dùng prefix. Bổ sung positive fixture ngày render sâu hơn8wrappers; negative prefix+tail R-T2 vẫn0sample.
2. Lead cho phép nâng **headerTextNodes từ16 lên96** để biểu diễn tối đa96chars đang cho phép khi từng ký tự được tách riêng. Không thay cap2500nodes/1giây, 96chars/record,16records,4control probes/64probe nodes,12boundaries/5samples/32KiB. Đây là thay đổi kỹ thuật được review trong diagnostic nhỏ, không tăng số bài/action/network. Dùng chung global budget, không reset ở từng record. Nếu không đọc đủ whole record vẫn reject; không nới bằng cách cắt prefix. Kiểm một ngày có từng ký tự nằm trong span và cap97 text nodes bị loại.
3. Tách metadata giới hạn tối thiểu: record limit, char limit, text-node limit, scope/depth miss; có thể ghi số text nodes/chars lớn nhất theo counts. Không lưu text/date/label/href/CSS/class. Phân biệt không có text render với có text nhưng classifier không match. Chỉ thêm fields phục vụ giải thích lần thật kế tiếp; schema/writer/validator/limits đồng nhất.
4. Không tự tăng8ancestor của **header cluster**. Nếu scope collector sửa xong mà cluster chưa đủ, report chính xác; chỉ đổi cluster khi có repro/logic chứng minh co-location và không ghép hai bài. Không bỏ temporal/public để tạo sample.
5. Tập trung một patch hẹp và native temporal fixture, giữ R-T1–3/negative guards. Không mở framework, UI, storage hoặc scale. Không chạy lại mọi native suite không liên quan; reviewer giữ behavioral assertions. Một assertion cũ buộc `ancestorLimits>0` có thể đổi thành không nhận partial record, vì scope lookup mới không thực hiện ancestor probe đó; phải giải thích thay đổi contract, không bỏ negative expected0.

## Ownership và bàn giao

Giữ ownership dispatch temporal trước: owner candidate script/fields/controller/fixture/tests, index/smoke nếu schema/fixture cần; `.build-csd-dom`/`.test-build-csd-dom`. Reviewer chỉ reviewer test/output/report, `.test-build-adapter-candidate`. Lead shared dist/runtime/master/README. Tối đa2workers.

Không tự restart hoặc đọc LIVE, không thay session/policy/BrowserHost. Runtime6680/source724678 đang ở query/public filter,1/3starts. Bàn giao source frozen/hashes và targeted checks; lead review/nạp/read ngay khi sẵn sàng. Người dùng đã nhường input ở lượt này, không hỏi lại login/search/Meta API. Permission UNKNOWN/benchmark OFF/gates giữ.
