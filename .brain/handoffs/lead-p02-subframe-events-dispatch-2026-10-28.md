# P02.02 — Sửa hủy nhầm do history của frame con

28/10/2026, Asia/Bangkok. Theo bằng chứng LIVE v17 tại `../evidence/p02-live-route-events-v17-2026-10-28.json`, tiếp tục thử nguồn nhỏ theo ADR-010/014/015; không mở benchmark.

## Phát hiện đã kiểm chứng

Anchor mới đọc được một mẫu, một context hint trong 220 ms, 1.883 work steps, không cap/barrier. Phép mở lại đi qua START và COMMIT của main frame đúng URL, owner giữ nguyên, document generation +1. Sau đó `DID_NAVIGATE_IN_PAGE` của **SUBFRAME** làm verifier hủy với `OWNER_CHANGED / SUBFRAME_HISTORY` trong NAVIGATING; không bắt đầu fresh read. URL hiện hành của main frame vẫn EXACT. Đây là nguyên nhân trực tiếp của lần v17; không suy ngược sự kiện v16 chưa ghi.

## Giao CSD agent

- Ownership giữ source/controller/menu/native fixture/owner tests và build riêng như lượt trước. Không sửa reviewer tests, shared dist, runtime, profile, `.env`, master/README.
- Sửa cả reader watchLoss và verifier: history event của frame con không tự đồng nghĩa mất owned main document. Cho no-op có ghi trace khi owner/view còn khớp, URL main hiện hành bằng chính xác URL kỳ vọng và document generation đúng giai đoạn. Không dùng URL của frame con như URL bài viết. Không mở allowlist network hoặc đọc nội dung frame con.
- Trace vẫn phân biệt MAIN/SUBFRAME, tối đa 16 entries, không raw URL/ID/body. Các thay đổi main URL, owner/generation, main full navigation/redirect, Stop, timeout và barrier giữ nguyên.
- Fixed script chỉ đọc DOM document chính; xác minh điều này và giữ kiểm tra auth/challenge/deny. Không nới logic public/body/identity, không bỏ barrier vì frame con được no-op.
- Native fixture phải phát history event thật từ iframe trong lúc loading và reading, qua cả watcher của menu và verifier. Negative: main URL đổi, owner/generation đổi, main history khác URL, Stop; vẫn dừng. Không chỉ đổi kỳ vọng unit collaborator.
- Không thêm delay, retry, tăng caps hoặc API/framework mới. Freeze source/build/evidence, bàn giao đủ để lead chạy ngay.

## Giao csd_adapter song song

Review đường đọc main document và viết test độc lập cho frame con vô hại versus main context đổi. Có thể chuẩn bị baseline trong output riêng trước freeze, nhưng không mở rộng suite ngoài lỗi thực tế này. Sau freeze, kiểm native iframe qua hai watcher, trace/redaction, Stop/late-result; báo blocker hoặc ready. Không tác động tài khoản/runtime.

## Lead và bước kế tiếp

Lead giữ runtime 20608, main 1249128, source 5178426. Đã dùng 2/3 starts, không lặp build v17 hoặc dùng start còn lại nếu không có giả thuyết mới. Giữ profile; sau nghiệm thu build mới tạo anchor mới và đối chiếu một lần. Nếu REOPEN_MATCH, chuyển sang vài public candidates/continuation theo bằng chứng, không tiếp tục xây trace vô tận. Permission UNKNOWN, benchmark OFF, valid0 và gates giữ nguyên.
