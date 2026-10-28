# P02 DOM diagnostic — review của lead

Ngày 2026-10-27, Asia/Bangkok. Theo ADR-010/master v1.21. **Đang review, chưa nghiệm thu, chưa nạp build hoặc đọc DOM thật.**

## Snapshot đầu

Đã đọc controller, native menu/target resolver, integration index.ts, fixed script, fixture và build/smoke scripts/tests. CSD agent đang triển khai; subagent được đánh thức khi source đã xuất hiện để review script/schema độc lập. Không coi báo thiết kế hoặc file đã tồn tại là DONE.

Các điểm đã gửi owner sửa trước handoff:

1. Route guard nhận toàn bộ `/search/*`, tests chấp nhận `/search/top/`. Dispatch chỉ cho Posts; `/search/people/` hoặc `/search/groups/` không được execute chỉ vì cùng query. Thu hẹp `/search/posts/` ở cả main và script khi chưa có bằng chứng selected Posts tab cho route khác. Subagent cũng xác nhận finding này.
2. Sau native read chỉ kiểm deadline 5 phút, chưa đối chiếu timeout đọc 4 giây. Main timer có thể bị trễ; cần kiểm elapsed sau await và loại kết quả vượt readMs, có regression bằng injected clocks.
3. Suspend hiện ngắt controller fixture nhưng chưa dừng DOM diagnostic. Nối lifecycle cho cả diagnostic để không nhận kết quả xuyên suspend.
4. Không nhận flag diagnostic LIVE kết hợp smoke khác; dữ liệu synthetic phải có mode FIXTURE, không gán provenance LIVE từ tổ hợp flag không hợp lệ.

Những gì thấy phù hợp ở snapshot: output chỉ enum/count/bucket có whitelist; script cố định trong isolated world, không arbitrary IPC; native pending latch giữ capacity sau Stop/timeout; output ngoài repo với mode/decision/hash và valid count0. Đây là nhận xét code, chưa bằng chứng DOM Facebook thật.

Owner sửa/test trong output riêng; lead sẽ kiểm final hashes, chạy checks phù hợp và native fixture trước khi nạp bản mới. Phiên CSD Facebook hiện tại giữ nguyên. Gate chưa thay đổi.

## Nghiệm thu implementation đầu và kiểm phiên thật

Đã đóng bốn finding ở snapshot owner bàn giao: exact Posts route, elapsed readMs guard, suspend stop, mode-flag separation. Lead compile `.test-build-lead-dom`; 15/15 tests (10 owner + 5 independent reviewer) PASS. Native fixture riêng [3/3 PASS](lead-p02-dom-diagnostic-fixture-2026-10-27.json). Đã đọc handoff/validation, đối chiếu 11/11 owned hashes và 121/121 shared build entries. Script/controller hashes khớp report runtime. Nhận **implementation diagnostic đầu**, không nhận P02.02/G00.

Nạp shared build sau `npm run build`, đóng root10344 bằng lifecycle app, không kill. Root mới26864; ban đầu window bị ẩn theo startup flag, gọi second-instance đã show đúng app; không phải lỗi login. Main window266872, source4000438. Profile CSD Facebook được mở lại; Facebook vào home mà không nhập credentials, xác nhận persistence trong lần restart này. Không động profile khác.

Lead thao tác UI tìm `cafe Hà Nội`. Quan sát trực tiếp route `/search/top/`, sidebar `Tất cả`, filters Bài viết mới đây/Bài viết bạn đã xem/Ngày đăng/Bài viết của/Vị trí được gắn thẻ; màn hình có Page card và post card. Đây là mixed results thật, không suy người dùng chọn nhầm Posts ở Apify hoặc không có bài. Không lưu screenshot/nội dung/tên/account/query-token vào repo.

Native menu run lúc 20:44:03 (Asia/Bangkok), `dom-5f417a6c-fcf6-4e98-9ab8-eb259241c287`: `UNSUPPORTED_ROUTE`, actions0, result=null, capture_mode LIVE, diagnostic_only, benchmark_eligible=false, valid0. Report ngoài repo: `%APPDATA%/csd-desktop/dom-diagnostics/<run_id>/result.json`. Chưa gọi script, nên **chưa có DOM schema thật** và chưa thu candidate. Guard hoạt động đúng dispatch đầu; UI thật đòi hỗ trợ route khác có giới hạn.

SHA-256 đúng bytes report: `36a453587b33c99aa79716cde15531d9b4b73adb29dfaa611cf54ae737fdaf57`. Report pin script string `7f6d02b1b5272ecae1b1c4ec0cddf2b956b85a9251da5aabf54d2e70451cccfb`, compiled controller `23c31f79af9bcf4b87f2c35e414d65e6d8851b96dbdfca6391008dcc8327ef2c`.

ADR-010 đã bổ sung exact `/search/top/` + query cố định cho metadata diagnostic, tên `SEARCH_TOP_MIXED`; giữ other search kinds denied. Main nhận task sửa hẹp và thêm regression; reviewer kiểm phân loại mixed/scope độc lập. Không đòi selected Posts tab giả định cho route này, không coi card là post/public chỉ từ route.
