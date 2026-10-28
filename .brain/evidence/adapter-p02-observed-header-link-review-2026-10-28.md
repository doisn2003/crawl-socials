# P02.02 — Review observed header link và SVG text

Reviewer `csd_adapter`, 2026-10-28. Trạng thái **FINAL REVIEW PASS — R-OH1/R-OH2 CLOSED** trên freeze sửa lỗi 00:29:48Z. Phạm vi theo [dispatch](../handoffs/lead-p02-observed-header-link-dispatch-2026-10-28.md) và [ADR-016](../decisions/ADR-016-observed-search-post-open.md). Lịch sử baseline và failed snapshot được giữ bên dưới; kết luận cuối ở cuối báo cáo.

V22 đã có một OBSERVED_POST/target ABSENT/viewport PASS/header COLOCATED, chưa có temporal proof và media predicate FAIL. Metadata này chưa chứng minh phần tử bên trong là SVG hoặc SVG text. Không thay BLANK/popup policy, không claim search→post LIVE thành công.

## Thiết kế cần giữ

- Proof UNIQUE_HEADER_POST_LINK chỉ dành cho observed group-post href mà classifier hiện có chấp nhận, cùng public-group/header/body containment và unique choice. Không biến structural proof thành ngày đăng hoặc temporal text.
- Observed post và một placeholder hợp lệ cùng header phải cùng tham gia ambiguity; không ưu tiên link đầu chỉ vì kiểu href khác.
- SVG subtype cần kiểm namespace, cấu trúc và thuộc tính hẹp; external reference/image/foreignObject/nested link/control/heading/unknown không được coi là text chỉ vì có một text descendant. Cần native fixture để kiểm DOM SVG thực, không suy từ mock.
- Bounded classification dùng chung deadline/node budget và giữ R-PF1; metadata không sửa target/eligibility/cache. Unknown/incomplete không cấp action. Target binding phải phát hiện thay node/href/subtree, owner/lifecycle guards giữ nguyên.

## Frozen v22 baseline

Tái dùng compiled modules đã nghiệm thu từ `.test-build-adapter-candidate/search-preflight-final/src`, copy sang output reviewer riêng. Đối chiếu fixed discovery/click hashes với receipt final v22; không gán source đang thay đổi cho baseline. [Baseline receipt](adapter-p02-observed-header-v22-baseline-files-2026-10-28.json) lưu hashes và test source snapshot.

**1 PASS / 3 FAIL đúng khác biệt contract dự kiến** trên complete fixed scripts:

1. Bare observed post link không có temporal text: v22 NO_ELIGIBLE_TIMESTAMP; contract mới mong TARGETS_READY/proof riêng và đúng 1 click.
2. Observed post link chứa inline SVG text/tspan: v22 NO_ELIGIBLE_TIMESTAMP; contract mới mong proof riêng và đúng 1 click khi subtype được chứng minh.
3. Hai observed links hoặc observed+placeholder: contract mới yêu cầu ambiguity/zero action. V22 loại observed link trước bước choices nên chưa hỗ trợ invariant mới này.
4. Ma trận 10 negative media/control/SVG external/foreignObject/image/nested link/path/heading/wrong namespace: zero target/click trên v22. Vì v22 chặn observed href thiếu temporal trước media, đây chỉ là fail-closed baseline; không phải bằng chứng classifier SVG mới đã đúng.

```powershell
node --test --test-name-pattern='review observed header:' .test-build-adapter-candidate/observed-header-v22-baseline/tests/facebook-search-post-open-review.test.js
```

Reviewer test source hiện có thêm DOM namespace/attributes/childNodes/localName mô phỏng để chạy cùng full script. Khi owner freeze sẽ kiểm interface đúng DOM, giữ expectations, bổ sung assertions subtype/bounds, mutation và native SVG cần thiết. Không chạm production/shared build/runtime/profile hoặc raw source data.

## Review frozen 00:22:53Z

Đọc [handoff](../handoffs/p02-observed-header-link-2026-10-28.md), kiểm **39 owned hashes + 68 native build hashes khớp** [manifest](p02-observed-header-link-files-2026-10-28.json) trước copy. Generated DISCOVER/CLICK trong compiled reviewer khớp manifest. Snapshot lỗi được giữ tại `.test-build-adapter-candidate/observed-header-ink-failed/` và `.test-build-adapter-candidate/observed-header-target-failed/`; [receipt](adapter-p02-observed-header-ink-failed-files-2026-10-28.json) lưu compiled/source-test/native fixture hashes và manifest bản cũ. Không dùng hash source sau sửa cho kết quả lỗi.

Bare observed link và SVG text positive đã đạt trên full scripts. Ma trận media/namespace/control baseline đều zero action. Hai observed href có ID khác nhau bị base scan loại sớm bằng AMBIGUOUS_BOUNDARY, không tới opening choices; reviewer đổi assertion về đúng tầng rejection, vẫn giữ zero target/click. Observed+placeholder trong cùng header đạt AMBIGUOUS_TIMESTAMP/zero action. DOM harness bổ sung firstChild/nextSibling và computed-style properties theo API thực; schema assertion 3→4. Compile dùng exactOptionalPropertyTypes đúng cấu hình repository.

### R-OH1 (P2) — Transparent computed fill bị coi là visible ink

`src/main/facebook-search-post-open-script-hooks.ts:22`, `visibleInk`: chỉ loại fill none/empty hoặc opacity bằng 0, chưa loại alpha 0 của computed fill. SVG text/tspan có `rgba(0, 0, 0, 0)` vẫn có rect dương, vì vậy được phân loại SVG_TEXT_ONLY và mở bài dù chưa chứng minh chữ nhìn thấy.

Complete DISCOVER→CLICK reviewer test `review observed SVG ink: fully transparent computed fill cannot prove visible text` cho expected 0, actual 1 target/click. [Native reproduction](adapter-p02-observed-header-transparent-native-2026-10-28.json) dùng CSS fixture làm text/tspan trong suốt, measured geometry dương; Chromium vẫn nhận SVG_TEXT_ONLY và thực hiện **1 click/1 read**. `reviewerIssue` ghi expectedClicks 0, actualClicks 1, allTransparent true, positiveRects true. Native report PASS ở đây nghĩa là harness tái hiện chính xác hành vi owner-positive; **không phải acceptance của guard**. Fixed scripts/controller không sửa; chỉ fixture HTML CSS trong bản sao build reviewer thay đổi. External/source requests 0, cleanup windows/webContents 0.

```powershell
node --test --test-name-pattern='review observed SVG ink:' .test-build-adapter-candidate/observed-header-ink-failed/tests/facebook-search-post-open-review.test.js
```

### R-OH2 (P2) — Oversized target bị mất bởi bounded attribute helper

`src/main/facebook-search-post-open-script-hooks.ts:105`, action target guard dùng `attr(target,'target')`; helper trong base script trả chuỗi rỗng khi giá trị dài hơn 160. Một observed post link + SVG text hợp lệ với named target dài 160 bị chặn, nhưng dài 161 được coi như absent và tạo **1 target/click**. Điều này ảnh hưởng trực tiếp proof mới dù helper đã tồn tại trước thay đổi. Preflight classifier có thể ghi INVALID, nhưng facts không được dùng để sửa quyết định action.

Test `review observed target policy: oversized named target never becomes absent through bounded attr helper` giữ cùng fixture và kiểm 160/161; expected zero, actual 1 ở 161. Nên kiểm raw target/null hoặc classifier với đúng ABSENT/EMPTY/SELF, không coi giá trị oversized là absent. Không yêu cầu mở BLANK/popup policy.

```powershell
node --test --test-name-pattern='review observed target policy:' .test-build-adapter-candidate/observed-header-target-failed/tests/facebook-search-post-open-review.test.js
```

Đã báo hai findings cho lead; chưa core-ready/LIVE. Giữ fixtures/kỳ vọng để kiểm bản sửa focused, không chạy lại 20 native không đổi hoặc đụng runtime/profile.

## Final review — guard corrections 00:29:48Z

Đã đọc [handoff sửa lỗi](../handoffs/p02-observed-header-link-guards-2026-10-28.md) và [manifest](p02-observed-header-link-guards-files-2026-10-28.json), compile độc lập vào `.test-build-adapter-candidate/observed-header-guards-final/`. **28/28 owned hashes và 68/68 native build-copy hashes khớp**, manifest/source ổn định trước và sau kiểm. Generated DISCOVER/CLICK khớp freeze; base search/current-post fixed strings giữ hash đã nghiệm thu. [Final receipt](adapter-p02-observed-header-final-files-2026-10-28.json) lưu hashes, lệnh/outputs tham chiếu và kết quả native. Failed snapshots không bị ghi đè.

- **R-OH1 CLOSED:** visible ink đòi supported computed RGB/RGBA với alpha dương trong parser giới hạn 96 ký tự, đồng thời giữ clip/geometry/effects/viewport proof. Zero alpha, unknown hoặc malformed forms không cấp SVG_TEXT_ONLY; không xuất color string. Reading/proof tiếp tục dùng budget chung.
- **R-OH2 CLOSED:** actual action guard kiểm raw `getAttribute('target')`, chỉ nhận null/empty/exact `_self`. Chuỗi quá dài không thể rơi về empty; target_kind vẫn chỉ là metadata. Không nới BLANK/popup policy hoặc rewrite attribute.

**51/51 focused checks PASS: 27 reviewer + 24 owner.** Hai failed repro giữ nguyên fixtures và kỳ vọng zero action đều đạt. Positive bare observed/SVG, ambiguity, media/control/external/namespace negatives, schema 4 với 15 raw/coercion mutations, target 160/161, first-rejection/state isolation, stale, R-PF1 deadline/node cap, Stop/late result đều đạt. Không chạy lại các suite metadata/verifier không bị đổi.

```powershell
node node_modules/typescript/bin/tsc tests/facebook-search-post-open-review.test.ts tests/facebook-search-post-open.test.ts --rootDir . --outDir .test-build-adapter-candidate/observed-header-guards-final --target ES2022 --module NodeNext --moduleResolution NodeNext --types node --lib ES2022 --strict --exactOptionalPropertyTypes --skipLibCheck
node --test .test-build-adapter-candidate/observed-header-guards-final/tests/facebook-search-post-open-review.test.js .test-build-adapter-candidate/observed-header-guards-final/tests/facebook-search-post-open.test.js
```

**4/4 native scenarios độc lập PASS**, chạy trên hash-checked build copy riêng, synthetic protocol only, external/source requests 0, cleanup windows/webContents 0:

- [Transparent alpha 0](adapter-p02-observed-header-guards-transparent-2026-10-28.json): glyph geometry dương, computed ZERO alpha, SVG_OTHER, zero click/read.
- [Positive alpha 0.5](adapter-p02-observed-header-guards-alpha-positive-2026-10-28.json): computed POSITIVE alpha, SVG_TEXT_ONLY, đúng 1 click/1 read.
- [Named target 161](adapter-p02-observed-header-guards-target161-2026-10-28.json): NEW_WINDOW/INVALID, zero click/read, không raw name.
- [Target mutation](adapter-p02-observed-header-guards-stale-target-2026-10-28.json): native MutationObserver/raw guard cho STALE_TARGET, zero click/read.

Không còn blocker trong phạm vi này. Đã báo core-ready cho lead trước khi hoàn thiện receipt. Đây là xác minh code/fixture, chưa chứng minh subtype của header Facebook thực, search→post LIVE success, source/identity/valid hoặc throughput. Reviewer không thay runtime/profile/production/gates; lead giữ quyền activation và đọc nguồn.
