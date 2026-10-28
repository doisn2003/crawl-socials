# P02.02 — Phân biệt overlay hiển thị với vùng ARIA rỗng

Ngày2026-10-27, sau [LIVE v3](../evidence/p02-live-dom-layout-v3-2026-10-27.md). Owner CSD agent, reviewer /root/csd_adapter, lead nghiệm thu/runtime/master. Phạm vi source/build/tests vẫn như dispatch layout; docs prefix p02-overlay-visibility. Không thay BrowserHost/policy/session/shared dist. Giữ root9532/main3084798/source1511160, query/public filter;1/3native starts đã dùng.

## Việc cụ thể

1. Tái hiện bằng native fixture một empty `role=alert` (boxless/display:contents và zero-area block) ngoài main cạnh một public post. Guard `walkable` không đủ bằng chứng overlay đang hiển thị. Tách predicate traversal khỏi visible blocker: wrapper không box có descendants hiển thị vẫn phải được kiểm, nhưng vùng rỗng hoặc hidden ancestry không được tự tạo barrier.
2. Giữ fail-closed cho dialog/alert hiển thị, password/OTP, CAPTCHA và denied thực. Không bỏ role alert/dialog hoặc cho chạy qua xác minh. Kiểm cả wrapper display:contents chứa dialog/challenge thật và hidden ancestor với visible child. Nếu scan không hoàn tất vì budget thì dừng rõ ràng, không coi như không có barrier.
3. Preflight hiện `querySelector` chỉ lấy first match. Khi bỏ qua empty/hidden first match, phải không bỏ lỡ visible blocker tiếp theo ngoài main. Dùng discovery có giới hạn và budget chung; không quay lại quét toàn body trước main, không tăng cap hoặc reset deadline. Test empty-first/visible-second và hidden-first/visible-second.
4. Thêm metadata tối thiểu chỉ enum/count để lần thật kế tiếp phân biệt empty/hidden/skipped/visible/incomplete; không aria-label/body/URL/CSS/class. Nếu đổi result schema thì script/validator/envelope/tests cùng phiên bản. Không cần hệ thống chẩn đoán mới.

Owner gửi code-ready/hash/native checks; reviewer viết cases độc lập trong file reviewer, không sửa source. Lead chạy kiểm phù hợp, nạp một lần rồi đọc một lần. Các49tests/12native đã PASS của v3 là baseline lịch sử, không thay cho kiểm regression mới. Không claim node Facebook cụ thể đã được xác định khi chưa có metadata; không hỏi lại login/permission, không continuation.

## Baseline reviewer và lead đã tái hiện

Lượt heartbeat15:45Z: reviewer compile21tests trên v3 c29df29…;18PASS/3FAIL,17regressions cũ vẫn PASS. Lead chạy lại **compiled snapshot của reviewer** (không compile source owner đang thay đổi), cũng18PASS/3FAIL:

- **R-O1 OPEN:** empty boxless role=alert ngoài main trả0candidate/UNSUPPORTED_OVERLAY thay vì1candidate. Case matrix contents/zero-area/dialog chưa được tính PASS vì assertion đầu đã fail.
- **R-O2 OPEN:** alert dưới ancestor display:none, child khai visible, vẫn bị coi là overlay. Expected không block. Các nhánh hidden khác trong cùng test chưa được tính PASS.
- **R-O3 OPEN:** first alert display:none +second alert hiển thị ngoài main trả SAMPLES_READY thay vì UNSUPPORTED_OVERLAY. First-match masking đã có repro; chưa suy đây là shape Facebook thật.

Test visible overlay và wrapper contents có descendant hiển thị đã PASS. Reviewer giữ cases này cho rerun fix; bổ sung incomplete/budget sau khi contract mới chốt. Lead đã gửi owner cả3findings, chưa nạp build đang sửa hoặc chạy nguồn lại.

## V4 code-ready và finding còn lại

Lead15native/24owner unit PASS, manifest16owned khớp. Reviewer bổ sung schema4/XPath/limits tests và lead tái chạy compiled reviewer:26tests/25PASS/1FAIL. R-O1–3 đã qua regressions. **R-O4**: validator nhận ACCESS_DENIED với barriers.state=CLEAR nhưng visible1/evidenceDENIED_TEXT. Owner sửa consistency hai chiều status/state/kind/evidence/count; giữ semantic challenge/denied trong FORM nhất quán. Chưa có bypasssample hoặc live evidence cho R-O4. Không đổi caps, không nới tests, không yêu cầu chạy toàn bộ native suite lại nếu script không đổi.
