# Kiểm chứng đầu ra P00.01 và P00.03 — 2026-10-27

Múi giờ tham chiếu: Asia/Bangkok. Task status/owner nằm duy nhất trong [master plan](../master_plan.md). Báo cáo này ghi bằng chứng của đợt triển khai tài liệu/thiết kế, không phải benchmark Facebook.

## Phạm vi và đầu ra

- P00.01: [product contract 1.0.0](../specs/product_contract.md), [schema](../specs/campaign.schema.json), [ví dụ giả](../specs/campaign.example.json), [workload quán cà phê đã xác nhận](../specs/campaign.coffee.json).
- P00.03: [ADR-001](../decisions/ADR-001-runtime-and-reuse.md), [danh mục reuse](../specs/hotmatch_reuse_inventory.md), [manifest HotMatch](p00-hotmatch-source-manifest.json), [probe runtime](p00-runtime-probe.json).
- Kiểm tra cấu hình và liên kết: [script](../../scripts/check-p00.cjs), [kết quả](p00-contract-checks.json). Không có parser/classifier/domain evaluator sản phẩm được triển khai ở P00.
- Phiên bản đầu ra CSD: [manifest SHA-256](p00-artifact-manifest.json) của tài liệu/schema/scripts/báo cáo trong đợt này; workspace CSD chưa có Git nên không có commit SHA. Manifest không tự hash chính nó.

Nguồn yêu cầu: R01–R07 của master plan và câu trả lời người dùng trong phiên ngày 2026-10-27: chủ đề quán cà phê/tìm quán/review/đi coffee/hẹn hò/Tiny Cafe/thương hiệu khác/sự kiện; được mở rộng từ khóa liên quan; Page/nhóm/cá nhân công khai đều phải có bài, không quota tỷ lệ, báo riêng; tối thiểu 1.000 bài không trùng trong ≤24h, nhanh hơn/nhiều hơn được khuyến khích, bài cũ được phép; ưu tiên Hà Nội nhưng không giới hạn Hà Nội. Không có tài khoản hoặc bài thật trong đầu ra.

## Kiểm tra contract

Chạy bằng Node `24.19.0`, Ajv `8.20.0` đã cài sẵn ở source HotMatch; chỉ load thư viện validator, không load entrypoint/manager/data HotMatch. CSD chưa có package/node_modules. Tham số validator-root chỉ dùng cho kiểm tra P00 trên máy này; P01.01 sẽ tạo dependencies CSD độc lập.

```powershell
node scripts/check-p00.cjs --validator-root C:\OwnProject\hotmatch-desktop --output .brain/evidence/p00-contract-checks.json
```

Các ca kiểm gồm: draft/ví dụ/workload xác nhận, chặn chuyển benchmark khi thiếu ngân sách/unknown/confirmation, source categories/minima, platform/target/deadline, keyword/content/geography, date UTC/ngày không tồn tại, giới hạn expansion policy, trường credentials lạ và liên kết tài liệu. Cấu hình benchmark có ngân sách số được tạo trong RAM chỉ để kiểm schema; không là ngân sách được cấp hoặc run thật. Các ca decision table trong product contract được rà soát tính nhất quán với master plan và workload, chưa có executable evaluator để gọi chúng là test thu bài.

Kết quả: **44/44 kiểm tra đạt**; có thêm negative cases từ chối JOINED_GROUPS/PRIVATE_GROUP trong schema công khai. Cả ba script `.cjs` được Node parse/chạy thành công; 20 file HotMatch được so lại SHA-256 sau audit và không đổi so với manifest. Nhánh R08/P11/G05 được giữ nguyên trong master plan, chưa triển khai ở P00.

Các ca thể hiện yêu cầu mới: 998 Page + 1 Group + 1 personal có thể đủ presence; 999 Page + 1 Group + 0 personal không đủ; review quán ngoài Hà Nội vẫn có thể ACCEPT; alias/retry không tăng unique, record persist sau cutoff và hydrate muộn không bù đủ dữ liệu; 1.020 bài audit còn 990 thì G02 FAIL.

## Audit nguồn và probe tương thích

```powershell
node scripts/probes/p00-hotmatch-audit.cjs C:\OwnProject\hotmatch-desktop .brain/evidence/p00-hotmatch-source-manifest.json
node scripts/probes/p00-runtime.cjs C:\OwnProject\hotmatch-desktop\node_modules\electron\dist\electron.exe .brain/evidence/p00-runtime-probe.json
```

HotMatch package 1.0.10, HEAD `632c4227c33ea54475a1aeb0181c8b6d37335144`, working tree dirty. Manifest ghi hash source/config, installed/locked dependency version, imports và Git status theo allowlist file; không đọc dữ liệu profile hoặc userData. Root package ghi ISC/private nhưng không có license file root, do đó ADR chọn tái triển khai pattern, không copy source nguyên văn.

| Môi trường thực | SQLite | ABI | Kết quả |
| --- | --- | --- | --- |
| Node 24.19.0, Windows x64 | 3.53.3 | 137 | WAL, foreign keys, rollback, idempotent insert, Unicode/ID string dài sau reopen, integrity_check đều đạt |
| Electron main 44.7.0 / Node 24.21.0 / Chromium 152.0.7977.130, Windows x64 | 3.53.4 | 149 | Cùng các ca SQLite đều đạt; class BaseWindow/WebContentsView có sẵn; safeStorage round-trip chuỗi giả đạt |

Probe chạy Electron main thật qua child process ẩn, không dùng ELECTRON_RUN_AS_NODE, không tạo cửa sổ hoặc browser request. userData/sessionData/logs/crashDumps đặt trong temp CSD riêng trước ready, không dùng profile HotMatch. Đã đóng DB, thoát process và xóa đúng temp subtree sau khi kiểm absolute path. Bằng chứng không có token/cookie/password hoặc dataset bài.

Primary docs đã đối chiếu ngày 2026-10-27 được liên kết ở ADR: Electron Session/Debugger/BaseWindow/Security/safeStorage/native modules, Node 24 SQLite và electron-builder. Metadata npm xác nhận Electron 44.7.0, builder 26.15.3, TypeScript 6.0.3 có thể chọn làm baseline; chưa compile TypeScript hay build CSD.

## Giới hạn và bước kế tiếp

Đầu ra đáp ứng nghiệm thu tài liệu P00.01: có schema/ví dụ/workload, quy tắc một bài có được tính, source mix không bị thay bằng Pages-only, unknown còn lại rõ. Đầu ra đáp ứng nghiệm thu thiết kế P00.03: đã kiểm source thực/quyền hiện có, có inventory/module diagram/tooling/namespace/SQLite và kế hoạch package, không cần copy HotMatch để bootstrap.

Chưa kiểm session isolation, view lifecycle, observer/parser Facebook, quyền/route nguồn, dữ liệu thật, throughput, crash recovery hoặc bản đóng gói. Mở DB trong probe không thay persistence P05; metadata builder không thay build Windows. Không có gate G00–G04 nào được chứng minh bởi đợt này.

P00.02 tiếp tục ma trận route cho cả ba nguồn; P01.01 có thể bootstrap offline theo ADR-001. O03 (quyền/route), O04 (ngân sách/can thiệp) và O06 (lưu/xuất/mục đích dữ liệu) còn cần P00.02/P00.04 trước live benchmark; không cần hỏi lại workload hoặc source mix đã chốt. Tiếp tục giữ mọi credentials/dataset ngoài `.brain` và không sửa dữ liệu HotMatch.
