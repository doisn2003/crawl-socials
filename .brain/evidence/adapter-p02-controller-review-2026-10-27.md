# Review độc lập writer/freeze P02.02 — 2026-10-27

Reviewer: subagent `/root/csd_adapter`, trong chat lead. Theo [bàn giao controller](../handoffs/csd-probe-controller-p0202-2026-10-27.md). Lead review controller/driver/main và integration riêng; file này không thay nghiệm thu hoặc gate của lead.

## Kết luận

**Không có finding còn mở trong phạm vi writer/freeze trên bản cuối đã kiểm dưới đây.** Đã đọc `src/main/probe-writer.ts`, `probe-freeze.ts`, các test tương ứng; đọc thêm sanitizer, generator build manifest và callsites controller để xác định ranh giới trusted input. Không coi fixture-only, metadata-only, chưa có parser/identity hoặc policy refs không giữ text copy là bug vì các giới hạn đó đã được ghi rõ.

Trong lượt review, snapshot writer đầu chỉ kiểm `after > deadline`. Tôi nghi ngờ clock rollback giữa hai lần đọc `now()` có thể tạo completion trước observation; khi probe trực tiếp chạy thì source/dist đã được owner sửa đồng thời. Bản cuối dòng 60 có `after < before || after < observed || after > deadline`. Repro trên bản cuối **bị chặn đúng**, không báo lỗi cũ đã sửa như finding hiện hành và không tuyên bố đã tái hiện bản cũ trước khi nó đổi.

## Kiểm đã thực hiện

| Kiểm / vị trí | Kết quả |
| --- | --- |
| `node --test .test-build/tests/probe-controller.test.js .test-build/tests/probe-freeze.test.js` trên build có sẵn | **20/20 PASS**, không compile/build chung |
| Writer lines 9–17, 26–32: root/run/file confinement | Đọc kiểm realpath, workspace overlap, symlink/junction, exclusive run directory và file whitelist. Unit root/junction/reuse PASS |
| Probe hardlink bổ sung | Ghi một ledger hợp lệ rồi tạo hardlink tới ledger đó trong temp sandbox; append tiếp trả `PROBE_PATH_DENIED`, nội dung linked file giữ nguyên |
| Sanitizer → writer lines 49–62 | Đưa BODY có text secret giả, unknown nested cookie giả, URL query token giả qua `sanitizeProbeCapture`; observations không chứa marker secret. Các field được persist chỉ là allowlisted diagnostic metadata |
| Clock rollback trong sync write | `before=Start+1000ms`, `observed=Start+1000ms`, `after=Start+900ms`, cutoff=Start+900ms → `observe=false`, frozen membership=0 |
| Completion bình thường đối chứng | `before/observed=Start+1000ms`, `after/cutoff=Start+1001ms` → `observe=true`, membership=1 |
| Bytes/cutoff/hash từ unit | Reject storage cap trước mutation; reserve finalization nằm trong cap; late write ngoài membership; total persisted bytes khớp file sizes; snapshot/member/evidence hashes khớp content |
| Freeze lines 8–30 và test | Hash manifest tại startup, đối chiếu listed input bytes ở Start; sửa built file/manifest bị BUILD_CHANGED. Evidence refs/version/hash tách với bản text copy; canonical campaign và effective config/runtime được trả cho controller |

Các probe bổ sung dùng module `dist/main/probe-writer.js` và `dist/main/probe-contract.js` có sẵn, Node `--input-type=module` qua stdin. Chỉ tạo `csd-adapter-review-*` dưới OS temp, hai namespace synthetic user-data/workspace riêng. Trước cleanup kiểm canonical parent đúng OS temp và basename đúng prefix; đã xóa temp. Không đọc credential/profile thật hoặc chạy Facebook/Electron/build.

## Bản được kiểm cuối

SHA-256 exact bytes tại thời điểm kiểm:

| File | SHA-256 |
| --- | --- |
| `src/main/probe-writer.ts` | `81f3b77c298f496b80b85569d97a7a112c185ec7309291e5a13fe1448b3ecb0e` |
| `src/main/probe-freeze.ts` | `2fb44ffc397a442b321ce49835e5717de98ac0f308b1261db748566ac72e2624` |
| `dist/main/probe-writer.js` | `ad2786b1470621af06623fa5afda94d47eaa01339109b1904d99c4a9993c60a6` |
| `dist/main/probe-freeze.js` | `88322a6fb1ff9e48b0f3e0a93029d94147cbad5d4707584069513dbf0c2559f8` |

## Phạm vi và giới hạn kết luận

- Writer nhận typed/sanitized data từ trusted main. Tôi kiểm đường gọi hiện có có sanitizer tạo object mới; không gọi API writer bằng object tùy ý rồi coi đó là remote payload exploit.
- Không kiểm khả năng chống người có quyền sửa đồng thời code/build manifest/artifacts hoặc TOCTOU chủ động trên filesystem; hash hiện là consistency evidence, không phải chữ ký/tamper-proof guarantee.
- Chỉ kiểm run diagnostic FIXTURE, valid=0. Snapshot không phải danh sách valid Facebook posts; chưa có source semantics hoặc benchmark proof.
- Không chạy portable/packaged integration. Nhánh packaged không re-read source/policy không được đóng gói; references chỉ pin path/hash theo giới hạn đã công bố. Runtime code trong dist vẫn được kiểm theo listed entries; bài review không chứng minh tính đầy đủ của mọi manifest do bên ngoài tự tạo.
- Controller, driver, main/IPC và toàn bộ integration/clock lifecycle do lead review; report này không mở source gate hoặc thay trạng thái task. Nếu source đổi sau hashes trên thì lead đối chiếu lại phần ảnh hưởng.

Không sửa source/test/package/dist/.test-build, source-probe artifacts, master plan/README; chỉ ghi file review mới này.
