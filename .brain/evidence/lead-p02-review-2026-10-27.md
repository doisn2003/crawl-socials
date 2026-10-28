# Review độc lập P02.01 — 2026-10-27

Reviewer: Agent điều phối. Tác giả: `/root/csd_adapter`. Đọc [bàn giao](../handoffs/p02-adapter-2026-10-27.md), adapter contracts, registry, fake adapter, fixture và tests.

## Lượt đầu

- Compile cô lập bằng `.test-build-adapter/tsconfig.adapter.json`: PASS.
- Chạy lại 18 contract tests: 18/18 PASS.
- Đối chiếu 10 file trong manifest tác giả: tất cả SHA-256 khớp.
- Code không import Electron trong domain/application; branch không thêm dependency hoặc sửa phần browser của P01.02.
- Chưa chạy kiểm tích hợp vì CSD agent còn sửa main/session; không coi lỗi file main đang được xây dựng là lỗi của adapter branch.

## R02 — P2: continuation bị mất có thể quay lại trang đầu

**Chưa chấp nhận bàn giao lượt đầu.** Trên fake adapter đã initialize, gọi `fetchBatch(validRequest, null)` qua runtime JavaScript trả `status: OK` và candidate đầu `90071992547409931234`. Expected: `ERROR / INVALID_CURSOR`, không trả candidates.

Nguyên nhân: `fetchBatch` chuyển thẳng checkpoint xuống `#batch`; `null` vốn là sentinel của `searchPosts`/`discoverSources` lần đầu nên làm reset offset về 0. Khi một consumer deserialize mất checkpoint, hành vi này che lỗi continuation, tạo lặp trang và có thể báo tiến độ sai.

File lúc tái hiện: `src/infrastructure/adapters/fake-social-adapter.ts`, SHA-256 `4b92e8801ec00a7f1d92f2ef1e8b329434313e32650d3b6b8692543146c6d991`.

Đã giao tác giả sửa entrypoint continuation, bổ sung regression cho null/undefined/malformed checkpoint và giữ lifecycle error ordering nhất quán. Tác giả cập nhật evidence/manifest sau sửa; lead nghiệm thu lại trước DONE và trước giao task kế tiếp. Trạng thái hiện hành vẫn chỉ ở [master plan](../master_plan.md).

Tác giả đã bàn giao sửa R02 và báo 19/19 tests PASS. Chưa kết luận toàn task đạt vì lượt review tiếp phát hiện R03 bên dưới; lead sẽ kiểm lại bản hợp nhất sau sửa.

## R03 — P2: ép kiểu enum khiến dữ liệu sai vượt runtime validation

Tái hiện độc lập trên bản compiled: `validateAccessContext` trả `true` với `source_permission: ['DENIED']`; cũng trả `true` với `account_binding: ['UNVERIFIED']`, profile hợp lệ và account ID null. Các enum dùng `includes(String(value))`, nhưng type guard trả lại giá trị gốc chưa chuẩn hóa. Mảng `['DENIED']` vì vậy còn không khớp phép so sánh strict với chuỗi `DENIED` trong bước kiểm request.

Yêu cầu sửa: enum runtime phải có kiểu string đúng, không coercion array/object; rà cùng pattern ở raw post/source `author_type`, `visibility_at_observation`, `content_type`. Regression phải từ chối malformed context bằng INVALID_REQUEST và malformed fixture enum bằng SCHEMA_CHANGED. Đã kích hoạt agent tiếp tục sửa R03; chưa giao task mới hoặc cập nhật DONE.

## Nghiệm thu bản sửa R03

**Chấp nhận P02.01 trong phạm vi contract/fake adapter offline.** Lead đã đọc thay đổi: fetchBatch kiểm envelope sau lifecycle guard, stringEnum yêu cầu typeof string ở context và raw enum. Regression kiểm continuation hỏng không phát candidates, giữ tiến độ cursor đúng, từ chối array/object enum và vẫn từ chối chuỗi DENIED hợp lệ.

Kiểm độc lập ngày 27/10/2026:

- `node node_modules/typescript/bin/tsc -p .test-build-adapter/tsconfig.adapter.json`: PASS.
- `node --test --test-reporter=tap .test-build-adapter/tests/adapter-contracts.test.js`: **21/21 PASS**, gồm R02/R03.
- `npm run check`: **PASS**, type checks toàn main/renderer/tests và 44 contract checks.
- Đối chiếu manifest revision R03: **10/10 file SHA-256 khớp**.

R02/R03 được đóng ở bản này. Không chạy lại build/smoke vào output chung khi P01.02 còn triển khai; smoke và unit tích hợp toàn bộ sẽ được kiểm khi nhánh session bàn giao. Không phát hiện lỗi chặn khác trong phạm vi P02.01. Fake vẫn FIXTURE, cursor SAME_INSTANCE; kết quả không làm gate nguồn hoặc benchmark PASS.

Đã chuyển CSD adapter agent sang P00.04 để chuẩn bị protocol/source probe sớm. [Phân công tiếp](../handoffs/p00-protocol-dispatch-2026-10-27.md); trạng thái hiện hành ở master plan.
