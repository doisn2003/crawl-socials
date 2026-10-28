# P02.02 — Quan sát DOM thật đầu tiên

Ngày 2026-10-27, Asia/Bangkok. Lead thực hiện sau nghiệm thu mixed diagnostic; không phải benchmark.

## Build và runtime

- Đọc code thay đổi main/script/fixture; lead compile output `.test-build-lead-dom-mixed`, **17/17 tests PASS** (11 owner + 6 reviewer). Native fixture lead **3/3 PASS**: [summary](lead-p02-dom-mixed-fixture-2026-10-27.json). Reviewer đã sửa return type fake sink của test, không lỗi production ở lần compile lại.
- Manifest mixed **10/10 owned hashes khớp**; shared build **121/121 entries khớp**. Script string hash `4bad8f31b35644ab6faa1db8be44de335d8f29faa024cfeed261cd8a9c3c9965`; controller compiled hash `947a160ed8cd50b690cda4183c314c40e8480c68e1bd543adb01f6d096b6657a`.
- Root26864 đóng qua app lifecycle, root mới21432, main3084806, source3278844. Profile CSD Facebook mở lại vào tài khoản; không nhập credentials và không thao tác prompt nhớ mật khẩu. Giữ profile khác nguyên trạng.
- Lead tìm `cafe Hà Nội` bằng UI; trang kết quả `/search/top/` với filters, Page card và post/ad. Sau khi trang hiển thị mới chọn native menu Đọc một lần. Source hiện giữ nguyên trên trang này.

## Kết quả đúng phạm vi

Run `dom-30acf846-4977-4c75-9c80-df06b7d0734e`, 20:50:53.344 →20:50:53.367 (23ms theo wall timestamps): LIVE diagnostic, 1 action, queryMatched=true, route SEARCH_TOP_MIXED, **NO_MATCH**.

| Trường | Giá trị |
| --- | --- |
| visited / cap | 2500 / 2500 |
| elementCount / textNodes | 2094 / 221 |
| nodeLimit / timeLimit | true / false |
| articleRoots / feedRoots / mainRoots / pageletMarkers | 0 / 0 / 0 / 0 |
| link families post / group / facebookOther | 2 / 5 / 29 |
| page / profile / external / unsupported link families | 0 / 0 / 0 / 0 |
| structural samples | 0 |
| candidates / verified valid | 0 / 0 |

Report ở `%APPDATA%/csd-desktop/dom-diagnostics/<run_id>/result.json`, SHA-256 đúng bytes `56a14f3e12a68deb2146ba8cc76635e939c9483c1c761ba3e1941597a98dc0e0`. Không copy HTML, nội dung, danh tính, URL nguồn/query-token hoặc screenshot vào repo. Capture chỉ enums/counts/buckets; platform permission UNKNOWN, benchmark_eligible=false.

Đây là lần đầu script thật chạy thành công qua native owned view và ghi report. **NO_MATCH chỉ nói heuristic article không khớp trong phần DOM đã duyệt**, đồng thời phần quét bị cắt vì node cap. Không đồng nghĩa Facebook trả 0 bài, không chứng minh nguồn cạn, không đủ kết luận nguyên nhân là thiếu role article hay nằm ngoài cap. Hai link dạng post chưa phải hai bài riêng biệt/hợp lệ/công khai.

## Bước sửa dựa trên bằng chứng

Hiện script bắt đầu từ body và chờ article/role=article. Cần kiểm chọn vùng main của kết quả (AX UI đã hiện main Kết quả tìm kiếm) và cấu trúc ancestor của link dạng post trong giới hạn; không tăng cap vô hạn hoặc suy mọi article là post. [Dispatch tiếp](../handoffs/lead-p02-result-region-dispatch-2026-10-27.md) giữ metadata-only để tìm đúng ranh giới card/publicity trước extraction <=5 public candidates. Gate chưa đổi.
