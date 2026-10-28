# P02.02 — Review passive aria-labelledby wrapper

Reviewer `csd_adapter`, 2026-10-28. **FINAL REVIEW PASS trên freeze 01:17:01Z, không findings.** Theo [dispatch](../handoffs/lead-p02-passive-aria-wrapper-dispatch-2026-10-28.md); [LIVE v24](p02-live-subtree-rejection-v24-2026-10-28.json) đã ghi ATTR_NOT_ALLOWED/SPAN/ARIA_LABELLEDBY/D1. Chỉ xem thuộc tính này là metadata thụ động trên HTML SPAN, không mở rộng ARIA/style/namespace khác. Lịch sử baseline giữ nguyên bên dưới.

## Focus review

- Không IDREF lookup hoặc dùng label ngoài target làm text/temporal/public/visibility proof. Các giá trị attribute khác nhau không đổi UNIQUE_HEADER_POST_LINK hay bịa ngày đăng.
- Không skip children. Media/control/unknown/foreignObject/transparent/hidden descendants vẫn bị loại.
- Giữ string/attribute/traversal budget, non-SPAN/namespace guards, BLANK/popup policy và raw binding. Mutation attribute cần native observer; VM harness không được dùng để tuyên bố đã xác minh MutationObserver thật.

## Baseline v24

Giữ compiled source v24 đã nghiệm thu từ `.test-build-adapter-candidate/subtree-final/src` vào `.test-build-adapter-candidate/passive-aria-v24-baseline/`; [receipt](adapter-p02-passive-aria-v24-baseline-files-2026-10-28.json) xác minh DISCOVER/CLICK hashes và test source snapshot.

**1 PASS / 1 FAIL đúng contract thay đổi** trên complete scripts:

- Positive SPAN aria-labelledby + inline text hoặc SVG: v24 vẫn NO_ELIGIBLE_TIMESTAMP; contract mới mong TARGETS_READY và structural proof riêng, không date inference. Test đặt trap cho IDREF lookup/query và giá trị trông giống temporal/action label.
- Sáu negative media/control/unknown/foreign/transparent/hidden ink đều zero action. V24 loại attribute trước khi tới descendants, nên baseline này không phải bằng chứng guard mới đã giữ đúng traversal; sẽ kiểm lại sau freeze giữ nguyên fixtures.

```powershell
node --test --test-name-pattern='review passive ARIA:' .test-build-adapter-candidate/passive-aria-v24-baseline/tests/facebook-search-post-open-review.test.js
```

Chưa nghiệm thu thay đổi hoặc chạy nguồn. Không lặp 13 checks của task metadata đã hoàn tất; reviewer chỉ sửa tests/evidence/output riêng.

## Final review

Đã đọc [handoff](../handoffs/p02-passive-aria-wrapper-2026-10-28.md) và code frozen. Production classifier thêm đúng một ngoại lệ `!svg && !inSvg && tag==='span' && name==='aria-labelledby'`, sau namespace/string/length/attribute-count checks. `continue` chỉ chuyển sang attribute kế tiếp; children vẫn được duyệt sau vòng attributes. Không IDREF parsing/lookup hoặc proof mới; schema5, target/ink/budget/binding guards giữ nguyên.

**5/5 focused checks PASS: 3 reviewer + 2 owner**, compile riêng `.test-build-adapter-candidate/passive-aria-final/`. Reviewer giữ baseline fixtures: plain/SVG và các giá trị trông giống thời gian/action vẫn UNIQUE_HEADER_POST_LINK, published_at null, lookup trap không bị gọi. Sáu loại unsafe/hidden/transparent descendants tiếp tục zero action. Length160 đạt,161 là INCOMPLETE/ATTR_VALUE_LIMIT/ARIA_LABELLEDBY; SVG/non-SPAN/wrong namespace/otherARIA/style và BLANK không được mở rộng. Owner focused checks thêm attribute count và shared node/deadline fences. Không lặp suite13 checks metadata hoặc các native SVG/limit lead đã kiểm.

```powershell
node node_modules/typescript/bin/tsc tests/facebook-search-post-open-review.test.ts tests/facebook-search-post-open.test.ts --rootDir . --outDir .test-build-adapter-candidate/passive-aria-final --target ES2022 --module NodeNext --moduleResolution NodeNext --types node --lib ES2022 --strict --exactOptionalPropertyTypes --skipLibCheck
node --test --test-name-pattern='review passive ARIA:|passive SPAN|passive wrapper' .test-build-adapter-candidate/passive-aria-final/tests/facebook-search-post-open-review.test.js .test-build-adapter-candidate/passive-aria-final/tests/facebook-search-post-open.test.js
node --test --test-name-pattern='passive aria wrappers preserve' .test-build-adapter-candidate/passive-aria-final/tests/facebook-search-post-open.test.js
```

[Native stale attribute](adapter-p02-passive-aria-stale-2026-10-28.json) **PASS**: sau discovery đổi duy nhất aria-labelledby, native MutationObserver/raw guard trả STALE_TARGET, zero click/read. Synthetic protocol only, external/source requests0, cleanup windows/webContents0. Đây là kiểm thực observer; không lấy stub VM làm bằng chứng native binding.

[Final receipt](adapter-p02-passive-aria-final-files-2026-10-28.json): **27/27 owned hashes và69/69 copied native build hashes khớp**, manifest/source ổn định trước/sau; generated DISCOVER/CLICK đúng freeze, base fixed strings giữ hash. Baseline/failed snapshot cũ không ghi đè.

Không còn blocker trong phạm vi thay đổi; đã báo core-ready cho lead. Chưa claim search→post LIVE, pointer-event cause hoặc valid/throughput. Reviewer không chạm runtime/profile/production/gates; lead giữ activation và source read.
