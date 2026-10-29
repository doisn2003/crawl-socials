> **LỊCH SỬ — đã được thay từ 29/10/2026.** Người dùng chọn `codex/csd-production` để phát triển CSD dùng thật. Đọc [ADR-021](decisions/ADR-021-production-branch.md) và phần Hiện hành 2.0 của [master plan](master_plan.md). Prompt/dispatch/gate thử nghiệm bên dưới không còn là chỉ dẫn thực thi; không tự chạy lại.

# Prompt bàn giao — CSD thử nhánh request pagination

Sao chép nội dung bên dưới sang agent mới. Đây là prompt để người dùng giao việc, không tự khởi động lại agent trong chat cũ.

---

Bạn tiếp quản dự án CSD (Crawl Socials Data) tại `C:/OwnProject/crawl-socials`, Windows/PowerShell. Hãy thực hiện phương án `.brain/branch_plan.md` trên nhánh Git riêng, kiểm chứng bằng Facebook thật và lưu dữ liệu có ích.

Đây là chỉ thị mới của tôi: cho phép agent này tiếp tục thử nghiệm có giới hạn, thay trạng thái DỪNG trước đây trong phạm vi công việc dưới đây. Không khởi động lại hai worker cũ, heartbeat hoặc chuỗi điều phối qua đêm. Không cần hỏi lại tôi có muốn bắt đầu hay có được dùng tài khoản đã giao hay không.

## 1. Đọc đúng bối cảnh, không đọc hết lịch sử

Đọc theo thứ tự:
1. `.brain/branch_plan.md` — phương án chính và giới hạn B00/B01/B02.
2. `.brain/README.md`, phần hiện trạng/bảng task của `.brain/master_plan.md` — vị trí trong dự án, không phải toàn bộ dispatch cũ còn hiệu lực.
3. `.brain/research/csd-source-recovery-proposal-2026-10-28.md` — phương án phụ và đầu ra link-first.
4. Khi cần đối chiếu bằng chứng: `.brain/evidence/lead-p02-subframe-review-2026-10-28.md`, `.brain/evidence/lead-p02-passive-aria-wrapper-review-2026-10-28.md` và ADR-017. Không lặp đọc hàng chục handoff/review không liên quan.

Nếu tài liệu cũ xung đột với prompt này, làm theo chỉ thị mới này và ghi ngắn phạm vi thay đổi. Đừng quay về vòng chờ Meta grant cho phép thử kỹ thuật được tôi giao; quyền nền tảng vẫn UNKNOWN, không tự ghi ALLOWED.

## 2. Mục tiêu và hiện trạng thật

CSD là ứng dụng Electron/TypeScript thu bài Facebook theo từ khóa. Workload: quán cafe, quán ngon, địa điểm coffee/hẹn hò, cafe Hà Nội, thương hiệu như Tiny Cafe, sự kiện ở quán. Ưu tiên Hà Nội nhưng không giới hạn địa phương.

Đầu ra trực tiếp: **link bài thực + thông tin hữu ích đọc được**, gồm text/snippet, Page/nhóm/cá nhân, công khai/chưa rõ, ngày đăng, tổng reactions/số tim, comment/share. Thiếu trường phụ phải lưu null và lý do, không loại cả bài hoặc bịa số 0.

Mục tiêu dài hạn vẫn 1.000 bài Facebook hợp lệ không trùng trong 24 giờ thu; được lấy bài cũ, có cả Page, nhóm công khai, cá nhân công khai. TikTok không bù chỉ tiêu. Phép thử nhánh chỉ cần chứng minh nguồn và dataset nhỏ, không tự chạy benchmark 24 giờ.

Sự thật đã biết:
- User đã đăng nhập Facebook trong profile CSD và xác nhận search có bài. Không hỏi lại thông tin này như chưa biết. Kiểm phiên hiện tại trước khi dùng; không giả định PID hoặc cửa sổ cũ còn tồn tại.
- V18 từng đọc và mở lại khớp một snippet bài nhóm thật, sau khi bài được mở thủ công. Chưa có collector tự động nhiều bài.
- V24/v25 bị bộ kiểm DOM của CSD loại vì ARIA/style/SVG, chưa có bằng chứng những lần đó Facebook chặn nguồn.
- Nhánh mở observed URL mới có fixture thành công nhưng chưa được nghiệm thu LIVE. Không coi đó là thành quả đã dùng được.
- P02.02 còn dang dở. 11/40 task DONE là số đếm lịch sử, không dùng để báo phần trăm khả năng crawl; chưa chứng minh 1.000 bài.
- Cả hai worker cũ đã dừng, automation đã xóa. Bạn làm độc lập trong chat mới.

Sai lầm cần tránh: lần trước agent sửa liên tục bộ kiểm timestamp, viết nhiều test/framework rồi dùng computer use tìm lại cùng query qua nhiều bản, không tạo dataset tương xứng. Tôi đã tốn nhiều quota và không chấp nhận lặp lại cách đó.

## 3. Git: phải có điểm quay về thật

Lần kiểm tra bàn giao: workspace **chưa phải Git repository**. Kiểm lại vì trạng thái có thể đã thay đổi.

- Nếu chưa có Git: tôi cho phép khởi tạo repository local với nhánh `main`, chuẩn bị `.gitignore` và tạo baseline commit cục bộ từ code/config/tài liệu cần thiết hiện có.
- Nếu đã có Git: kiểm branch, working changes và main trước; bảo toàn mọi thay đổi hiện có, tạo checkpoint cục bộ phù hợp. Không ghi đè hoặc loại bỏ công việc của người khác.
- Trước stage, kiểm danh sách file. Loại `.env`, credentials, cookie/token, browser profile, dataset thô, database, node_modules, dist/release và mọi thư mục build/test tạm như `.build-*`, `.test-build-*`. Không `git add .` mù quáng. Không sửa cấu hình Git global; nếu cần danh tính cho checkpoint, dùng danh tính agent rõ ràng ở phạm vi repository/lệnh, không giả danh tôi.
- Ghi baseline commit SHA. Tạo và chuyển sang `experiment/facebook-request-pagination`; nếu tên đã có thì kiểm nội dung trước, không reset nhánh đó.
- Mọi code thử phải ở nhánh experiment. Tôi cho phép commit/checkpoint và merge **cục bộ** trong phạm vi này; không push, publish hoặc tạo remote.
- Không dùng reset --hard, clean -fd hoặc xóa profile/dataset để quay lui. Branch switch không tự dọn build output: khi trở về main phải tái tạo build từ source main nếu cần chạy, bảo toàn profile và bằng chứng ngoài Git.

## 4. Hướng kỹ thuật ưu tiên

**Browser giữ phiên/khám phá → request đọc đã quan sát + cursor thật → parser → dedup → ghi dữ liệu.**

Không mặc định phải cuộn giao diện cho mọi batch. Dùng tối thiểu thao tác UI để nhận diện request search/load-more thật. Sau đó kiểm khả năng code gửi continuation trong đúng query/filter/profile mà không cuộn/render batch mới.

Không đoán endpoint, doc_id, tên field, token hoặc cấu trúc JSON từ trí nhớ. GraphQL có cursor không chứng minh Facebook Search của phiên này hỗ trợ cách gọi bạn muốn. Phải thấy bằng chứng thật. HTTP 200 hoặc nhận lại batch cũ không phải thành công.

Code đáng đọc trước:
- `src/infrastructure/browser/response-observer.ts`: đã có Network.enable/getResponseBody. Default 128 KiB/body, MIME JSON/plain, Fetch/XHR, 30 giây có thể không phù hợp response thật; phải nhìn drop reasons trước khi quy lỗi cho Facebook.
- `src/infrastructure/browser/electron-observer-target.ts`: binding webContents/session.
- `src/main/electron-probe-driver.ts`: hiện chỉ fixture driver.
- `src/main/index.ts`: probe driver ngoài smoke đang null; DOM diagnostic là nhánh riêng, đừng suy toàn app không đọc được gì.
- DOM/current-post reader hiện có: chỉ tận dụng để đối chiếu và bổ sung trường thiếu.

Tái sử dụng session/observer; không viết lại app, đổi stack hoặc thêm framework trước khi có record. Session.fetch hay fetch trong context trang phải chọn theo request thật; cùng cookie không tự bảo đảm origin/referrer/CSRF/state giống nhau.

Chỉ gửi operation đọc đã quan sát, scope rõ; không tương tác like/comment/share/post, không vượt challenge/deny hoặc đổi account/proxy để lách giới hạn. Tôi đã cung cấp tài khoản trong `.env` và cho phép dùng cho CSD; ưu tiên phiên đang có, không in hoặc đưa secrets vào log/chat/Git. Chỉ hỏi khi thật sự cần thao tác mới của con người như xác minh đăng nhập.

Prompt này cho phép phạm vi request continuation được mô tả trong branch_plan, rộng hơn ADR DOM/passive-only cũ. Ghi một decision ngắn thay vì tự mắc kẹt trong ngoại lệ cũ; không lấy user authorization làm permission của Meta.

## 5. Giới hạn thử và nghiệm thu

Theo branch_plan: tối đa 60 phút **tổng đợt thử**, gồm chuẩn bị Git, code, kiểm, build và LIVE. Ghi giờ bắt đầu, không reset đồng hồ sau mỗi bản sửa. Một agent triển khai; không tự mở thêm worker hoặc automation.

- B00, trần 20 phút: phải có ít nhất một record thật có URL và thông tin hữu ích, liên kết được với request/response. Không có thì dừng nhánh với nguyên nhân cụ thể.
- B01, trần 40 phút: chứng minh continuation bằng code trả batch mới có ít nhất một identity/link mới, không cần cuộn/render batch đó.
- B02, trần 60 phút: nhắm tới 20 link bài khác nhau với metadata và trạng thái xác minh; persist theo batch và có file kiểm được.

Tối đa 2 lượt search/filter UI, 2 thao tác cuộn khám phá, 5 request continuation chủ động; concurrency 1. Dừng khi barrier thật, hết nguồn, cursor lặp, hai batch không có link mới hoặc hết ngân sách. Đây không phải giới hạn tất cả HTTP request nền của trang.

Thiếu ngày đăng/tim/share lưu null; tổng reactions khác love_count. Loại nguồn khác visibility. Ứng viên chưa rõ công khai không tính thành bài công khai đã xác minh. ID dạng string, URL thật, chống trùng; không coi response chứa mọi `id` là bài post.

Lưu dataset local ngoài repo; `.brain` giữ báo cáo sạch và tham chiếu. Test tập trung vào parser với mẫu đã làm sạch, dedup/persist và phần transport thay đổi; không lặp toàn bộ suite không liên quan hoặc dùng fixture PASS thay LIVE.

## 6. Thành công thì giữ, thất bại thì quay main

**PASS nhánh:** có continuation không cần UI tạo ra bài mới; đạt dataset nhỏ 20 link hợp lệ về định danh/link và metadata quan sát được; có đối chiếu nguồn thật, dedup và lưu bền vững; kiểm phù hợp không có lỗi nghiêm trọng. PASS này chưa phải benchmark 1.000/24h.

Nếu PASS: review diff, commit cục bộ, merge vào main khi sạch và phù hợp baseline, chạy kiểm/build tích hợp cần thiết. Giữ nhánh experiment để truy nguồn. Báo dataset, số link, độ đầy đủ các trường và commit. Chưa tự mở chạy 24 giờ.

**PARTIAL/FAIL nhánh:** không đủ các điều kiện trên trong giới hạn, kể cả lấy được vài bài nhưng continuation chưa chạy hoặc chưa đủ dataset. Lưu code thử bằng checkpoint trên nhánh experiment và báo cáo nguyên nhân; giữ nhánh/bằng chứng, không merge phần chưa đạt. Trở về main và bảo đảm không tiếp tục chạy build experiment dưới tên main.

Sau khi quay main, tiếp tục nghiên cứu và phát triển **một bước thay thế có căn cứ**, tối đa 30 phút bổ sung: dựa trên evidence chọn browser-driven response hoặc DOM link-first, hoặc sửa độc lập lỗi hạ tầng đã chứng minh. Dùng nhánh thử riêng tiếp theo cho code rủi ro, không phá baseline main. Không tự mở thêm đợt thu LIVE vượt budget nguồn ở trên; chuẩn bị bước thử kế tiếp và báo rõ. Không nối thêm vòng vô hạn/qua đêm. Nếu không có bước hữu ích độc lập, báo đúng điểm cần quyết định thay vì tạo thêm framework.

## 7. Báo cáo và cách làm việc

Chủ động thực hiện, không chỉ trả một bản kế hoạch. Cập nhật ngắn khi có dữ liệu thật, nguyên nhân thất bại hoặc đổi hướng; không thuật lại mọi thao tác. Mọi câu khẳng định thành công phải có dataset/evidence kiểm được.

Kết thúc trả:
1. PASS/PARTIAL/FAIL và lý do.
2. Số link duy nhất thật đã lưu; bao nhiêu đủ nguồn/công khai/relevance, thiếu metadata gì.
3. Continuation không cuộn đã làm được hay chưa, bằng chứng batch trước/sau.
4. File dataset và báo cáo `.brain/evidence/branch-request-pagination-result.md`.
5. Baseline SHA, nhánh/commit thử, đã merge hay quay main, working tree/build hiện tại.
6. Bước nghiên cứu/phát triển tiếp theo đã làm hoặc điểm nghẽn còn lại.

Không báo “28%” hoặc lấy số test/version làm kết quả sản phẩm. Bắt đầu bằng kiểm Git, tạo baseline an toàn và đọc code liên quan; ưu tiên phép thử nguồn thật nhỏ nhất có thể chứng minh hoặc bác bỏ hướng request continuation.
