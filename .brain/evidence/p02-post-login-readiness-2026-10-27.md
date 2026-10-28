# P02.02 — Readiness sau login

2026-10-27, theo [dispatch](../handoffs/lead-post-login-dispatch-2026-10-27.md), master1.16/ADR-008/009. Lượt này chỉ đọc code và sửa tài liệu; giữ PID10344/profile CSD Facebook, không source/build/network/UI/auth/capture.

**Login đã đạt; automated source probe chưa có.** [Lead nghiệm thu login](lead-p02-session-diagnostics-review-2026-10-27.md) dựa trên xác nhận trực tiếp của user. Persistence/account binding chưa kiểm không biến thành yêu cầu login lại; snapshot1854events đã mất chuỗi reCAPTCHA do ring drop, không claim provider completed200. Search/Posts/continuation/ba nguồn và yield chưa quan sát. G00 vẫn NOT_EVALUATED; không PASS từ login hoặc fixture.

## Phần tái dùng được

BrowserHost có profile/session và owned view generation; auth rendering đã sửa. Observer/resolver/lifecycle đã nghiệm thu offline, có giới hạn segment và cleanup. Controller Start/Stop/counters/deadline/freeze/writer đã [nghiệm thu fixture](lead-p02-controller-review-2026-10-27.md). SocialAdapter/PostCandidate contracts và fake adapter có tests. Những phần này đủ làm nền cho lát cắt nhỏ, không cần SQLite/UI/host thứ hai.

## Ba nhóm blocker độc lập

| Nhóm | Hiện trạng | Cách xử lý |
| --- | --- | --- |
| Điều kiện nguồn | [Assessment](facebook-browser-route-assessment-2026-10-27.md) chưa xác lập disposition cho automated browser collection; cap ADR-009 không là grant | Lead chốt căn cứ/điều kiện route trước capture. Không hỏi lại Meta API/login hoặc đòi1000 bài làm precondition |
| Code live | Factory production=null, controller/action/mode và writer cố định FIXTURE; không driver/parser Facebook | Chỉ nối sau khảo sát UI/route; không đổi một flag rồi gọi là live |
| Bằng chứng kỹ thuật | Chưa biết Posts entity/controls, source response/fields, public context, continuation | Khảo sát manual Posts trước; dữ liệu mẫu tự thu là bước automated khác, cần gate |

Matrix/assessment/preflight có câu session chưa login là snapshot cũ, được lead review mới bổ sung; lượt này không sửa input đang pin. Platform-condition conclusion chưa được login thay thế.

## File/function phải đổi trong lượt triển khai sau

| Điểm hiện có | Khoảng cần nối tối thiểu |
| --- | --- |
| src/main/index.ts: createProbeController driver=fixture-or-null | Trusted main bind route/disposition +session evidence; không approval boolean từ renderer |
| electron-probe-driver.ts: createFixtureProbeDriver/action/beginSegment | Driver query Posts đã quan sát, owned target hiện có, filter response giới hạn; bỏ phụ thuộc loopback /capture |
| probe-controller.ts: ProbeDriverSession.action, execute, readBatch, start/config/status/finalize | Action names/3-query loop và FIXTURE checks/manifest/summary phải nhận effective plan/mode thật; giữ outer budgets, Stop/cutoff và no-resume |
| probe-contract.ts +shared/desktop-api.d.ts | Status chỉ FIXTURE/null; live unavailable không tự đổi từ login; provenance không được payload nâng mode |
| probe-contract.ts: sanitizeProbeCapture; ProbeExtractor.inspect | Hiện chỉ byte/status/MIME và candidate count; cần bounded typed candidate fields/publicity evidence từ mẫu đã quan sát, không fabricate |
| probe-writer.ts: observe/finalize | Hiện hard-code FIXTURE và diagnostic membership, chưa lưu post identity/text/permalink/source evidence; cần typed allowlist/versioned record phù hợp contract |
| probe-freeze.ts: createProbeFreeze | Effective config hash hiện mode FIXTURE; phải freeze selected query/subcaps/driver/parser/route evidence mới sau build ổn định |

Không có live command hiện chạy được. scripts/observer-debug.mjs và test:probe chỉ fixture/replay; fake-social-adapter không chứng minh endpoint hoặc paging Facebook.

## Bước tiếp duy nhất làm được ngay theo gate

Đề nghị **lead giao human một lượt tìm cafe Hà Nội → Bài viết/Posts ngay trong cửa sổ đang đăng nhập**, observer/crawler OFF. Đầu ra một summary: Posts có/không, card kết quả có/không, label/locale và continuation nhìn thấy hay UNOBSERVED. Không chép nội dung bài/account/query-token URL; không bắt cuộn để đủ mẫu hoặc login lại. Agent/CUA điều khiển browser hoặc software thu response sau human click vẫn là automation, không gọi human-only. Lượt tài liệu này không thực hiện thao tác đó.

Sau khảo sát và disposition/gate phù hợp, lát cắt đề nghị: **1 query/1 batch/≤5 candidates/≤5 phút/≤3 controlled actions, không retry hoặc continuation**, dùng host/controller hiện có. Đây là đề xuất thấp hơn trần ADR-009, chưa là run được duyệt/freeze. Chỉ cần một source type quan sát được; còn lại UNKNOWN, không hứa ba nguồn hoặc1000/24h. Driver/parser ưu tiên theo UI/mẫu thật; không đoán GraphQL/selectors. Phần độc lập đã chuẩn bị ở [runbook cập nhật](../specs/facebook_source_probe_runbook.md); không mở framework khác.

Tiêu chí kiểm khi triển khai: fail-closed nếu thiếu route/session evidence; FIXTURE không thành LIVE; một action → một bounded batch → selected/versioned output ngoài repo với provenance/cutoff; missing fields/publicity giữ UNKNOWN, valid=0 tới khi đủ audit; Stop/auth/challenge/coverage/deadline dọn sạch và không reset budget. Không gọi timeout là source end. Không attach capture thật trước gate, không xây durable resume/SQLite/scheduler trong lát cắt này.

Kiểm lượt này: đọc đúng source/function và đối chiếu master/review; chỉ kiểm local links/hashes tài liệu, không chạy build/test/runtime. Source matrix/assessment/master/README/gate và phiên người dùng giữ nguyên.
