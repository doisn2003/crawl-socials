# Kiểm chứng R01 và triển khai P01.02 — 2026-10-27

Múi giờ Asia/Bangkok. Theo [lead dispatch](../handoffs/lead-dispatch-2026-10-27.md) và [review độc lập](lead-review-2026-10-27.md). Agent triển khai không cập nhật master plan/`.brain/README.md` hoặc kết luận gate; kết quả này bàn giao để tech lead nghiệm thu.

## R01 — Historical range

`src/infrastructure/config/campaign-validator.ts` giữ kiểm JSON Schema và bổ sung semantic validation: RANGE bắt buộc `Date.parse(from_utc) < Date.parse(to_utc)`. Khoảng `[from, to)` rỗng hoặc đảo chiều trả lỗi cố định `CAMPAIGN_RANGE_INVALID`, không echo input. Không sửa campaign coffee hoặc schema/contract version 1.0.0. Regression trong `tests/bootstrap.test.ts` kiểm đảo chiều, bằng nhau và khoảng hợp lệ dài 1ms.

## Browser host và profile

- Profile ID `csd-<UUIDv4>` ổn định, metadata tại `<userData>/data/browser-profiles.json`, ghi thay thế nguyên tử. Không có cookie/password/token trong metadata. Label kiểm NFC/trim/độ dài/control chars; file hỏng không tự ghi đè bằng defaults.
- Partition riêng `persist:csd-v1-<profile_id>`, mỗi profile một BaseWindow/WebContentsView tối thiểu. Tạo/mở/đóng có serialization theo profile, reload/reopen không đổi partition. Không xây account pool, scheduler hoặc tab UI đầy đủ.
- Binding luôn `UNVERIFIED`, `accountId = null`, revision 0; chưa suy danh tính Facebook từ label/cookie hoặc fixture. Luồng xác minh binding trước jobs thuộc tích hợp sau này; không có API tự nhận account thật trong P01.02.
- Website view không có preload CSD, Node integration tắt, sandbox/context isolation bật. Permission/check/device/download/popup mặc định deny. Navigation/frame-navigation/redirect và resource requests dùng policy riêng: default chỉ about:blank; HTTPS Facebook/CDN cho manual-login mode; fixture chỉ đúng loopback origin. File/data/javascript URLs, URL có credentials, host lookalike và port ngoài policy bị từ chối.
- UI bridge chỉ có preview/check và profile list/create/open/close/openLogin với payload chính xác `label` hoặc `profileId`. Không có arbitrary URL, executeJavaScript, fetch hay cookie API. Website không được gọi bridge của UI.
- UI có form tạo phiên, mở/đóng phiên và nút login mặc định disabled. `npm start -- --allow-manual-facebook-login` chỉ bật affordance mở URL login cố định do người dùng bấm khi tới bước phù hợp; chưa chạy flag với Facebook thật, chưa xác nhận login/permission/collection.
- Đóng UI chính drain browser host trước quit. Đóng profile hủy owned webContents/view/window rồi flush cookie/storage. Smoke còn kiểm trường hợp webContents bị hủy bên ngoài: getter native của WebContentsView có thể không còn webContents, nên host kiểm guard và hủy cửa sổ cũ trước tạo view mới; không để cửa sổ thứ tư rò lại.

## Secrets và chính sách giữ cookie

`SecretStore` là application port, chỉ main sử dụng. Implementation dùng async safeStorage có trong Electron 44.7.0 đã pin: availability/encrypt/decrypt và key-rotation re-encrypt. Target hiện tại là Windows; crypto không có/lỗi thì fail closed, không chuyển plaintext/basic_text. Tên file là hash key, payload `.bin` chỉ được ghi sau mã hóa và thay nguyên tử. Không có read/write secrets IPC. [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) mô tả OS protection và giới hạn trước ứng dụng chạy cùng tài khoản OS; CSD không tuyên bố mã hóa toàn bộ Chromium profile.

[Session smoke](p01-session-smoke-2026-10-27.json) đo trước khi host restore ở process thứ hai: `nativeSessionCookiePresentBeforeHostRestore = false`, `nativePersistentCookiePresentBeforeHostRestore = true`. Vì vậy builtin persist partition đáp ứng persistent cookie/localStorage nhưng chưa giữ session cookie fixture này. CSD chỉ backup session cookies (kể cả HttpOnly), còn persistent cookies giao Chromium; không copy cookie giữa profile và không gia hạn hiệu lực server-side.

### Logout, debounce và crash

Khi host nhận cookie-change event, ghi/flush marker `.dirty` không có dữ liệu cookie **trước** debounce/lưu mã hóa async. Snapshot chỉ được đánh dấu dùng được sau khi ghi cipher, flush cookie native thành công và cookie revision vẫn khớp. Cookie thay đổi giữa các await giữ marker; close drain/retry hữu hạn và báo lỗi nếu chưa có snapshot nhất quán. Không âm thầm coi lỗi ghi thành công.

Nếu restart còn dirty marker, snapshot cũ không được restore; chỉ dùng trạng thái native rồi tạo backup mới khi có lượt lưu hợp lệ. Đây là lựa chọn ưu tiên không khôi phục cookie đã logout, chấp nhận có thể mất session cookie mới nhất và cần đăng nhập lại sau crash. Smoke logout xóa cả cookie thường/HttpOnly, flush native deletion, xác nhận backup cũ còn tồn tại nhưng đã invalidated, rồi `app.exit(0)` bỏ qua clean shutdown. Process kế tiếp không có lại cookie đã xóa; profile B vẫn giữ dữ liệu riêng.

Test crash dùng debounce **10 giây chỉ trong fixture** để chủ động giữ cửa sổ pending-write; production là 150ms. Đây là test cơ chế invalidation khi write còn pending, không là phép đo xác suất crash trong 150ms. Không hứa durability khi crash trước native event tới host, storage lỗi, OS mất điện hoặc server đã vô hiệu hóa auth.

### Restore lỗi một phần

Snapshot được kiểm cấu trúc toàn bộ trước mutation. Trước lần set cookie đầu tiên, ghi marker `.restoring`; chỉ xóa sau toàn bộ set/flush thành công. Lỗi hoặc crash giữa chừng để marker tồn tại; profile bị `SESSION_RECOVERY_REQUIRED` qua restart/host owner mới, chưa được mở view hoặc gọi là xác thực thành công. Không tự xóa marker hoặc dùng trạng thái native một phần để tiếp tục. Smoke inject lỗi ở lần set thứ hai, kiểm 0 view được mở và owner kế tiếp vẫn bị chặn. Chưa xây UI sửa/xóa dữ liệu phục hồi; marker và ciphertext được giữ ngoài repo để xử lý có kiểm soát ở task phù hợp.

## Kiểm tra thực tế

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run check` | PASS: main/preload/renderer/tests noEmit và 44 ca contract P00 |
| Unit subset của CSD agent | 14 PASS: 9 ca bootstrap/boundaries gồm R01, 5 ca profile/policy/vault/journal |
| `npm test` tích hợp tại thời điểm kiểm | 32 PASS, gồm 14 ca trên và 18 ca agent adapter xuất hiện trong workspace; 44 ca P00 PASS. Tech lead chạy kiểm tích hợp cuối sau khi nhận cả hai nhánh |
| `npm run test:session -- --output ... --screenshot ...` | PASS, 3 process/13 nhóm kiểm local, 0 window/webContents sau hai lượt clean shutdown |
| `npm run test:smoke -- --output ... --screenshot ...` | PASS, 2 lượt bootstrap sau mở rộng bridge profile, vẫn không có Node trong renderer, network UI bị chặn, fixture không tăng valid LIVE count |
| UI | Đã xem ảnh profile fixture: form/tên phiên, trạng thái mở/đóng, nút login disabled, tiếng Việt hiển thị đầy đủ |

Session smoke kiểm form tạo profile và nút mở qua UI thật, payload lạ bị từ chối; hai profile không trộn session/persistent/HttpOnly cookie/localStorage; ID và vault giữ qua process; website không có Node/CSD bridge; geolocation/popup/external redirect/request bị chặn; close/reopen/destroyed-view lifecycle; ciphertext không chứa literal markers giả; logout pending-write và quarantine partial restore.

Evidence: [session JSON](p01-session-smoke-2026-10-27.json), [UI profile](p01-session-profile-ui-2026-10-27.png), [bootstrap JSON mới](p01-session-bootstrap-smoke-2026-10-27.json), [bootstrap image mới](p01-session-bootstrap-offline.png), [source manifest](p01-session-source-manifest-2026-10-27.json). Không sửa report/manifest lịch sử P00/P01.01 hoặc lead baseline để khớp source mới.

## Giới hạn bàn giao

Chưa đăng nhập Facebook thật, chưa đọc bài, chưa observer/CDP/P01.03, chưa parser/SQLite/queue/benchmark. Không có G00/G01/G02 mới được PASS. Manual-login policy còn cần kiểm với luồng Facebook thực; allowlist hẹp có thể chặn một phần login flow. Mọi binding hiện vẫn unverified, không cấp quyền dùng dữ liệu cho adapter từ label/profile.

Chưa kiểm Windows sạch, portable executable, fault injection filesystem hoặc mọi tình huống kill/power loss. Windows async safeStorage được kiểm trên máy phát triển, không đảm bảo bảo vệ khỏi app cùng user hoặc toàn profile Chromium. Không có secret thật trong code/test/evidence. Không sửa file adapter của agent thứ hai, master plan hoặc `.brain/README.md`.
