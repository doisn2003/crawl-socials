# Giao P03.03 — planner giới hạn theo capability và ngân sách

2026-10-27. Owner `/root/csd_adapter`; dependency P03.02 vừa được lead nghiệm thu, P02.01 đã DONE. Đây là module ứng dụng thuần chuẩn bị query jobs, không scheduler hoặc phép thử nguồn.

Đọc master P03.03, query-expansion API, adapter-capabilities/adapter-contracts/SocialAdapter và campaign contract. Không gọi mạng, không đọc session/profile hoặc tác động phiên CSD Facebook. Giữ source priority: phần này chỉ một lát cắt nhỏ có đầu ra chạy được với fake adapter, không mở framework job runner.

## Phạm vi

- Nhận intent/proposals, capability snapshot, context và ngân sách rõ; trả kế hoạch và quyết định bị từ chối/trì hoãn có lý do. Originals được ưu tiên trước expansions, không đổi ý nghĩa campaign hoặc dùng query thay filter.
- Chỉ tạo request/filter được contract và capability cho phép. Unsupported language/date/location phải có quyết định rõ, không âm thầm bỏ để làm query có vẻ hợp lệ. `FilterName` hiện không có geography; giữ ràng buộc hậu kiểm hoặc block/defer theo policy có khai báo, không giả adapter biết lọc vị trí. Không sửa shared contract để che capability thiếu.
- Ảnh Facebook chỉ chứng minh control có mặt, không nâng verification thành LIVE_VERIFIED/SUPPORTED. Đừng thêm Facebook adapter capability giả. Có thể dùng fake adapter để chứng minh wiring của plan, nhưng không coi fixture/source_permissionUNKNOWN là đủ điều kiện chạy LIVE.
- Giới hạn số jobs, tổng candidate allocation và từng job; không nhân budget khi nhân query/source/continuation. Khai báo rõ đơn vị chi phí/requests/actions nếu có estimate, UNKNOWN không thành0. Campaign budget null không là vô hạn hoặc số đã được user duyệt. Không suy một request=1post, một job=1HTTP request.
- Kế hoạch deterministic/immutable; lưu version, effective config, capability binding và query lineage đủ để tái tạo từ cùng input. Query IDs của P03.02 chỉ local trong result; không va chạm giữa source/job hoặc mất parent provenance khi không chọn hết query. Không tự tạo Start/deadline/run thực từ một plan offline.
- Không tự quote/encode exact phrase theo cú pháp Facebook chưa quan sát; truyền đúng contract hoặc reject capability chưa đủ. Không seed post-list, đổi campaign source mix, coi source-specific job là proof đã có đủ3nguồn.

## Ownership

`src/application/query-planner.ts` và helper mới nếu thật cần; `tests/query-planner.test.ts`; evidence/handoff riêng. Đọc nhưng không sửa query-expansion/campaign-intent/adapter contracts/registry/fake adapter/shared/package/tsconfig/master/.brain README. Nếu interface thật sự thiếu, báo lead kèm một phương án hẹp trước khi sửa file ngoài phạm vi.

Compile riêng `.test-build-planner`; không dist/.test-build hoặc output expansion đang được lead nghiệm thu. Kiểm phù hợp: unsupported capability/filter, thiếu budget, allocation không vượt cap khi nhiều query/source, originals priority, determinism/lineage, permission/mode không được nâng từ fixture và một luồng gọi fake adapter đúng contract. Không cần Electron/full suite khi không đổi runtime.

Không thực hiện retry/scheduler/lease/persistence/UI/SQLite/crawler, không chi dịch vụ hoặc commit/push/publish. Hoàn tất module/tests rồi bàn giao hashes và lệnh tái hiện, không tự nối task khác. Lead giữ task/gate/runtime.
