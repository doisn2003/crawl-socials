# P02 overlay visibility v4 — code ready

Ngày2026-10-27, Asia/Bangkok. Theo [dispatch](lead-p02-overlay-visibility-dispatch-2026-10-27.md) và [LIVE v3](../evidence/p02-live-dom-layout-v3-2026-10-27.md). Worker không xác định DOM node Facebook gây lỗi, không đọc nguồn/restart runtime9532/source1511160 hoặc ghi shared dist. Không thay policy/session/BrowserHost/master/gates.

## Snapshot để review

Candidate script/result/validator/envelope/payload cùng **schema4**. Metadata diagnostic khác giữ nguyên. Native trigger và đường local dữ liệu vẫn như trước; permission UNKNOWN, diagnostic-only, benchmark OFF, valid0.

Guard không còn coi `walkable(alert/dialog)` là đủ. Phân biệt traversal với evidence blocker:

- Empty role=alert (CONTENTS/BOXLESS/zero-area hoặc region có box nhưng không content) được skip. Positive-area dialog/modal trong viewport vẫn fail-closed; display:contents không tự thành blocker từ wrapper.
- Visible text qua Range hoặc visible control/media ở overlay/descendant dừng UNSUPPORTED_OVERLAY. Password/OTP dừng AUTH_REQUIRED; reCAPTCHA frame/known challenge text dừng CHALLENGE; known denied text dừng ACCESS_DENIED. Không đọc value của input hoặc trả text/aria-label/URL ra report.
- Candidate path kiểm hidden/style ancestry tối đa32mức, chặn hidden/display:none/visibility/opacity/aria-hidden dù child cố bật visibility. Descendant walk prune hidden subtree; wrapper contents có descendant hiển thị vẫn được xét. Overlay text/control cần area giao viewport; auth/frame guard giữ area check bảo thủ.

Preflight dùng một fixed XPath ordered snapshot **tối đa17 returned nodes**:16candidates+1sentinel. Bao gồm password/OTP/reCAPTCHA/dialog/alert theo document order, không còn first-match che blocker thứ hai. Không JS walk toàn body hay materialize một NodeList toàn trang. Native XPath vẫn có thể tìm trên toàn document nội bộ, không hard-preempt trong JS; main deadline/elapsed guard vẫn giới hạn việc nhận kết quả.

Tối đa16candidates,128overlay descendants **chung cả run**, ancestry32mỗi candidate; các lượt đọc đều cộng vào global2500nodes/deadline1giây, không reset trước main hoặc giữa barriers. Khi overflow, hết descendant/node/ancestor/time budget hoặc API không sẵn sàng, trả **BARRIER_SCAN_INCOMPLETE**, xóa staged samples và không trích tiếp. Không được coi scan thiếu là CLEAR. Stop/owner-change/late result và giới hạn main4giây/run5phút/12boundaries/5samples/5shapes/tổng32KiB giữ nguyên.

`barriers` chỉ enum/count: state NOT_STARTED/CLEAR/VISIBLE/INCOMPLETE; reason/kind/evidence; inspected/hidden/empty/visible/descendants/ancestors và overflow. Summary/API return vẫn không có content, identity hoặc canonical URL; payload chỉ ở candidates.json ngoài repo, retention7ngày/manual cleanup. Đây là bằng chứng các node đã xét, không bảo đảm mọi CSS/overlay format hoặc thay đổi sau snapshot đã được nhận diện.

## Fix consistency sau review

Validator nay kiểm hai chiều: auth/challenge/denied/overlay status phải có state VISIBLE, kind/evidence tương ứng và visible1; CLEAR/NOT_STARTED không được mang positive evidence, visible count hoặc overflow; INCOMPLETE không mang visible evidence. Nhánh fixed challenge/denied text trong FORM của bounded candidate walk cũng ghi metadata VISIBLE. Nó dùng quota inspected hiện có; nếu đã16candidates thì dừng INCOMPLETE/CANDIDATE_LIMIT, không tạo record thứ17 hoặc giữ payload. Schema4/caps và guard extraction không mở rộng.

## Checks cuối

```powershell
node scripts/facebook-dom-diagnostic-build.mjs
node --test .test-build-csd-dom/tests/facebook-dom-diagnostic.test.js .test-build-csd-dom/tests/facebook-public-candidate.test.js .test-build-csd-dom/reviewer/tests/facebook-public-candidate-review.test.js
node scripts/facebook-public-candidate-smoke.mjs --overlay --output .brain/evidence/p02-overlay-visibility-fixture-2026-10-27.json
node scripts/facebook-public-candidate-smoke.mjs --layout --output .brain/evidence/p02-overlay-visibility-layout-regression-2026-10-27.json
node scripts/facebook-public-candidate-smoke.mjs --boundary --output .brain/evidence/p02-overlay-visibility-boundary-regression-2026-10-27.json
node scripts/facebook-public-candidate-smoke.mjs --output .brain/evidence/p02-overlay-visibility-candidate-regression-2026-10-27.json
node scripts/facebook-dom-diagnostic-smoke.mjs --output .brain/evidence/p02-overlay-visibility-metadata-regression-2026-10-27.json
```

Snapshot sau consistency fix: build PASS; **51/51 tests PASS** =25owner +26reviewer read-only. Owner compile reviewer test vào `.test-build-csd-dom/reviewer` với strict flags như lượt trước, không sửa reviewer source/output của họ. **3/3 native overlay PASS** được chạy lại trên code sau fix.12native regression đã PASS trên v4 ngay trước thay đổi telemetry này, không lặp lại theo phạm vi targeted recheck lead giao; commands full regression ở trên là lịch sử kiểm của lượt v4 đầu. Native temp data xóa sạch, external0 theo local protocol, observer không attach, shutdown0windows/0WebContents.

Native overlay repro:3empty alerts +1hidden alert trước main trả1sample, barriers CLEAR/empty3/hidden1. Thêm dialog contents có visible descendant sau các node đó trả UNSUPPORTED_OVERLAY, inspected5/visible1. Hidden password trước visible CAPTCHA trả CHALLENGE, inspected2/hidden1; không payload riêng tư lọt file. Candidate regression cũ vẫn kiểm password positive. Unit fixed-script VM kiểm CANDIDATE_LIMIT/DESCENDANT_LIMIT/TIME_LIMIT/API_UNAVAILABLE đều INCOMPLETE, không scan main hoặc ghi content. Thêm direct-form literal challenge/denied và exhausted16 quota, cùng repro ACCESS_DENIED→CLEAR phải reject. Các private/alias/deep-header/layout/identity/contact/lifecycle reviewer regressions giữ PASS.

Thêm fixture-only `--csd-overlay-visibility-fixture`/smoke `--overlay`, chỉ cùng public candidate fixture và không kết hợp boundary/layout variants; không đổi LIVE flags/menu. Sửa đúng script/controller/fixture/owner test và index/smoke nhỏ cho fixture. [Manifest cuối](../evidence/p02-overlay-visibility-files-2026-10-27.json) gồm fixed script/controller hash, owned files và toàn isolated build. Copied probe-build metadata chỉ bootstrap baseline.

Source và `.build-csd-dom` đóng băng sau checks này để lead/reviewer đối chiếu, chưa nạp LIVE. Khi chạy thật tiếp, barriers metadata mới phân biệt được empty/hidden/visible/incomplete; không suy sẵn node Facebook nào hoặc coi fixture là kết quả nguồn.
