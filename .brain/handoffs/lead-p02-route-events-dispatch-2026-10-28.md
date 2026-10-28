# P02.02 — Sửa navigation event trong observed-route verification

Đọc [review/LIVE v16](../evidence/lead-p02-route-verification-review-2026-10-28.md) và [summary](../evidence/p02-live-route-verification-v16-2026-10-28.json). Automated verifier INCONCLUSIVE/ROUTE_CHANGED trong read. UI cuối exact observed_route, hậu kiểm bằng start cuối đọc được body/context/quality khớp anchor. Không challenge/deny được chứng minh; không retry build cũ.

## CSD agent — owner

Giữ source/tests/native fixtures/build scope của ADR-015. Thêm trace nhỏ để lần thật sau biết event loại gì, ở phase nào, URL có exact match không, generation delta; bound rõ tối đa16events rồi inconclusive overflow, không raw URL/IDs/body/account. Ghi first cancellation cause; không gom mọi event thành ROUTE_CHANGED thiếu bằng chứng.

Tái hiện native history.replaceState/pushState **same exact URL** trong read/loading, đối chứng route khác/away-return/full navigation/redirect/owner loss/Stop. Điều chỉnh thật nhỏ nếu cần: same-document event với URL chính xác bằng expected/current và cùng owner/document generation có thể là no-op về ownership, không mặc định route changed. Các event khác vẫn invalidate/cancel. Quan tâm cả verifier watchNavigation và fixed-reader watchLoss; chỉ sửa verifier mà reader vẫn abort không giải quyết bài toán. Không globally ignore navigation hoặc cho mọi route cùng ID là tương đương. Nếu event khác mới là nguyên nhân, trace phải chỉ ra thay vì đoán.

Không nới tổng budget, thêm auto retries, arbitrary delay/sleep hay read loops, không đếm fixture/diagnostic vào valid. Read vẫn một lần sau new document; nếu UI chưa sẵn sàng ghi inconclusive. Freeze/handoff sớm với các kiểm liên quan và trace schema. Lead giữ shared dist/runtime/account.

## csd_adapter — reviewer

Review evidence v16 và semantics của no-op same-document versus route change. Chuẩn bị tests hẹp riêng; không sửa owner source/fixture. Khi code-ready, review frozen trace bounds/redaction, reader+verifier cùng thống nhất ownership, real navigation/late event/Stop vẫn fail closed, native proof có event thực. Không lặp broad regression/performance đã đạt trừ khi code mới đụng chúng. `.test-build-adapter-candidate` và reviewer files riêng.

## Lead

P02.02 IN_PROGRESS; runtime10544/main1836010/source1246228,3/3starts exhausted, không dùng thêm. Sau code + independent review sẽ nạp bản mới giữ profile và chạy đúng anchor+verification. Chưa continuation/scale, không hỏi lại login/search/API; chưa cần thao tác người dùng.
