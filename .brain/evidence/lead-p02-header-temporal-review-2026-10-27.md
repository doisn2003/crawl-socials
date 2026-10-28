# P02.02 — Lead review temporal/header v5

Theo [dispatch](../handoffs/lead-p02-header-temporal-dispatch-2026-10-27.md), [handoff](../handoffs/p02-header-temporal-2026-10-27.md) và [manifest cuối sau fix](p02-header-temporal-fix-files-2026-10-28.json). Review bắt đầu 27/10 UTC, kết luận cập nhật 28/10 giờ Asia/Bangkok. **R-T1–R-T3 đóng; v5 đã nghiệm thu và đọc LIVE.** [Kết quả thật](p02-live-header-temporal-v5-2026-10-28.md): CLEAR/2108 nodes/0 candidates, gặp local temporal limits. Runtime6680/main2557138/source724678 giữ profile. Các mục dưới là lịch sử review/activation; hiện trạng theo master v1.33.

## Kiểm tra của lead

- Đã đọc script, classifier, schema/validator/writer và fixture/flag wiring. Thay đổi code thuộc 7 file candidate/index/smoke trong phạm vi; BrowserHost/policy/session/DOM diagnostic không đổi. **16/16 owned hashes khớp** manifest lúc review.
- Fresh compile riêng `.test-build-lead-candidate` PASS. Chạy 4 test files được **71 tests: 68 PASS/3 FAIL**. Ba lỗi chỉ là reviewer assert `version=4` ở fallback/rejection/layout, trong khi contract mới schema 5. Đã gửi reviewer sửa expectation phiên bản và giữ nguyên mọi assert hành vi; chưa gọi toàn bộ suite PASS khi chưa chạy phần assert phía sau.
- Lead chạy native `--temporal` trên isolated owner build: **3/3 PASS**, [evidence](lead-p02-header-temporal-fixture-2026-10-27.json). Positive 5 samples/151 visits; negative 0 samples; partial chạm 2500 nodes không giữ partial sample. Đây là FIXTURE, không phải kết quả Facebook thật.
- Owner báo 26 unit/15 native PASS; lead đã đọc evidence nhưng không gán 12 native regression owner chạy thành kiểm độc lập của lead. Không lặp các suite đó khi không có thay đổi mới hoặc concern cụ thể.

## Snapshot đang review

- Script string `4e4e15c6ebbe8d5d2d51df177cb27760d59b9b6fc63e750e2b64b809860e0637`.
- Compiled controller `76cbbb7e632eb8388d0ac0d6e89ba5e450e7bdb74e3ccb18b6edc9510276469b`.
- Source script `4883a8e1070d4585702296e31390cb6a08d9183b7d43d3be3d7885369a03b9c3`.
- Source controller `6358415a68977d7ef80229f4311c4c46ca0df0dfb4347840950d8a2ac4e20cba`.

## Kết luận review và yêu cầu sửa

Reviewer đã cập nhật đúng 3 assertion schema 4 → 5, giữ các kỳ vọng hành vi. Kết quả **39 tests: 37 PASS/2 FAIL**: cả 8 temporal baseline, R-T1, 28 regressions và cap/schema case mới đều PASS. Hai lỗi mới đã được lead chạy lại trên compiled snapshot `.test-build-adapter-candidate/v5-temporal-failed/`, **2/2 tái hiện lỗi**; không compile đè source owner đang sửa.

- **R-T2/P2 OPEN:** `collectTemporal` hết 8 ancestor với text tail nằm sâu chỉ tăng counter; record giữ prefix `2 giờ` vẫn được promote. Repro tail `NOT_A_TIMESTAMP` có trong link nhưng không được gom. Expected 0 sample vì chưa đọc đủ whole string; actual 1 sample. Không được suy temporal từ prefix thiếu đuôi.
- **R-T3/P2 OPEN:** text branch chỉ gom khi normalized `sample` có nội dung nên bỏ text node khoảng trắng. Repro visible `1` + space + `2 giờ` bị ghép thành `12 giờ`, actual 1 sample, expected 0. Cần giữ dấu phân cách hiển thị trong chuỗi classifier.

Đã giao owner sửa hẹp, giữ caps/negative guards, chạy targeted tests và native temporal rồi chốt hashes. Không lặp unrelated native suites khi scope không đổi. Reviewer chờ code-ready mới. Permission UNKNOWN, benchmark OFF, valid 0, gates giữ nguyên; không đọc lại LIVE v4 hoặc mở continuation.

## Nghiệm thu cuối và nạp build — heartbeat 17:06Z

Lead đọc fix WeakMap truyền temporal scope theo nodes đã walk và invalidates record khi không thể thu đủ tail trong8ancestor; không tăng cap hoặc kéo dài ancestor search. Whitespace hiển thị nay tham gia raw text và cùng giới hạn96chars/16nodes. Reviewer giữ nguyên tests/expectations, compile riêng **39/39 PASS**, source hashes trước/sau ổn định; R-T2/R-T3 đóng.

Lead fresh compile/test4files: **74/74 PASS** (metadata23, owner candidate12, reviewer candidate39). Native temporal sau fix **3/3 PASS**, [evidence](lead-p02-header-temporal-fix-2026-10-28.json). **17/17 owned hashes** khớp manifest cuối. `npm run build` PASS, **129/129 frozen entries** khớp. Không gán15native của snapshot trước fix thành kiểm lại trên snapshot cuối.

- Fixed script cuối `31ace7d597525c40bcba193762109f5e308a8d7d3774b57b4589f3786f7260c2`.
- Compiled controller vẫn `76cbbb7e632eb8388d0ac0d6e89ba5e450e7bdb74e3ccb18b6edc9510276469b`, khớp shared dist.

Lead đóng runtime2460 qua lifecycle; xác nhận process đã kết thúc rồi mở **runtime6680/main2557138** bằng flags đã review, cùng userData/profile. Không kill/copy cookies/nhập credentials. Source cũ6492758 đã đóng cùng process, không dùng lại handle.

Main mới có lúc bị app khác che; sau activate quan sát đúng CSD. Lệnh Ctrl+End trả **`user input was detected in this window; call get_window_state before continuing`**. Lead đã reobserve như yêu cầu, nhưng ảnh vẫn là ứng dụng khác dù accessibility chứa CSD. Dừng input, không activate/retry tiếp để tránh giành focus. Đây là input-guard/capture contention, không auth/challenge hay auto-approval rejection. Không lưu ảnh ứng dụng khác.

Chưa mở source, **0/3 native starts** runtime mới; **chưa LIVE v5**. Không suy phiên Facebook hết hạn; chỉ biết profile vẫn được giữ. Lead bước tiếp là fresh state, mở đúng profile rồi query/public filter và1read khi quan sát/thao tác ổn định. Hai worker đã xong phần code/review và chờ evidence; không cần thêm tests/build nếu hashes không đổi. Latest LIVE vẫn v4, gates/permission/benchmark giữ nguyên.
