# ADR-002 — Route Facebook dự kiến và phạm vi nguồn công khai

Ngày: 2026-10-27, Asia/Bangkok. Đầu vào: [contract 1.0.0](../specs/product_contract.md), [ma trận nguồn](../specs/source_access_matrix.md) và trả lời người dùng trong phiên P00.02. Trạng thái task/gate theo [master plan](../master_plan.md).

Thống nhất với [ADR-008](ADR-008-direction-and-source-validation.md): giữ công việc Electron hiện tại, không yêu cầu chọn lại kiến trúc/Meta app và không tự chuyển sang dịch vụ trả phí. Matrix tách bốn trục phiên/capability/quyền/product fit; vendor chỉ là phương án đối chiếu có điều kiện, chưa được chọn hoặc thử.

## Bối cảnh

Campaign quán cà phê cần bài công khai từ Page, Group và personal timeline, mỗi loại phải có kết quả, tổng ít nhất 1.000 bài trong ≤24h. Người dùng có tài khoản cá nhân thường; chưa có Meta app/API grant hoặc chấp thuận riêng cho automation. Người dùng chọn nghiên cứu browser Electron và yêu cầu giữ đúng trạng thái chưa xác minh.

Không có route AVAILABLE trong CSD. P00.02 là đánh giá route, không phải P02.02 live probe. Docs API hiện đọc lại bị 429; ranh giới API từ nghiên cứu cũ không được nâng thành capability đã kiểm thử ở version mới. [Evidence nguồn](../evidence/p00-source-access-2026-10-27.json) giữ cả các lần đọc không thành công.

## Quyết định

Chọn `FB_BROWSER_PUBLIC_SEARCH` làm **route nghiên cứu ưu tiên**, trạng thái **UNKNOWN**. Chưa tích hợp adapter thật, chưa đăng nhập, chưa dùng session/tài khoản để thu bài và chưa tuyên bố có quyền thu tự động. Khi điều kiện nguồn và protocol phù hợp, thử keyword quán cà phê qua UI Facebook trong partition CSD riêng; không thiết kế dựa vào endpoint nội bộ chưa xác minh hoặc phát lại request vô hạn.

Giữ scope `PUBLIC_DISCOVERY` của contract 1.0.0. Ba loại nguồn công khai giữ nguyên; parser/source validator phải dựa trên bối cảnh xuất bản. Không dùng Page-only để PASS G02, không đưa nhóm riêng tư vào source enum MVP. Nhánh JOINED_GROUPS/nhiều account của R08 vẫn thuộc P11.04–P11.08, cần version/benchmark riêng.

P01.01 bootstrap **offline** theo ADR-001: dữ liệu cấu hình/fixture không có secret, UI/bridge tối thiểu, network ngoài bị chặn trong bootstrap. Offline checks không được tăng valid LIVE count hoặc chứng minh route Facebook hoạt động.

## Phương án cân nhắc

| Phương án | Kết luận |
| --- | --- |
| Browser bằng tài khoản thường | Hướng nghiên cứu người dùng chọn; khả năng dữ liệu và quyền thu tự động đều cần xác minh; không tự coi đăng nhập là đủ |
| API Page được quản lý/PPCA | Chưa có grant; chỉ xử lý Page đúng permission, không tự giải quyết Group/personal |
| Legacy Groups API | Loại khỏi thiết kế theo nền nghiên cứu; không xây dựa trên API cũ bị gỡ; tài liệu hiện đọc lại lỗi 429 được ghi rõ |
| Meta Content Library | Chưa có eligibility/grant nghiên cứu; không mặc định phù hợp mục đích và môi trường xuất dữ liệu của CSD |
| Web search | Có thể bổ sung discovery sau khi chọn provider; index/snippet không chứng minh đủ nguồn, quyền hoặc post validity |
| Mượn session HotMatch / thu trước khi đủ điều kiện | Không thuộc lựa chọn triển khai; namespace CSD và dữ liệu phiên phải độc lập |

## Hệ quả và điều kiện xem lại

P00.02 ghi được hiện trạng và bước thử cụ thể, nhưng G00 vẫn chưa đủ đầu vào để PASS. P00.04 có thể chuẩn bị protocol; không mở P02.02 cho tới G00 phù hợp. P01.01 và contract/fake/offline work được tiến hành theo dependency mà không phải chờ đăng nhập Facebook.

Xem lại khi có quyền/điều kiện nguồn được xác minh, docs/version API đọc được, Page được quản lý/grant cụ thể xuất hiện, browser live probe cho thấy thiếu một loại nguồn hoặc vận hành không phù hợp. P02.04 bổ sung quyết định route đã kiểm chứng và evidence thực, không sửa bản ghi này để làm như quyền/capability đã có từ trước.
