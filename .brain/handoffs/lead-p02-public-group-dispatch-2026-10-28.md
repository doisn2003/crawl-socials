# P02.02 — Exact public-group labels, v13

Đọc [nghiệm thu/LIVE v12](../evidence/lead-p02-auxiliary-review-2026-10-28.md), summary v12 và ADR-010/012/013. V12 được nhận97lead/79reviewer+3native; source thật0samples. AX cùng trang có2graphic `Đã chia sẻ với Nhóm công khai`,1graphic `Đã chia sẻ với Công khai`. Whitelist publicLabels hiện bỏ biến thể nhóm công khai. Không suy AX=attribute DOM hoặc xác nhận mapping boundary chưa đo.

## Phân công

- **CSD agent**: source/controller/schema nếu cần, owner tests/native fixture/smoke và `.build-csd-dom`/`.test-build-csd-dom`; handoff/manifest mới. Không reviewer files, shared dist, runtime, `.env`, master/README/gates.
- **csd_adapter**: baseline frozen v12 rồi reviewer tests/report/`.test-build-adapter-candidate`; không source owner. Sau baseline chờ code-ready, không mở rộng vô hạn suite.
- **Lead**: shared dist/runtime24084/main7082250/source2819162 và trạng thái. Chỉ lead thử nguồn sau review; không lặp v12.

## Công việc có giới hạn

1. Hỗ trợ chính xác nhãn được quan sát `đã chia sẻ với nhóm công khai`; dùng chung vocabulary cho discovery/examine/header tree/semantic scope. Chỉ thêm biến thể ngôn ngữ tương đương có lý do, ghi rõ chưa quan sát nếu thêm. Không dùng substring `công khai` hoặc keyword/filter làm publicity proof.
2. Direct signal vẫn phải visible và đúng header với single body/tree proof theo contract hiện hành. Giữ source_type UNKNOWN và PUBLICITY_NOT_INDEPENDENTLY_VERIFIED; public group label không tự biến record thành verified group/post. Negative/private/ad/quoted/body scope giữ nguyên.
3. Fixture baseline exact label dạng graphic/aria-label/title trong header; negative private group, text body/quote/comment, hidden/partial signal, label ngoài header và substring chứa public. Kiểm public label trên BUTTON/rolebutton hiện bị prune trước nhận dạng: nếu tái hiện thì sửa đúng signal trước prune, không duyệt tùy tiện mọi control; nested control label chỉ support nếu scope/bounds chứng minh được. Không coi đây là nguyên nhân LIVE đã chắc chắn.
4. Native positive và negative có ý nghĩa rồi freeze nhanh để lead đọc thật. Không tăng global2500/5samples/1s hoặc epsilon. Nếu cần để phân biệt missing-label-vocabulary với prune/geometry, thêm enum/count nhỏ (known-label seen/pruned/visible), không raw label ngoài fixed enum/DOM/path. Không làm thêm parser time/DB/UI/scale ở task này.
5. V12 fallback hết budget khi main article chưa hoàn tất là vấn đề kế tiếp nếu nhãn mới vẫn chưa ra mẫu. Không xử lý bằng ngầm tăng budget hoặc giảm negative/critical checks. Báo evidence/tái hiện cụ thể để lead chốt đường đọc tiếp.

Đầu ra: handoff/owned hash manifest/build id+native synthetic evidence; reviewer tái hiện baseline rồi đóng findings. P02.02 vẫn IN_PROGRESS, permission UNKNOWN/benchmark OFF, không gate PASS.

## Baseline 03:02 ngày28/10

Reviewer lượt28 chốt3targeted tests=1PASS/2FAIL trên frozenv12; lead đã chạy lại và tái hiện. R-G1: exact group label dạngSVG roleimg/aria-label,SPAN roleimg/title,IMG/aria-label đều0. R-G2: BUTTON/SPAN rolebutton với direct nhãn cũ Public cũng0, độc lập với vocabulary. Negatives vẫn0; phải giữ nguyên khi chạy bản sửa. Owner đang triển khai và đã nhận findings; reviewer idle chờ code-ready, không phải hai worker đều đang chạy. Runtime v12 vẫn giữ nguyên1/3starts; chưa thử lại nguồn.
