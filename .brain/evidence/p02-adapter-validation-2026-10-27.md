# Kiểm chứng P02.01 — adapter contracts và fake adapter

Ngày: 2026-10-27, Asia/Bangkok. Tác giả: CSD adapter agent (`/root/csd_adapter`). Bàn giao cho Agent điều phối nghiệm thu; chưa sửa status/owner/gate trong master plan.

## Kết quả

**21/21 contract tests PASS sau sửa R02/R03**, TypeScript strict compilation cho nhánh adapter PASS. [TAP](p02-adapter-tests-2026-10-27.tap) lưu kết quả từng ca, [manifest](p02-adapter-manifest-2026-10-27.json) lưu SHA-256 source/test/spec hiện tại.

Đầu ra: [adapter contract](../specs/adapter_contract.md), domain types, application port/registry/request validation, fake adapter và fixture tổng hợp. Không thêm dependency, không sửa CampaignSpec/schema, main/preload/renderer, package/lock hoặc file browser/secrets của CSD agent.

## Các hành vi đã kiểm

- Consumer chỉ dùng `SocialAdapter`, nhận nhiều trang, giữ 4 observations/3 post IDs duy nhất trong mẫu PAGE, không làm tròn ID dài.
- Raw field LIVE/provenance không đổi FIXTURE do adapter gắn; field lạ trong raw fixture không lọt vào candidate.
- Registry tách declaration snapshot và không suy permission. Filter hỗ trợ theo mode; không âm thầm bỏ filter lạ.
- Malformed query/budget/context/date/range bị từ chối. USER_SESSION chưa xác minh trả LOGIN_REQUIRED, permission DENIED trả ACCESS_DENIED.
- R03 regression: enum context/raw phải đúng string. Array, nested array và object từ JSON không được coercion thành permission/binding/author/visibility/content/source type; trả INVALID_REQUEST hoặc SCHEMA_CHANGED, không có candidate thành công.
- Filter publication `[from,to)` và language có tác dụng; ngày thiếu không đạt range. Source xuất bản tách author; visibility UNKNOWN giữ nguyên.
- STOP/BUDGET_REACHED khác END/SOURCE_EXHAUSTED.
- Cursor bind run/query/policy/filter/profile/account/access context và version; cursor khác instance bị từ chối dù cả hai đã phát cursor đầu tiên.
- R02 regression: `fetchBatch` nhận null/undefined/thiếu field/sai kiểu/trường lạ trả INVALID_CURSOR và không có page/candidates; kiểm cả posts và sources. Cursor hợp lệ vẫn phát đúng trang sau các request hỏng. NOT_INITIALIZED/STOPPED được ưu tiên nhất quán.
- Retry cùng cursor phát lại cùng tập candidate/continuation, không advance vị trí ẩn. Rate limit một lần có retry-after và tiếp tục đúng batch.
- Login/challenge/network/schema error không trở thành OK rỗng; malformed row/numeric ID gây SCHEMA_CHANGED.
- Source discovery phân trang riêng; source feed yêu cầu ID. Permalink match chỉ là MATCHED_FIXTURE.
- Initialize/stop idempotent theo lifecycle; stop terminal; caller không mutate được fixture/registry qua output.

## Lệnh đã chạy

Vì CSD agent đồng thời sửa main/browser, nhánh này dùng output riêng `.test-build-adapter/`, không ghi `dist/` hoặc `.test-build/`.

Tạo config build tạm `.test-build-adapter/tsconfig.adapter.json`:

```json
{
  "extends": "../tsconfig.tests.json",
  "compilerOptions": { "rootDir": "..", "outDir": "." },
  "include": ["../tests/adapter-contracts.test.ts"]
}
```

```powershell
node node_modules/typescript/bin/tsc -p .test-build-adapter/tsconfig.adapter.json
node --test --test-reporter=tap .test-build-adapter/tests/adapter-contracts.test.js
```

Một lượt `tsc -p tsconfig.main.json --noEmit` trước đó đạt khi contract/fake ban đầu được tạo. Lượt sau gặp `src/main/index.ts` đang import `session-smoke.js` chưa có trong lúc Agent kia triển khai; không sửa file của họ để né lỗi. Lượt bàn giao ban đầu có 18 tests đạt; sau R02 có 19 tests, sau R03 có **21 tests và compile cô lập đạt**. Điều phối chạy `npm run check` và `npm test` tích hợp sau khi hai nhánh bàn giao.

## Sửa R02 sau lead review

Lead tái hiện `fetchBatch(validRequest, null)` trả OK/trang đầu do null bị hiểu là sentinel initial search trong helper chung. Đã thêm validation checkpoint tại entrypoint `fetchBatch`, sau lifecycle guard và trước khi gọi helper. Chỉ `searchPosts`/`discoverSources` được sử dụng sentinel nội bộ. Không thay mode tìm kiếm, source/contract scope hoặc gate. Regression kiểm 10 dạng malformed continuation trên cả hai kiểu trang, xác nhận không có `value` trong failure và valid cursor không bị thay đổi tiến độ.

## Sửa R03 sau lead review

Lead tái hiện `source_permission: ['DENIED']` và `account_binding: ['UNVERIFIED']` lọt validation do `includes(String(value))`; raw parser có cùng pattern cho author/visibility/content type. Đã bỏ coercion ở tất cả các vị trí này và yêu cầu `typeof value === 'string'` trước membership check. Regression round-trip JSON kiểm array/nested array/object ở context; gọi cả checkAccess và searchPosts phải INVALID_REQUEST. Raw post/source malformed enum phải SCHEMA_CHANGED, không trả object được cast thành typed candidate. Chuỗi DENIED hợp lệ vẫn trả ACCESS_DENIED.

## Giới hạn

Fake trả tập kết quả tổng hợp cho truy vấn thử, không mô phỏng ranking hoặc thực hiện keyword search Facebook. Cursor chỉ SAME_INSTANCE, không có persistence. Job/decision/snapshot mới là forward types; chưa có DB, scheduler, evaluator hoặc snapshot freeze thực tế. Fixture không xác minh đăng nhập, public visibility, permalink hay permission live. Không thu dữ liệu MXH, không tăng valid LIVE count và không thay G00/G01/G02.

Không chạy kiểm đóng gói hoặc Electron cho nhánh không phụ thuộc Electron này; việc browser/session thuộc P01.02 và kiểm tích hợp của điều phối.
