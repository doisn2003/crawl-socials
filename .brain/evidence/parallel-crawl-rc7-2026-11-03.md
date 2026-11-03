# RC7 — Nhiều cửa sổ Electron và băng thông Gemini

Ngày bàn giao: 03/11/2026 (Asia/Bangkok). Bản kết hợp để thử: **CSD 0.3.0-rc.7** trên `codex/csd-next`.

## Thay đổi

- Tìm các từ khóa của campaign trên các cửa sổ riêng; mặc định **2 cửa sổ/mạng**, tối đa 4 collector khi chọn Facebook và Threads. Phân bổ truy vấn theo vòng tròn, giữ ổn định qua Stop/Resume.
- Mỗi cửa sổ có observer, frontier và checkpoint riêng; cùng hồ sơ dùng chung Session. Một đầu ghi tổng khử trùng bài thô, còn bằng chứng cập nhật vẫn được đưa vào bộ lọc.
- Phân loại song song 4 worker, mỗi batch tối đa 8 hội thoại. Scheduler chung cho planner, hỏi ngược và các bước đánh giá, tối đa 8 yêu cầu Gemini đồng thời ở chế độ Cân bằng.
- UI thêm Nhẹ / Cân bằng Tier 1 / Nhanh Tier 1, tiến độ từng cửa sổ và số tác vụ AI đang chạy/chờ. Nhanh: tối đa 3 cửa sổ/mạng, 8 worker phân loại, 16 yêu cầu AI đồng thời.
- Giữ nguyên toàn bộ source cốt lõi của `semantic-keywords.mjs`, `semantic-campaign.ts`, `goal-filter.ts`, `goal-classifier.ts`, `classification-service.ts` so với tag RC6.
- Giới hạn từ bảng người dùng: 4.000 RPM, 4 triệu input TPM, 150.000 RPD. CSD dùng 80% cho điều phối và giữ nguyên ngân sách USD từng lượt. Bộ đếm cục bộ dùng ngày Pacific, lưu qua restart; usage của ứng dụng khác cùng project vẫn do Google quyết định.
- 429/503 làm cả hàng đợi cùng chờ, giảm concurrency và tôn trọng thời gian retry của provider. Hủy được hàng đợi khi Stop. Gia hạn lease công việc đang sống mỗi 30 giây để cooldown dài không gây worker nhận trùng.
- Giữ giới hạn tài khoản, kiểm tra bằng chứng, comments, ngân sách/lưu trữ và các trạng thái thiếu dữ liệu. Không chuyển lỗi API thành nhãn không phù hợp.

Thiết kế và đánh đổi: [ADR-024](../decisions/ADR-024-parallel-discovery-and-model-throughput.md).

## Kết quả kiểm chứng

| Kiểm tra | Kết quả | Evidence |
|---|---|---|
| Nhánh crawl độc lập, sau triển khai chính | 902/902 unit tests; typecheck đạt | `artifacts/parallel-crawl-20261103/unit-independent-902.log` |
| Gia hạn lease và tiến độ AI trên nhánh crawl | 54/54 kiểm thử liên quan đạt; typecheck đạt | `artifacts/parallel-crawl-20261103/lease-regression-independent.log` |
| Bản kết hợp AI + crawl RC7 cuối | **965/965 unit tests**, typecheck đạt | `artifacts/parallel-crawl-20261103/unit-rc7.log` |
| Electron thật, localhost, hồ sơ tạm | Đạt 7 nhóm kiểm tra: độc lập cửa sổ, chia sẻ/cách ly Session, ownership, đóng riêng, mở lại, shutdown | `artifacts/parallel-crawl-20261103/windows-final/result.json` |
| Giao diện kết hợp | Hỏi ngược, hai nhóm kết quả, bằng chứng, lưu mức tốc độ và tiến độ từng cửa sổ đều đạt; không có lỗi renderer | `artifacts/parallel-crawl-20261103/ui-final/ui-smoke.json` |
| Gemini thật, dữ liệu tổng hợp | 8/8 đáp ứng schema và đúng ID/chủ đề; không retry/cache hit | `artifacts/parallel-crawl-20261103/gemini-api-probe.json` |

Phép đo Gemini: 4 yêu cầu tuần tự **3.359 ms**, 4 yêu cầu đồng thời **1.165 ms** (nhanh khoảng **2,88 lần** trong mẫu nhỏ này). Hai chủ đề tổng hợp: phòng cho thuê và quán cafe. Đây là kiểm chứng transport, **không phải** benchmark crawler thật hoặc đánh giá precision/recall của bộ lọc. Chi phí token ước tính theo bảng giá đã pin của CSD: **$0,0004085**, không phải hóa đơn.

Các ca kiểm thử mới bao gồm: không vượt concurrency; RPM/TPM độc lập; hủy yêu cầu đang chờ; quota qua restart và ngày Pacific; Retry-After trên 60 giây; ngân sách khi nhiều yêu cầu cùng đặt chỗ; cache; dữ liệu trùng giữa cửa sổ; giữ mọi quan sát; rào cản cùng tài khoản; đợi sibling flush; Stop/Resume không đổi nhóm từ khóa; 40 hội thoại xử lý song song không sót/trùng; gia hạn đúng job đang sở hữu.

Không chạy một chiến dịch Facebook/Threads thật dài trong lượt phát triển này. Các bộ AppData cũ không được dùng làm nơi ghi kết quả thử nghiệm. Các lỗi ngữ nghĩa/ranking đã ghi nhận ở RC6 vẫn là công việc của nhánh AI; tăng concurrency không giải quyết chúng.

## Cách thử

1. Đóng bản CSD cũ rồi mở `release/CSD-Portable-0.3.0-rc.7.exe`.
2. Giữ **Cân bằng Tier 1** để bắt đầu. Chọn nguồn đã đăng nhập và tạo **lượt thu mới** từ prompt.
3. Xem các từ khóa khác nhau ở từng cửa sổ và tiến độ ngay trong CSD. Stop lưu dữ liệu; Tiếp tục giữ nhóm/checkpoint của lượt đó.
4. Run cũ chưa có cấu hình nhiều cửa sổ vẫn Resume theo cách cũ. Đổi mức tốc độ trước lượt mới để đổi số cửa sổ. Nhanh chỉ nên dùng sau khi kiểm tra máy và nguồn chịu được tải.

## Git và gói bàn giao

- `codex/ai-foundation` vẫn giữ thuật toán/phiên bản RC6; chỉ nhận bản vá build chung `77b3146` để theo dõi đủ mã nguồn SecretStore. Không thêm thuật toán crawl vào nhánh AI.
- `codex/crawl-throughput` chứa các commit triển khai và sửa vận hành, từ nền RC4 độc lập. Tag đầu: `csd-crawl-candidate-v1-20261103`; branch tiếp tục có các sửa tiến độ và gia hạn lease.
- `codex/csd-next` nhận các merge có lịch sử, bản kết hợp RC7; tag bàn giao `csd-next-rc7-20261103`.
- Chưa merge vào `codex/csd-production`, chưa push remote. Mốc RC6 và binary RC6 được giữ để đối chiếu.
- Đã đối chiếu đủ **86 file runtime** trong ASAR với bản build; không đóng gói fixture phát triển. EXE RC7 SHA-256: `3ddd2236915f9776489c4fa4886b5553f97d86cacdb9bce70e55f0eebc9b7ade`. Binary RC6 giữ nguyên hash cũ.
- Build log và SHA-256/đối chiếu các file trong ASAR: `artifacts/parallel-crawl-20261103/build-portable.log`, `portable-verification.json`.

Lưu ý khả năng tái dựng: `.gitignore` cũ bỏ sót hai file **source** dưới `src/infrastructure/secrets/`. Commit `77b3146` đưa lại đúng hai file từ worktree đang chạy; không chứa key/cookie. Đây là sửa thiếu sót của checkpoint cũ, giúp nhánh độc lập tự build được.
