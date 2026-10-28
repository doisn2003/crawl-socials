# P02.02 — Review read-only navigation/resource policy khi login trắng

Ngày 2026-10-27. Reviewer `/root/csd_adapter`, gửi lead `/root`. Trigger do lead cung cấp: người dùng đã đăng nhập qua source window CSD; cửa sổ trắng/logo Meta, accessibility cho thấy origin Facebook và pathname có `two_step_verification`. Reviewer **không đọc session/credential, không tương tác UI, không chạy live network**. CSD agent giữ quyền sửa source/build; review này không thay đổi source, tests, build, master hoặc README.

## Kết luận ngắn

**Chưa có bug được tái hiện đủ để kết luận nguyên nhân trang xác minh trắng.** Predicate hiện cho phép HTTPS `www.facebook.com/two_step_verification/`, `/checkpoint/` và `/login/`; cho phép resource script HTTPS thuộc `fbcdn.net`. Không có logic chặn theo pathname `two_step_verification` trong policy đang đọc.

Có các ranh giới policy/lifecycle có thể ảnh hưởng một flow xác minh, nhưng chưa có bằng chứng flow thực đang yêu cầu chúng. Không đề xuất mở domain/scheme/popup hoặc bỏ checkpoint từ suy đoán. Cần nối event bị chặn hoặc timeout với đúng lần trắng trước khi sửa.

## Phạm vi code và các điều xác định được

| Vị trí tại snapshot review | Hành vi đã xác định | Ý nghĩa cho chẩn đoán |
| --- | --- | --- |
| `src/infrastructure/browser/navigation-policy.ts:9–22` | Navigation cho HTTPS Facebook/subdomains; resource thêm fbcdn/subdomains; không xét pathname. `about:blank` được phép. | Bản thân đường dẫn two-step/checkpoint không bị predicate từ chối. Domain khác không tự được nhận; chưa biết request thực nào bị chặn. |
| `src/infrastructure/browser/browser-host.ts:77–81` | `onBeforeRequest` hủy URL khi `resourceAllowed=false`; chỉ tăng counter tổng. | Resource bị chặn có thể gây thiếu JS/XHR, nhưng counter hiện không nêu resource type/origin/frame hoặc thời điểm; không đủ kết luận causal. |
| `browser-host.ts:163–165` | `will-navigate`, `will-redirect` và **mọi** `will-frame-navigate` đều dùng `navigationAllowed`. | Một URL fbcdn có thể được resource policy cho phép nhưng bị navigation policy từ chối nếu dùng làm frame navigation. Đây là khác biệt có thật, chưa phải bằng chứng flow two-step cần frame đó. |
| `browser-host.ts:161` | Mọi popup bị deny, kể cả target Facebook. | Nếu flow thực cần popup, nó không mở được. Chưa có bằng chứng popup bị yêu cầu trong lần trắng; không đổi thành allow-all. |
| `browser-host.ts:129–139` | `loadURL` chạy cùng timer 15 giây; khi chưa settle timer gọi `wc.stop()` và trả `BROWSER_LOAD_FAILED`. `finally` dọn timer. | Có thể dừng initial load/redirect chain chậm. Không phải timer 15 giây cho toàn phiên: nếu initial load đã finish trước lúc người dùng nhập login thì timer đã bị dọn, không được đổ lỗi cho timer sau đó. |
| `browser-host.ts:73–75` | Permission request/check/device đều deny. | Cần biết permission nào thực bị yêu cầu trước khi liên hệ với flow; không tự nới camera/device/storage. |
| `browser-host.ts:146–160, 171–186` | WebContentsView được attach và resize; đóng view/connections ở close path. Không thấy code tự detach/đóng view chỉ vì pathname login đổi. | Chưa có bằng chứng lifecycle tự làm trống view sau login. Cookie save không clear cookie store. Không đọc dữ liệu người dùng để suy diễn thêm. |
| `src/main/index.ts:46–58, 80–90` | Manual login dùng persistent profile session riêng. UI/default session deny remote không được gắn vào profile session đó. Fixture observer driver chỉ tạo khi `probeSmoke`. | Không áp kết luận “UI deny remote chặn toàn Facebook” hoặc “fixture driver khóa điều hướng login” cho normal mode. Cần đối chiếu launch mode thực nếu nghi khác. |

Electron `44.7.0` type documentation cục bộ (`node_modules/electron/electron.d.ts:17814–17855, 17969–17996, 18550–18568`) xác nhận frame event gồm main/subframes, các URL positional arguments hiện còn tồn tại nhưng deprecated, và loadURL resolve khi did-finish-load/reject khi did-fail-load. Vì vậy không có bằng chứng code đang dùng callback signature sai chỉ từ việc còn positional `url`.

## Probes offline đã chạy

Không build. Import module đã có `dist/infrastructure/browser/navigation-policy.js`; dùng URL **tổng hợp, không truy cập URL**, không mang query/token. Hai giá trị dưới đây là kết quả predicate, không chứng minh Chromium thực phát webRequest event cho mọi scheme.

| Ca tổng hợp | navigationAllowed | resourceAllowed |
| --- | --- | --- |
| HTTPS www.facebook.com/two_step_verification/ | true | true |
| HTTPS www.facebook.com/login/ | true | true |
| HTTPS www.facebook.com/checkpoint/ | true | true |
| HTTPS static.fbcdn.net/synthetic.js | false | true |
| blob:https://www.facebook.com/synthetic-uuid | false | false |
| data:text/html,synthetic | false | false |
| about:srcdoc | false | false |
| about:blank | true | true |
| wss://www.facebook.com/synthetic | false | false |
| HTTP www.facebook.com/login/ | false | false |

10/10 expectations PASS. `data/blob/about:srcdoc/wss` là giới hạn predicate xác định được; **chưa quan sát trang xác minh thật dùng chúng**. Không kết luận cần mở chúng, hoặc Chromium đã thực sự hủy chúng trong phiên người dùng.

Lệnh test có sẵn, không compile hay ghi build:

```powershell
node --test --test-name-pattern='browser URL policy' .test-build/tests/session.test.js
```

Kết quả: 1 test PASS, 0 fail. Test chỉ xác minh policy unit; không kiểm render/login thật.

Probes có thể tái chạy chỉ đọc module:

```powershell
@'
import assert from 'node:assert/strict';
import {createBrowserPolicy} from './dist/infrastructure/browser/navigation-policy.js';
const policy=createBrowserPolicy({manualLoginEnabled:true});
const cases=[
 ['https://www.facebook.com/two_step_verification/',true,true],
 ['https://www.facebook.com/login/',true,true],
 ['https://www.facebook.com/checkpoint/',true,true],
 ['https://static.fbcdn.net/synthetic.js',false,true],
 ['blob:https://www.facebook.com/synthetic-uuid',false,false],
 ['data:text/html,synthetic',false,false],
 ['about:srcdoc',false,false], ['about:blank',true,true],
 ['wss://www.facebook.com/synthetic',false,false],
 ['http://www.facebook.com/login/',false,false]
];
for(const [url,nav,res] of cases) {
 assert.equal(policy.navigationAllowed(url),nav);
 assert.equal(policy.resourceAllowed(url),res);
}
console.log('PASS 10 offline policy cases');
'@ | node --input-type=module
```

## Diagnostics tối thiểu đề xuất cho owner

Mục tiêu là biết **app vừa hủy gì, ở frame nào, trước hay sau lúc trang trắng**, không thu nội dung login. Tạm ghi trong đúng handler/host hiện có cho đúng owned view/session; không gắn một network handler mới thay mất policy. Không dùng response-body observer của crawler để thu trang xác minh.

1. Baseline rồi delta `blockedRequests`, `blockedNavigations`, `deniedPopups` riêng cho view/generation đang xét. Kèm monotonic relative time và event type; counter toàn app hiện có không đủ chỉ ra flow gây tăng.
2. Với event bị chặn: scheme, hostname chuẩn hóa, resource type, main-frame/subframe, policy reason enum. Không lưu full URL, pathname, query, fragment, userinfo, referrer, request/response headers, POST data hoặc body. Nếu cần nhận biết route, dùng category cố định `LOGIN`/`TWO_STEP`/`CHECKPOINT`/`OTHER` từ kiểm tra nội bộ; không xuất chuỗi path gốc.
3. Với request failure: resource type/origin tối thiểu như trên, numeric network error code và main-frame flag. Với navigation: start/redirect/finish/fail timestamps, app timeout-fired flag và load duration. Phân biệt hủy chủ động do app với HTTP/network failure; không coi mọi ERR_ABORTED là policy block.
4. Renderer lifecycle: destroyed/render-process-gone reason enum, loading/main-frame-loading flags. Console chỉ lấy mức/count hoặc mã lỗi đã làm sạch, không dump text/stack/source URL vì có thể chứa dữ liệu phiên. Permission event chỉ tên permission và allow/deny, không chi tiết input hoặc danh tính.
5. Dùng buffer giới hạn, chẳng hạn tối đa 100 events cho một lượt diagnostics tối đa 60 giây; đây là đề xuất kỹ thuật để owner chọn, chưa là implementation. Không tự refresh, nhập 2FA, click checkpoint hoặc kéo dài thử vô hạn. Dừng diagnostics sau lượt tái hiện, xuất summary đã làm sạch; không đưa raw login logs/screenshot/session vào `.brain`.

Nếu có policy block đúng thời điểm thiếu tài nguyên thì kiểm request/frame đó và nguồn phát sinh trước khi sửa allowlist hẹp. Nếu không có block/timeout/crash thì các hướng tiếp theo có thể là lỗi JS/nguồn/challenge flow, nhưng review offline này chưa xác định được hướng nào. Không kết luận “Facebook chống bot” hoặc “cần domain X” chỉ từ logo Meta.

## Snapshot và giới hạn review

SHA-256 bytes đọc trong lượt này (source/build owner có thể sửa sau review):

| File | SHA-256 |
| --- | --- |
| src/infrastructure/browser/browser-host.ts | 0d46483223e8972d3bc9572b60d351264e6e71d1348d8eab77fbb62c7b1f8bad |
| src/infrastructure/browser/navigation-policy.ts | ca9c10d68eba97429baa0e0a1a19c49b844a2c413cdf1fffdb9c5dfbb49c1d14 |
| dist/infrastructure/browser/browser-host.js | 0259ae701a23afead10c636d4cd73ac776c184ffbbb4e5cc8d4be64277cfc837 |
| dist/infrastructure/browser/navigation-policy.js | f74c9f55ba8ab4cad9259f32801cebe689aa050c179401260c607e2f291fb567 |

Chỉ ghi file review này. Không có sửa runtime, bằng chứng bypass hay thay đổi quyền nguồn. Lead và CSD agent cần diagnostics thực trên phiên do người dùng vận hành để kết luận nguyên nhân và kiểm bản sửa; reviewer không đánh dấu DONE/PASS cho login hoặc P02.02.
