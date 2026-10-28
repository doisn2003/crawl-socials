# P02.02 — Review bound observed URL open

Reviewer `csd_adapter`, 2026-10-28. **DESIGN/BASELINE READY, chờ implementation frozen.** Theo [ADR-017](../decisions/ADR-017-bound-observed-post-url.md) và [dispatch](../handoffs/lead-p02-observed-url-open-dispatch-2026-10-28.md). Không kiểm lại ARIA parser đã nghiệm thu, không nguồn thật/runtime.

## Concerns gửi lead sớm

- Capability `resolveVerification.navigateObservedRoute` cũ yêu cầu current page cùng post và URL bằng canonical hint. Nhánh search→exact tracked URL cần guard rõ; không chỉ bỏ hai điều kiện rồi làm rộng quyền của verifier cũ. Owner/search URL/document generation cần được kiểm ở dispatch sau await revalidation; Stop/loss/change trước dispatch phải zero navigation.
- Fixed revalidation, controller và current-post reader cần thống nhất parser GROUP_QUERY/tracking, duplicate/encoded alias/key/length rules. Raw absolute observed URL dùng để navigate phải tách khỏi normalized identity hint, không dựng URL từ IDs hoặc strip tracking trước load.
- URL chỉ xuất phát từ private fixed binding đã revalidate/consume, không menu/IPC/CLI input. Public scan/summary phải redacted; private proof có thể giữ exact URL theo ADR.
- Sau navigation cần một start/commit/fresh document cùng owner và exact destination; redirect/route khác/Stop không được gọi reader. Late native result vẫn giữ pending fence đến settle. Metadata navigation_count riêng, click_count0.

Đây là các điều kiện review của thay đổi đang triển khai, chưa kết luận code mới có bug.

## Parser parity baseline v25

Reviewer file `tests/facebook-observed-url-open-review.test.ts` mới, output `.test-build-adapter-candidate/observed-url-v25-baseline/`. Modules copy từ frozen `.test-build-adapter-candidate/passive-aria-final/src`, không lấy source owner đang thay đổi. [Receipt](adapter-p02-observed-url-v25-baseline-files-2026-10-28.json) lưu module/test hashes.

**1 PASS /1 FAIL đúng gap đã giao**: search href classifier nhận GROUP_QUERY với literal `__cft__[0]`, nhưng current-post parser v25 trả null. Contract mới cần parser tương thích, giữ large post ID ở dạng string và normalized identity không chứa tracking. Test thứ hai có14 negative duplicate IDs/query alias, unknown action key, credentials/hash/http/host/path/encoded identity/oversize; tất cả bị reader-parser cũ loại. Đây chỉ là parity baseline, không phải authorization hoặc controller navigation proof.

```powershell
node --test .test-build-adapter-candidate/observed-url-v25-baseline/tests/facebook-observed-url-open-review.test.js
```

Chờ contract/code frozen để thêm meaningful controller race/Stop/redirect/native tests; không dựng controller giả khi API chưa chốt. Không tự cấp validity/gate hoặc thao tác session.

## Preliminary implementation review — chưa owner freeze

Đã đọc API strategy OBSERVED_URL, fixed URL DISCOVER/REVALIDATE, shared parser, private observed_url validation và search-specific navigation capability. `fromSearch` giữ guard initial search URL/generation ở fence; verifier cũ giữ same-post/canonical guard. Chưa thấy blocker ở các nhánh đó trên snapshot sơ bộ.

**8 focused reviewer tests PASS** trong `.test-build-adapter-candidate/observed-url-preliminary/`: parser parity/14 negative forms; decorated header revalidation consume-once/no-click/private URL; exact navigation→fresh callback; owner/generation/search/Stop đổi sau revalidation zero navigation; invalid/cross-origin raw result zero navigation; Stop trong native navigation giữ pending fence và drop late events; redirect/tracking swap/SPA không reader. Đây là provisional tests trên source đang viết, chưa hash-stable acceptance hoặc native proof.

### R-URL1 (P2) — Interactive descendant role bị bỏ sót

`checkOpenUrlSemantics` trong `src/main/facebook-search-post-open-script-hooks.ts` chặn một số interactive roles nhưng thiếu role menuitem. Complete URL DISCOVER trên GROUP_QUERY header hợp lệ chứa `<span role="menuitem">opaque-clock</span>` cho **1 bound target/url_semantics CLEAR**, expected0 theo yêu cầu loại action controls của ADR-017. Không liên quan style/decoration whitelist. Test cũng chuẩn bị combobox/slider nhưng failed run dừng ở menuitem, chưa tuyên bố kết quả hai role sau hoặc native reproduction.

[Failed receipt](adapter-p02-observed-url-role-failed-files-2026-10-28.json) lưu compiled modules/fixed strings/test source hashes trong `.test-build-adapter-candidate/observed-url-role-preliminary/`; không gán owner manifest hoặc hash source sau edit cho run này.

```powershell
node --test --test-name-pattern='review observed URL: interactive' .test-build-adapter-candidate/observed-url-role-preliminary/tests/facebook-search-post-open-review.test.js
```

Đã báo lead để owner sửa semantic role guard trước freeze. Giữ expected zero target; chưa core-ready/LIVE.
