# P02.02 — Review subtree rejection metadata

Reviewer `csd_adapter`, 2026-10-28. **FINAL REVIEW PASS trên freeze 01:00:50Z; không finding trong phạm vi này.** Theo [dispatch](../handoffs/lead-p02-subtree-rejection-dispatch-2026-10-28.md). [LIVE v23](p02-live-observed-header-v23-2026-10-28.json) có observed link/header/viewport phù hợp nhưng subtype UNSUPPORTED; chưa biết tag/attribute thực. Không suy nguyên nhân từ tên subtype. Lịch sử baseline giữ nguyên; kết luận cuối ở cuối báo cáo.

## Invariants của lượt review

Giữ action/whitelist/proof/first rejection như v23 khi đủ ngân sách. Fact mới phải gắn với failpoint đầu của chính traversal, phân biệt actual guard với preflight của target đã bị NEW_WINDOW loại. Không lấy lỗi của descendant chưa duyệt làm nguyên nhân. Closed enum/OTHER thay mọi tag/attribute name tùy ý; không raw name/value/text/markup/URL/ID. Depth và shape count bounded. INCOMPLETE vẫn không cấp action; metadata work dùng budget chung, final R-PF1 guard tiếp tục chặn khi cạn ngân sách. Không lặp classifier traversal để có facts hoặc sửa candidate/cache/binding.

## Frozen v23 baseline

Tái dùng compiled modules đã nghiệm thu ở `.test-build-adapter-candidate/observed-header-guards-final/src`, copy vào `.test-build-adapter-candidate/subtree-v23-baseline/`. Fixed DISCOVER/CLICK hashes đối chiếu manifest frozen v23. [Receipt](adapter-p02-subtree-v23-baseline-files-2026-10-28.json) lưu hashes/source test snapshot; không dùng code owner đang viết làm baseline.

**2/2 focused tests PASS, 4 variants** trong complete DISCOVER→CLICK:

- DIV wrapper chứa SPAN có unknown attribute và SVG: actual guard MEDIA_OR_HEADING/UNSUPPORTED; target BLANK vẫn first NEW_WINDOW nhưng preflight UNSUPPORTED. Cả hai zero target/click. Tag failpoint phải thắng lỗi attribute descendant nếu code mới thêm attribution.
- SPAN có `aria-hidden=false` hoặc unknown attribute: vẫn MEDIA_OR_HEADING/UNSUPPORTED, zero target/click. Không raw unknown attribute name/value trong opening metadata.

```powershell
node --test --test-name-pattern='review subtree metadata baseline:' .test-build-adapter-candidate/subtree-v23-baseline/tests/facebook-search-post-open-review.test.js
```

Baseline chưa chứng minh reason/tag/attribute/depth mới vì v23 chưa có những field đó. Sau freeze sẽ thêm assertions đúng schema và kiểm native wrapper-tag/wrapper-attribute, positive SVG và budget phù hợp; không lặp suite không đổi. Reviewer không chạm production/runtime/profile/gates.

## Final frozen review

Đã đọc [handoff](../handoffs/p02-subtree-rejection-2026-10-28.md), classifier, validator và cache/reuse actual→preflight. [Final receipt](adapter-p02-subtree-final-files-2026-10-28.json) lưu compiled/source-test/native hashes và [manifest owner](p02-subtree-rejection-files-2026-10-28.json). **26/26 owned hashes + 69/69 native-copy build hashes khớp**, source/manifest ổn định trước/sau review; generated DISCOVER/CLICK khớp freeze. Default search/current-post strings giữ hash đã nghiệm thu.

Instrumentation lưu first rejection trong detail, chỉ map tag/attribute vào fixed enums; unknown names về OTHER/DATA_ATTR/ARIA_OTHER/ON_EVENT. Depth dùng D0–D8/OVER_8/UNKNOWN, không raw depth. Actual classification result/detail được reuse ở preflight; BLANK vẫn NEW_WINDOW và actual facts NOT_CHECKED. Exception giữ INCOMPLETE và enum location, không exception message. Không thêm subtree traversal hoặc thay whitelist/target/ink proof. Final R-PF1 guards vẫn sau tổng hợp metadata và trước binding/click.

**13/13 focused checks PASS: 11 reviewer + 2 owner.** Reviewer giữ fixtures baseline, thêm assertions reason/tag/attribute/depth và so projection với hash-pinned v23 trên cùng DOM. DIV wrapper thắng attribute lỗi của descendant chưa được duyệt; SPAN aria/data attribute được chỉ đúng; exception ở nested SPAN cho EXCEPTION/SPAN/NONE/D2 và INCOMPLETE. Các ca schema 5/19 raw-coercion mutations/shape cap, SVG positive, transparent fill, target 160/161 và deadline/node cap vẫn đạt. Không chạy lại toàn bộ lifecycle/verifier suites không đổi.

```powershell
node node_modules/typescript/bin/tsc tests/facebook-search-post-open-review.test.ts tests/facebook-search-post-open.test.ts --rootDir . --outDir .test-build-adapter-candidate/subtree-final --target ES2022 --module NodeNext --moduleResolution NodeNext --types node --lib ES2022 --strict --exactOptionalPropertyTypes --skipLibCheck
node --test --test-name-pattern='review subtree|review preflight hard budget|review search diagnostics|review observed SVG ink|review observed target policy|review observed header: inline SVG|subtree first failpoint|subtree incomplete' .test-build-adapter-candidate/subtree-final/tests/facebook-search-post-open-review.test.js .test-build-adapter-candidate/subtree-final/tests/facebook-search-post-open.test.js
```

**2/2 native fixtures độc lập PASS**, synthetic protocol only, external/source requests 0, cleanup windows/webContents 0; discovery projection bằng v23:

- [Actual wrapper tag](adapter-p02-subtree-wrapper-tag-2026-10-28.json): MEDIA_OR_HEADING, UNSUPPORTED/HTML_TAG/DIV/NONE/D1; zero click/read.
- [BLANK wrapper attribute](adapter-p02-subtree-wrapper-blank-attribute-2026-10-28.json): first NEW_WINDOW, actual facts NOT_CHECKED; preflight UNSUPPORTED/ATTR_NOT_ALLOWED/SPAN/ARIA_HIDDEN/D1; zero click/read. Class trước aria-hidden được chấp nhận, id phía sau không ghi đè first failure.

Đã báo core-ready cho lead. Review này chứng minh attribution/redaction/bounds/equivalence trên code và fixture; chưa xác định tag/attribute của Facebook LIVE hoặc chứng minh automatic search→post. Reviewer không thao tác runtime/profile/gates; lead giữ activation và đọc nguồn.
