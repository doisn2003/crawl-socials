# ADR-020 — Thu Threads, mỗi cửa sổ một mạng xã hội

Ngày 2026-10-29, Asia/Bangkok. Yêu cầu trực tiếp của user trong chat này mở P11.02 trước G04; không khởi động lại các worker/automation cũ.

- Mục tiêu phiên: thu tối thiểu 1.000 post Threads không trùng từ sáu keyword user cung cấp. User xác nhận **chưa kiểm tra nội dung**; không áp rubric relevance hoặc coi kết quả search là đúng chủ đề đã nghiệm thu.
- Giữ Electron. Mỗi profile có platform Facebook/Threads, một cửa sổ và partition riêng. Profile cũ thiếu platform giữ Facebook và nguyên ID. URL policy chọn theo platform; không dùng cookie Facebook cho Threads.
- Collector tự tìm Top/Recent, cuộn và đọc response search do browser tạo. Chỉ lấy post trong `searchResults.edges[].node.thread.thread_items[].post`; bỏ reply, post không có text hoặc identity không đủ. Không replay GraphQL/cursor, không dùng computer-use để mở từng bài.
- `.env` đã được user cho phép dùng. Đọc đúng phần Thread account khi có nhiều khóa PASSWORD; hỗ trợ tên THREADS_USERNAME/THREADS_PASSWORD. Phiên lưu qua Chromium và encrypted session-cookie snapshot có sẵn.
- Dữ liệu ngoài Git: JSONL append-only và JSON export, batch provenance/hash, checkpoint, Stop/resume, deadline và trần cuộn. Dedup theo ID và shortcode qua query/restart. Không lưu raw responses, headers, tokens hoặc credentials trong repo.
- Lượt đầu thành công 58 post. Lượt tiếp gặp không phân trang khi cửa sổ bị che; foreground lại làm tải tiếp. Collector dùng `backgroundThrottling:false` từ lúc tạo view và switch process `disable-backgrounding-occluded-windows`. Bản sửa phải được kiểm bằng yield LIVE, không chỉ fixture. Cơ chế Chromium: [switch chính thức](https://chromium.googlesource.com/chromium/src/+/52a56e36e6a8acef317bafa7bac342f1fd62343b/content/public/common/content_switches.cc), [Google Chrome launcher](https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md).

Đây là nghiệm thu khả năng lấy dữ liệu Threads theo phạm vi mới, không thay gate chất lượng của Facebook và không tuyên bố toàn dự án hoàn tất. Kết quả cụ thể sẽ ghi tại `evidence/threads-collector-result-2026-10-29.md`.
