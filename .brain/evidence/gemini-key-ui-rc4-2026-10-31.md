# Gemini key UI / RC4 — 31/10/2026

Theo yêu cầu người dùng, thêm nhập/lưu/xóa Gemini API Key ngay trong Cấu hình thu thập (chế độ tìm cuộc thảo luận). Input password, không autofill key đã lưu, xóa nội dung ô nhập ngay khi gửi lưu. Status chỉ trả SAVED/ENVIRONMENT/NONE và lỗi đọc; không trả secret ra renderer.

Main dùng encrypted secret store/safeStorage Windows, namespace riêng gemini:api-key. Key không đi vào config, preset, progress hoặc workbook/export JSON. Đã lưu được ưu tiên hơn môi trường; không có key đã lưu thì tiếp tục tương thích cấu hình môi trường. Không kiểm tra API quota khi lưu. Nếu file mã hóa từ máy khác không đọc được, app vẫn mở và cho lưu lại key tại máy mới.

Gateway cho cả draft planner, direct start, retained re-filter và Resume được main truyền credential provider. Main chặn thay key khi run/watch/assessment/prepare hoạt động, có mutex cho key mutations và model-start commands. Lỗi lưu/xóa chỉ báo safe code, giữ credential trước đó nếu persistence thất bại.

Validation: check/build PASS; 889/889 tests PASS (0 fail/skip). Tests mới gồm encrypted persistence/restart, ưu tiên/fallback, status không lộ key, malformed IPC payload, lỗi ghi/xóa giữ key cũ, thay key không đọc được và UI clearing/locking. Smoke Electron/Windows thật ở %TEMP%/csd-rc4-credential-smoke/: mã hóa không chứa plaintext, restart đọc lại, gateway nhận đúng key, xóa key riêng; fake fetch, 0 real network calls. Không chạm key thật hoặc profile của người dùng.

Portable 0.3.0-rc.4 build thành công. ASAR version đúng, 5 file main/preload/UI/settings khớp dist, không có root data/browser/secrets/.env. Bản bàn giao Downloads/CSD-Portable-0.3.0-rc.4.exe và hướng dẫn cùng version. Native UI RC4 chưa mở trên profile đang dùng bản RC3; khi sử dụng đóng bản cũ rồi mở file mới. Công việc thuật toán/crawl vẫn tạm dừng.
