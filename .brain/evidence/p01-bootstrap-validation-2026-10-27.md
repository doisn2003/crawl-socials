# Kiểm chứng P00.02 và P01.01 — 2026-10-27

Múi giờ Asia/Bangkok. Trạng thái task/gate chỉ nằm trong [master plan](../master_plan.md). Phạm vi: source matrix và bootstrap offline trên máy phát triển Windows x64, chưa chạy thu bài Facebook.

## P00.02 — Hiện trạng nguồn

Đầu ra: [source access matrix](../specs/source_access_matrix.md), [ADR-002](../decisions/ADR-002-facebook-source-route.md), [source evidence](p00-source-access-2026-10-27.json). Áp dụng [ADR-008](../decisions/ADR-008-direction-and-source-validation.md) được bổ sung đồng thời trong master plan; giữ Electron và không chuyển sang vendor.

Người dùng xác nhận trong phiên này: có account Facebook cá nhân thường; chưa có Meta app/API grant hoặc chấp thuận automation riêng; chọn nghiên cứu browser Electron, yêu cầu ghi đúng trạng thái chưa xác minh quyền/khả năng vận hành và tiếp tục offline. Matrix tách bốn trục phiên/capability/quyền/product fit, phân biệt Page/Group/personal và API/browser/search/vendor tham khảo.

Chọn FB_BROWSER_PUBLIC_SEARCH làm hướng nghiên cứu ưu tiên, trạng thái UNKNOWN. Chưa kiểm session, chưa có nguồn AVAILABLE, không thu social data hoặc đọc credentials. Các docs Meta Developers hiện fetch 429 và trang terms trả login/temporary-block được lưu đúng giới hạn; không dùng failure đó để kết luận tài khoản người dùng bị block. Ba nguồn công khai và campaign quán cà phê giữ nguyên, không thay bằng Pages-only. Các trang thông báo Meta/Google đọc được có URL/thời điểm/giới hạn trong evidence, không được xem như permission grant.

P00.02 đáp ứng nghiệm thu đánh giá nguồn dù route chưa sẵn sàng. G00 chưa PASS; cần điều kiện nguồn phù hợp cùng protocol/ngân sách P00.04 trước live probe. Không yêu cầu phải có Meta app để hoàn thành P00.02/P01.01.

## P01.01 — Bộ khung chạy được

Đầu ra: [README](../../README.md), package/lock/tsconfig/build scripts; main/preload/renderer/domain/application tách lớp, JSON Schema validator và runtime path configuration. Runtime pin Electron 44.7.0, TypeScript 6.0.3, builder 26.15.3, Ajv 8.20.0, @types/node 24.19.2; máy dev Node 24.19.0/npm 11.17.0. CSD tự cài dependencies và binary Electron trong workspace, không load runtime/package source từ HotMatch.

Ứng dụng `CSD 0.1.0`, app ID `io.csd.desktop`, xem campaign và kiểm fixture qua bridge hai hàm. UI partition `csd-ui`, sandbox/context isolation bật, Node integration/webview tắt, CSP và session policy chặn kết nối ngoài. Bridge kiểm sender/main frame/URL chính xác, cấm payload lạ. Product code không có API mở URL, chạy script hoặc đọc secret tùy ý từ UI.

Namespace mặc định `%APPDATA%/csd-desktop`, sessionData `browser/`, logs/crashDumps riêng. Smoke override chỉ nhận root temp CSD hợp lệ sau realpath; không dùng đường dẫn profile HotMatch. Chưa có session Facebook, parser/adapter live, queue, migrations hoặc DB repositories. SQLite tích hợp là quyết định cho P05, không tạo DB giả để báo pipeline đã hoàn thiện.

## Kiểm tra đã chạy

| Kiểm tra | Kết quả và phạm vi |
| --- | --- |
| `npm run check` | TypeScript main/preload, renderer DOM không Node và tests đều đạt; 44 ca P00 đạt bằng Ajv cài trong CSD, không cần validator-root HotMatch |
| `npm test` | 8/8 unit tests đạt: config/source requirements, fixture không tăng LIVE count, reject fixture sai/invalid config, bảo vệ khỏi mutation, namespace/IPC và từ chối smoke root tùy ý; 44 ca P00 đạt |
| `npm run test:smoke -- --output ... --screenshot ...` | Electron main/UI thực chạy hai lần trên cùng temp root; bridge/nút kiểm offline thành công, renderer không có `require` hoặc `process`, chỉ lộ hai hàm allowlist; một external request chủ đích bị chặn; 0 cửa sổ/webContents sau đóng, process exit 0, rendererErrors rỗng |
| `npm run pack:dir` | Builder tạo `release/win-unpacked` x64 thành công, có `CSD.exe` và ASAR; chưa chạy executable đóng gói |
| Kiểm nội dung ASAR | Có main/preload/renderer/resources/package; không có `.brain`, `tests`, `src`, `scripts`, profiles/secrets hoặc DB; package identity đúng CSD |
| Rà soát UI | Đã mở ảnh smoke để kiểm chữ tiếng Việt, campaign keywords, mục tiêu, cả ba nguồn và kết quả offline; không có bài/cookie/account thật |

Smoke dùng sentinel giả ở thư mục ứng dụng không liên quan, xác nhận giữ nguyên qua cả hai lần chạy. Không đọc dữ liệu HotMatch thực để tạo bằng chứng; isolation được kiểm bằng path policy, runtime dùng temp CSD, binary/entrypoint của CSD và sentinel tổng hợp. Báo cáo không khẳng định đã audit mọi I/O nội bộ của OS/Chromium.

Smoke đầu tiên phát hiện chụp cửa sổ ẩn báo UnknownVizError. Harness đã được sửa để chờ initial paint, dùng capture stayHidden/stayAwake và tắt background throttling riêng cho smoke; sau sửa cả hai lượt đều đạt. Không bật hiển thị cửa sổ để né lỗi hoặc thay kết quả thất bại bằng số liệu Facebook. Report kết quả cuối: [smoke JSON](p01-bootstrap-smoke-2026-10-27.json), [package audit](p01-package-audit-2026-10-27.json). Cấu hình sandbox ghi trong report là cấu hình dùng tạo window; việc renderer không có Node/bridge hoạt động được đo trực tiếp, không phải kiểm sâu mọi thuộc tính bảo mật của Electron.

![CSD kiểm tra offline](p01-bootstrap-offline.png)

## Cách tái hiện

Tại `C:/OwnProject/crawl-socials`, cài theo lock bằng `npm ci`, sau đó `npm start`. Không cần tài khoản mạng xã hội. Các lệnh kiểm và ghi report được mô tả đầy đủ trong README. Nếu chưa có binary Electron, bước cài/launch đầu có thể tải binary; phép smoke bản thân không gọi Facebook.

Version source/config/report của đợt này ghi bằng [SHA-256 manifest](p01-bootstrap-artifact-manifest-2026-10-27.json) do CSD chưa có Git. Manifest cũ P00 là bằng chứng lịch sử, không cập nhật hash của nó để khớp master plan/source đã thay đổi.

## Giới hạn và bước tiếp

Không có live observations, nên fixture count vẫn 0 valid unique và G00/G01/G02 không PASS từ đợt này. Package audit chỉ chứng minh build dev/nội dung ASAR; chưa kiểm portable installer, Windows sạch, signing, update hoặc restore. Startup elapsed trong smoke không đo throughput thu bài.

P00.04 có thể chuẩn bị protocol/ngân sách/stop conditions theo route đã ghi. P01.02, P02.01 và P03.01 đã đủ dependency để tiếp tục offline ở phạm vi tương ứng; không triển khai trong đợt hai task này. P02.02 vẫn chờ gate G00. Tránh xây sâu UI/scale trước khi có bằng chứng nguồn theo ADR-008.
