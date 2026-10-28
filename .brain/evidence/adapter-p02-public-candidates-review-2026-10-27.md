# P02.02 — Review độc lập bounded public candidates

Ngày 2026-10-27, reviewer `/root/csd_adapter`, theo [dispatch](../handoffs/lead-p02-public-candidates-dispatch-2026-10-27.md) và [evidence DOM thật](p02-live-result-region-2026-10-27.md). Chỉ offline source review và fixture tổng hợp. Không thao tác nguồn, phiên Facebook, shared dist, gate hoặc code owner.

## Kết luận hiện hành — Lượt 29, v13 R-G1/R-G2 đã đóng

2026-10-28 Asia/Bangkok. Đọc [handoff v13](../handoffs/p02-public-group-2026-10-28.md), exact vocabulary, direct-control admission/required bounded audit, discovery pruning và counters/schema13. Fresh strict compile riêng + **84/84 reviewer tests PASS**, không blocker mới tái hiện. [Manifest](p02-public-group-files-2026-10-28.json) **14/14 owned hashes khớp trước/sau**, fixed script và compiled controller khớp; owner source ổn định.

- R-G1 exact group aria-label/title graphic variants nhận đúng sample; R-G2 direct own-label BUTTON/rolebutton nhận trước prune. Giữ source_type UNKNOWN, boundary_verified false, PUBLICITY_NOT_INDEPENDENTLY_VERIFIED; không suy group type từ label.
- Giữ nguyên baseline private/body/quote/comment/embedded/hidden/partial/outside-header/substring/split-header negatives. Thêm2tests đúng phạm vi: required control child exact/split Friends/Sponsored hoặc structural embedded/nested-only labels không lọt; known private counterpart conflict bị loại. Public control phải audit đủ:4controls/64nodes đạt,5controls/65nodes loại và không payload.
- publicLabelsSeen/publicSignalsAccepted/publicControlsPruned kiểm exact counts ở direct-control fixture và validator chặn array/negative/>2500/raw-label key. Đây là diagnostic attempts/signals, không verified-public hoặc số bài duy nhất. Schema assertion12→13/rejectold12; không thay fixture hoặc expectation hành vi khác.

| Snapshot lượt29 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate-script.ts` | `3f46c35cd00af593477643c3b5e6a8f706f23c9dee5accea77f5051d891de331` |
| `src/main/facebook-public-candidate.ts` | `ec510b96f45702d8192a22692cea6dd99e202a38a26e03ba411894f969929ac5` |
| `tests/facebook-public-candidate.test.ts` | `6472577a2a8d2256d58c2dd0c703e33231d698d4e8e7c509934d1e0abd25f4a3` |
| Reviewer source | `8b243900560ef3989150b1dcdc7122513a4e6fd0437fd50bf2d60de9409bacd9` |
| Compiled reviewer | `de9ace64384c84e4102c2c14037ed1bba71f864fd514d1ed213e8d44519c675d` |
| Fixed script string | `7d85f7915f7ed6838375e96e04d4231abce3a809b3d78723ca7f29a6da6769f6` |
| Compiled script module | `4852b7cf86cb4d77016f3fe96473a2e8e7f8ccaae012d1b0fa3c62ed3a2a37a9` |
| Compiled controller | `6ae0c6911e191c7b88f177e273a790d0beb3c3f3ab9c29f85a621b4f23f6c858` |

Strict compile/output như lượt22. Final `node --test --test-reporter=dot .test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js` exit0. Chỉ reviewer files/output, không native/live/UI/runtime/shared dist/.env/master/gate. Kết luận đủ để lead nghiệm thu/nạp diagnostic; chưa suy AX=DOM attribute hoặc xác nhận cause/yield nguồn thật. Reviewer chốt và dừng.

## Lịch sử lượt 28 — Public-group/control baseline v12

Đọc [dispatch v13](../handoffs/lead-p02-public-group-dispatch-2026-10-28.md) và [lead evidence AX/LIVE v12](lead-p02-auxiliary-review-2026-10-28.md). Giữ compiled v12 đã nghiệm thu trong `.test-build-adapter-candidate/v12-public-group-baseline/`. Strict compile reviewer PASS; **3 targeted tests: 1 PASS / 2 FAIL**. Không lặp broad suite hoặc tác động nguồn.

- **R-G1/P2:** exact label `Đã chia sẻ với Nhóm công khai` trong cùng header, SVG role img/aria-label, SPAN role img/title hoặc IMG/aria-label: cả3 trả0 thay vì1 diagnostic sample. V12 vocabulary chưa có exact form này.
- **R-G2/P2:** BUTTON hoặc SPAN role button với direct label bị prune trước public recognition. Cả nhãn cũ `Public` và nhãn group đều0, nên control-pruning repro độc lập với missing vocabulary. Fixture chỉ direct signal; không giả định nested control chưa được kiểm.
- Negatives private group, substring/prefix/suffix, public label trong body/quote/comment/embedded, hidden/partial signal, ngoài header, split header và mixed known private đều0. Sau fix vocabulary phải chạy lại nguyên fixture; baseline negatives chưa tự chứng minh implementation mới.

Fixture dùng DOM attributes tổng hợp để kiểm code. AX `graphic` label được lead thấy **không** chứng minh trên nguồn dùng aria-label/title nào hoặc mapping boundary nào; chưa kết luận đây là nguyên nhân LIVE0. Positive kỳ vọng vẫn source_type UNKNOWN/boundary_verified false/PUBLICITY_NOT_INDEPENDENTLY_VERIFIED, không gán source group từ label.

| Frozen baseline v12 | SHA-256 |
| --- | --- |
| Fixed script string | `6dd3d58ca42a5d7c16d076cc3c5aab1836a189aa13127bc11a4aa8b382332ca8` |
| Compiled controller | `018a7e599b40fd9576a059587f3026240dd74b3b672d5242ad187e8d53657055` |
| Compiled script module | `87facc680a8cdd7439c09b0d5b7eaa4f9afd6b0ce32340fb0cc0e124ca42684d` |
| Frozen compiled reviewer | `db5fc4bc9963726455b000bae4ee7cfc7138a5e622308ff58fd974c0f8c5b52e` |
| Reviewer source | `5376a5a9832d8a83e161903cff33ef326160915ddad1708b270ee29d3d17a5be` |

```powershell
node --test --test-name-pattern='review public group:' .test-build-adapter-candidate/v12-public-group-baseline/tests/facebook-public-candidate-review.test.js
```

Đã báo lead R-G1/R-G2. Chỉ reviewer tests/report/output, không source owner/UI/runtime/shared dist/.env/master/gate. Chốt baseline và chờ code-ready.

## Lịch sử lượt 27 — v12 / R-A1 đã đóng

2026-10-28 Asia/Bangkok. Đọc [handoff v12](../handoffs/p02-auxiliary-2026-10-28.md), auxiliary scope/critical visibleSignal, body membership, negative capture/aggregation/audit và schema12. Fresh strict compile riêng + **79/79 reviewer tests PASS**; không blocker mới tái hiện trong scope. [Manifest](p02-auxiliary-files-2026-10-28.json) **15/15 owned hashes khớp trước/sau**, fixed script/compiled controller khớp; source owner ổn định.

- R-A1: nguyên fixture4split labels English/Vietnamese, visible vàpartial đều0sample. Exact negative unknown vẫn veto. Body/quote/author words giữ scope riêng. Negative audit không ghép hai A độc lập thành Friends, không bỏ whitespace để ghép `Fri ends`, không mượn quoted suffix. Unknown prefix và161chars giữ unresolved/no sample;160chars benign chỉ omit và vẫn giữ body.
- Ancillary partial header/footer/author được omit, chỉ COFFEE_BODY được xuất; metadata auxiliaryTextOmitted và AUXILIARY_TEXT_OMITTED đúng. Geometry enum/count không có raw auxiliary. BODY partial (kể cả sâu40), heading/public signal partial, FORM unknown, missing tree/cap/budget/quoted marker/alias/Stop/late guards vẫn strict.
- Validator chặn omitted boolean/reason mâu thuẫn, array enum, nhiều heading hoặc missing body; summary/started/return giữ field_contract_ref ADR-013 và không chứa body/auxiliary payload. Candidate date vẫn null, provenance vẫn diagnostic.

**Cập nhật assertion minh bạch:** schema11→12/rejectold11. Fixture97fragments giữ nguyên; expectation optional1→0 vì negative-label scope vượt cap96nodes theo ADR-013, kèm assert negativeUnresolved>0. Các97char/record khác còn đủ audit vẫn giữ expected phù hợp trước đó. Assertion raw-data từng dùng `includes('AUXILIARY_')` vô tình trúng enum mới `AUXILIARY_TEXT_OMITTED`; thay bằng hai exact synthetic payload sentinels và kiểm boolean/reason mới. Không thay geometry hoặc fixture khó để xanh. Lượt đầu76tests có2assertionfail kể trên; sau cập nhật và thêm3checks semantic scope/bounds/schema, final79PASS.

| Snapshot lượt27 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate-script.ts` | `84b4b324776795d1d4d7bfa95f1b90e01caa99fdd1bce9ff4c0c88be3201e313` |
| `src/main/facebook-public-candidate.ts` | `286fb5ce0e756a09afd3c07c38acf7a26a4201d8f8a934d9091c4563dcf14dd9` |
| `tests/facebook-public-candidate.test.ts` | `ec84943083268fe8aa01871f152f37d1e0ea02959ff0c7edde3bda2abaeeab21` |
| Reviewer source | `6fa536c61959480c05586aee2e61efea0ae3b86a665700f83e07f547b52fe209` |
| Compiled reviewer | `be72cfcbab4d6506759cdd0bfe479ffe997fd48f3e1bf5ef9ce42e82e1fa4c59` |
| Fixed script string | `6dd3d58ca42a5d7c16d076cc3c5aab1836a189aa13127bc11a4aa8b382332ca8` |
| Compiled script module | `87facc680a8cdd7439c09b0d5b7eaa4f9afd6b0ce32340fb0cc0e124ca42684d` |
| Compiled controller | `018a7e599b40fd9576a059587f3026240dd74b3b672d5242ad187e8d53657055` |

Strict compile/output flags như lượt22. Final `node --test --test-reporter=dot .test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js` exit0. Chỉ reviewer tests/report/output; không native/live/UI/runtime/shared dist/credentials/master/README/gates. Đủ để lead tiếp tục nghiệm thu/nạp diagnostic; chưa claim nguồn thật có yield hoặc valid/public benchmark. Reviewer chốt và dừng.

## Lịch sử lượt 26 — Auxiliary baseline theo ADR-013

Đọc [ADR-013](../decisions/ADR-013-auxiliary-text-uncertainty.md) và [dispatch](../handoffs/lead-p02-auxiliary-scope-dispatch-2026-10-28.md). Giữ compiled v11 đã nghiệm thu trong `.test-build-adapter-candidate/v11-auxiliary-baseline/`. Strict compile reviewer PASS; **5 targeted tests: 2 PASS / 3 FAIL**. Không coi các positive mới theo ADR-013 là regression v11; chúng đo thay đổi contract cần triển khai.

- Ancillary partial ở header/footer/author không cung cấp proof và không xuất body; khi public/header/body độc lập đủ cần nhận body. V11 còn trả0 vì OTHER poison. Quote/author chứa chữ restricted nhưng nằm đúng scope riêng cũng còn bị loại do geometry, trong khi body literal positive đạt.
- Mandatory BODY, heading visibleSignal và public visibleSignal partial vẫn0; exact restricted/ad chưa rõ geometry vẫn0. Những expectation này không đổi theo ADR-013.
- **R-A1/P2 — Split negative label trong một scope hẹp đang bị bỏ sót.** Một SPAN chứa các child SPAN ghép thành `Friends`, `Bạn bè`, `Sponsored`, `Được tài trợ`; visible text cho1sample sai ở cả4label. Cùng fixture partial clip cho0 chỉ vì OTHER poison. V12 cần đọc/đánh giá scope đã duyệt có bound hoặc giữ uncertainty của scope, không chỉ kiểm exact từng text node rồi bỏ OTHER. Không ghép text toàn header/page, không coi chữ trong body/quote/author là badge.

Các fixture synthetic giữ nguyên geometry, không nới epsilon/caps hoặc suy text thật Facebook. Review tiếp sẽ chỉ đổi expectation OTHER poison khi mandatory proofs/body độc lập đủ; missing tree, critical signal/body uncertainty, boundary/negative/embedded vẫn strict.

| Frozen auxiliary baseline v11 | SHA-256 |
| --- | --- |
| Fixed script string | `987abbf08b3bf7c2c8398947ee78aa2ac91524658ceaa5b6f3b482db0f923629` |
| Compiled controller | `6a11e53bc7c33bc306a457b2aff4814228e3900ce016d4a568771b1f0250b73a` |
| Compiled script module | `71d1e2915c03166e12ef011547a795c0d5c7a797c674ab57268d1bf5867184cc` |
| Frozen compiled reviewer | `1d2fb5f63cade0077f26d638442cb309db728417793b30bcf34353a5466ec21c` |
| Reviewer source | `ebd21a8d18fd06af1eb5f36c014dafaa03d9ec2d72da1170477f3f963293202a` |

```powershell
node --test --test-name-pattern='review auxiliary:' .test-build-adapter-candidate/v11-auxiliary-baseline/tests/facebook-public-candidate-review.test.js
```

Đã báo lead R-A1 và baseline. Chỉ reviewer tests/evidence/output; không source owner/UI/runtime/shared dist/.env/master/gate. Dừng chờ v12 code-ready.

## Lịch sử lượt 25 — v11 R-H1/R-H2/R-H3 đã đóng

2026-10-28 Asia/Bangkok. Đọc [handoff R-H3](../handoffs/p02-header-tree-2026-10-28.md), code marker quoted/ambiguity/pruning. Fresh strict compile riêng + **71/71 reviewer tests PASS**, giữ nguyên toàn fixture và expectations từ lượt24. Không có blocker mới tái hiện trong phạm vi review.

Fix ghi nhận quoted marker, đặt quotedMessage và prune subtree trước khi đọc inner text; admission có quotedMessage bị AMBIGUOUS_BOUNDARY. Regression quote cũ về0sample/no quoted payload. Không đổi schema/caps hoặc mở rộng contract. R-H1/R-H2 positives/deep body-LCA, public/body/temporal cluster separation, missing visited-parent, global incomplete, nested marker, negative/privacy/late-result guards đều giữ đạt.

[Manifest hiện hành](p02-header-tree-quoted-fix-files-2026-10-28.json) **13/13 owned hashes khớp trước và sau checks**; fixed script và compiled controller cũng khớp. Source owner ổn định; frozen failed snapshot lượt24 giữ nguyên để audit.

| Snapshot lượt25 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate-script.ts` | `acaba7753635fc95dcd9d28c329e070e13bd32b95405db65064c3a0afe55e587` |
| `src/main/facebook-public-candidate.ts` | `640baf66d17b8f05df50e4a1150e5717d9dcc486f791535d9219e6dc9bc7c000` |
| `tests/facebook-public-candidate.test.ts` | `9e939b8c8588302d234af06edd417d4c92ce5e217035d45bab3ec709a7b46aea` |
| Reviewer source, không đổi | `b0d574e30bb4f66bbdec005c459e8556de0a80598a6fe5a6237ec82d82f62318` |
| Compiled reviewer | `0e50d3f1e94befb5b87c787bd6ceb27aabd78eb379f0f9a757425b3f7751535b` |
| Fixed script string | `987abbf08b3bf7c2c8398947ee78aa2ac91524658ceaa5b6f3b482db0f923629` |
| Compiled script module | `71d1e2915c03166e12ef011547a795c0d5c7a797c674ab57268d1bf5867184cc` |
| Compiled controller | `6a11e53bc7c33bc306a457b2aff4814228e3900ce016d4a568771b1f0250b73a` |

Strict compile flags/output giữ nguyên như lượt22; `node --test .test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js` exit0,71PASS. Chỉ offline code/tests/evidence/output, không native/live/runtime/shared dist/credentials/master/gates. Reviewer kết luận đủ để lead tiếp tục nghiệm thu/nạp diagnostic; chưa claim yield/source validity hoặc nguyên nhân duy nhất của LIVE0. Chốt và dừng.

## Lịch sử lượt 24 — v11 R-H1/R-H2 đạt, R-H3 từng mở

Đọc [handoff v11](../handoffs/p02-header-tree-2026-10-28.md), reverse aggregation/body propagation, late temporal/control ancestry và schema11. Strict compile riêng PASS. Sau cập nhật đúng schema assertions10→11, **71 reviewer tests: 70 PASS / 1 FAIL**. Sáu header-tree tests đều PASS; chưa nạp LIVE vì R-H3.

**R-H3/P2 — Quoted marker bị bỏ nhưng quoted text nhập vào outer body.** Trong snapshot v11, `src/main/facebook-public-candidate-script.ts:254` chỉ `registerMarker` khi `!quoted`; nhánh text phía dưới vẫn dùng `inBody` của outer marker và ghi `c.text`. Regression fixture cũ: outer message chứa BLOCKQUOTE > inner message marker > text synthetic. v10 từng reject ambiguous; v11 trả1sample và có `QUOTE_PRIVATE` trong payload. Expected0/no quoted payload theo guard nested independent/quoted message hiện hành. Đây là hành vi cụ thể, không chỉ assertion reason precedence. Không sửa fixture hoặc giảm assertion để xanh.

R-H1/R-H2 đã đạt độc lập: hai nhánh12/40wrapper chung header nhận đúng1candidate optional/observed; separate headers với body sâu40 ở LCA bị loại. Reverse aggregation chuyển cả BODY qua visited tree; frame/edge/control/late temporal work chịu cùng global cap. Thêm kiểm thiếu visited parent: ancestryCuts1/treeIncomplete1, không public/temporal proof hoặc sample. Global cap2500 treeState INCOMPLETE và không payload. Metadata phân biệt public/temporal clusters, DEEP/NONE, COMPLETE/INCOMPLETE; chặn raw path, enum array, depth number, negative/excess counts. Không thay các guard clipping/range.

Tại lúc bắt đầu đọc, [manifest](p02-header-tree-files-2026-10-28.json)14/14owned hashes khớp. Giữ failed compiled source/test trong `.test-build-adapter-candidate/v11-header-failed/`; source owner có thể sửa sau báo finding, nên kết quả trên gắn với frozen compiled hashes dưới đây, không gán cho file mới trên disk.

| Frozen failed v11 | SHA-256 |
| --- | --- |
| Fixed script string | `2590550d8d132ffe2acc0f7f04eb816a139856d1ec743fb309c6323a132f8cf7` |
| Compiled controller | `6a11e53bc7c33bc306a457b2aff4814228e3900ce016d4a568771b1f0250b73a` |
| Compiled script module | `aa17a8c0d529469449c460ae8795898724ae37c7bb8a0d01a3df9f6f834e5c6c` |
| Frozen compiled reviewer | `0e50d3f1e94befb5b87c787bd6ceb27aabd78eb379f0f9a757425b3f7751535b` |
| Reviewer source | `b0d574e30bb4f66bbdec005c459e8556de0a80598a6fe5a6237ec82d82f62318` |
| Source script lúc review bắt đầu | `88e025e4a1c722c7e0b914333eb6609c4a0da952ff562bc517adbaa8c7c4abaf` |

```powershell
node --test --test-name-pattern='review v3: nested marker aliases' .test-build-adapter-candidate/v11-header-failed/tests/facebook-public-candidate-review.test.js
node --test --test-name-pattern='review header tree:' .test-build-adapter-candidate/v11-header-failed/tests/facebook-public-candidate-review.test.js
```

Chỉ reviewer files/output. Không source owner/native/live/UI/runtime/shared dist/credentials/master/gate. Đã báo lead R-H3; chốt tests và dừng chờ fix-ready, không mở rộng suite.

## Lịch sử lượt 23 — Baseline header tree v10

Đọc [dispatch header tree](../handoffs/lead-p02-header-tree-dispatch-2026-10-28.md) và [LIVE v10](p02-live-optional-temporal-v10-2026-10-28.json). Giữ compiled v10 đã nghiệm thu trong `.test-build-adapter-candidate/v10-header-baseline/` trước owner sửa. Strict compile reviewer PASS; **4 targeted tests: 2 PASS / 2 FAIL**. Không chạy broad suite trên source đang đổi.

- **R-H1/P2 — Fixed ancestry cutoff bỏ lỡ header hợp lệ.** Cùng HEADER, heading và direct Public ở hai nhánh neutral DIV sâu12 hoặc40, body ở ngoài HEADER. Cả bốn trường hợp optional-time/observed-time đều0sample thay vì1; v10 cluster heading/pub/time chỉ truyền8ancestors. Fixture chỉ xác nhận lỗi synthetic; không khẳng định đây là nguyên nhân duy nhất của LIVE.
- **R-H2/P2 — Body quá sâu không làm mất điều kiện header ở LCA.** Hai HEADER riêng (một H3, một Public), common ancestor chứa body dưới40neutral wrappers. v10 nhận1 optional sample sai; `cluster(body)` chỉ truyền32 khiến common ancestor bị coi không chứa body. Expected0/no payload. Structural fix cần aggregate body qua toàn quan hệ cây đã duyệt, không chỉ sửa heading/pub cutoff.
- Negatives direct Public từ body/quote/embedded/comment, hai body, header tách, private/ad/mixed siblings vẫn0; global incomplete dừng ở2500 và không lưu candidate/body. Các fixture giữ payload synthetic, không nguồn thật.

| Frozen header baseline | SHA-256 |
| --- | --- |
| Fixed script string v10 | `b03803437d1bbcd5320090cd5e8f12fd977934c1638fc6a3d63b8b926d82a789` |
| Compiled controller | `f761ffa987e740b9114c1133c27093cd86420d6bc797a9e1cccffc1b0dad895b` |
| Compiled script module | `3ca91fae1675ad260fe47130e0795605d2f6d7be8a8e92d4f7a34971161b363c` |
| Frozen compiled reviewer test | `645a460777df0a93f22ceabcb0537d16575a0927436471eeef22f074f2b0f2de` |
| Reviewer source at baseline | `61f49555a4f6542a7e369a5a0f70b42786b733475a056888ffc9cf689f5a76b4` |

```powershell
node --test --test-name-pattern='review header tree:' .test-build-adapter-candidate/v10-header-baseline/tests/facebook-public-candidate-review.test.js
```

Đã báo lead R-H1/R-H2. Chờ code-ready để kiểm aggregation/budget/unsupported ancestry và metadata public-vs-temporal cluster theo contract mới; không đoán sửa hai OTHER/range unknown. Chỉ reviewer tests/evidence/output; không source owner/UI/runtime/shared dist/credentials/master/gate.

## Lịch sử lượt 22 — v10 R-F1 đã đóng

2026-10-28 Asia/Bangkok. Đọc phần fix trong [handoff](../handoffs/p02-optional-temporal-2026-10-28.md), main visible-text branch và pending-control probe. Fresh strict compile riêng PASS; **65/65 reviewer tests PASS**, không blocker mới tái hiện trong scope. Năm owner source/test files ổn định trước/sau; [manifest hiện hành](p02-optional-temporal-restricted-files-2026-10-28.json) **12/12 owned hashes khớp**, fixed script và compiled controller cũng khớp.

- Giữ nguyên fixture R-F1: visible header A `Friends` / A `Bạn bè` / pending BUTTON `Friends` đều 0 sample; unknown restricted/ad vẫn 0. Main text thêm restricted veto chỉ ngoài body/quote/heading; control probe cũng ghi restricted text trước admission. Không đổi classifier, field-scope policy hoặc caps.
- Thêm một positive test để chống loại nhầm: cùng chữ restricted ở body, quoted text hoặc author heading không thành privacy badge. Cả ba nhận đúng body qua optional-time, temporal0/date null/headerProof HEADING_PUBLIC. Không nới fixture negative hoặc lấy text body làm badge.
- Optional MISSING/UNREADABLE, exact empty/static clip, public/header/body/cluster/negative checks, schema consistency, R-T1–3/R-V1, budget, Stop/late results và payload privacy giữ PASS như lượt21. Frozen failed snapshot vẫn giữ riêng để audit.

| Snapshot lượt22 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate.ts` | `816e0928986fa93916768e9f1dbfd8d40269850a01a34b0781f87dfcbc51abe8` |
| `src/main/facebook-public-candidate-script.ts` | `1301dee6b7b0f00186c8e24cf98a0b0a31ffd1299c72b4999a5a7d3220095151` |
| `src/main/facebook-public-candidate-fields.ts` | `9a12713e07f1f51c8d9d1b8f8e3641fa46a2e92ede0ec479052616b7ba1a9755` |
| `src/main/facebook-public-candidate-fixture.ts` | `c688b10d2b790773b766f0c915fc51c6a179281bb1fac9e1b4e5f07b84617698` |
| `tests/facebook-public-candidate.test.ts` | `63aa4b318529091a6819b7253a5ff78d10e008093dde5ff85104c2c7c59f3b46` |
| Reviewer test source | `e0c845aebe6f69083a32cff6af74cb12e99a28035c9b263b818f8685004fed5a` |
| Compiled reviewer tests | `4de0c7a8cf0eebf2b0c1150c9cdabde92cc18d3ae44fe8edc1c0fb636f0dec36` |
| Fixed script string | `b03803437d1bbcd5320090cd5e8f12fd977934c1638fc6a3d63b8b926d82a789` |
| Compiled script module | `3ca91fae1675ad260fe47130e0795605d2f6d7be8a8e92d4f7a34971161b363c` |
| Compiled controller | `f761ffa987e740b9114c1133c27093cd86420d6bc797a9e1cccffc1b0dad895b` |

```powershell
node node_modules/typescript/bin/tsc --ignoreConfig tests/facebook-public-candidate-review.test.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022 --types node --rootDir . --outDir .test-build-adapter-candidate --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --noImplicitOverride --noFallthroughCasesInSwitch --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --noEmitOnError
node --test .test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js
```

Chỉ offline reviewer tests/report/output; không source owner, native/live runtime, shared dist, credentials, master/README/gates. Kết luận đủ cho lead tiếp tục nghiệm thu/nạp đọc diagnostic; chưa chứng minh Facebook yield, public validity hay benchmark. Reviewer chốt và dừng.

## Lịch sử lượt 21 — v10 R-F1 từng mở

Strict compile riêng PASS. Sau khi cập nhật đúng schema10/ADR-012, suite **64 tests: 63 PASS / 1 FAIL**; bảy tests field scope là **6 PASS / 1 FAIL**. Chưa đề nghị nạp LIVE trước sửa R-F1.

**R-F1/P2 — Restricted label bằng visible text bị bỏ qua trong header optional-time.** `src/main/facebook-public-candidate-script.ts:270` chỉ ghi ad từ visible text, không ghi restricted; pending-control text probe cùng thiếu tại dòng216. Repro cùng boundary có H3 + direct Public + single body và header link chứa text `Friends` hoặc `Bạn bè`, không aria-label: script trả 1 sample optional-time, restrictedLabels0. Header BUTTON chứa `Friends` cũng trả 1. Expected0 vì có bằng chứng privacy mâu thuẫn. Cùng fixture với text unknown clipping `Friends`/`Sponsored` trả0 đúng, cho thấy nhánh unknown có guard nhưng nhánh visible thiếu. Không phải đề nghị phân loại text body là privacy badge.

Giữ failed compiled snapshot trong `.test-build-adapter-candidate/v10-field-failed/`, không gán kết quả này cho source sửa sau. Fixed script `b66b8f85d9bdf265bf92786c06fbaaae5faed4f37e6918e8cc50071456311894`; compiled controller `f761ffa987e740b9114c1133c27093cd86420d6bc797a9e1cccffc1b0dad895b`; compiled script module `e1d6ab88cdca8c0a2830e6714c19b0e273161f12302452b9581b7d74fa77cbe5`; frozen compiled reviewer `1c1caa670f107a85b9740ec25f77cd5f5d6800b97f5ee490cb6261561a3b9e13`; reviewer source `a66a940712a41818093950d8d96b691419c140a98f1edc7fca2b55302dba5bf1`. Source script lúc lưu snapshot: `135df9405d43cf16c41b63756b1e6eb4534eb6fe411da5cde5752571a4275a21`; hashes compiled/fixed ở trên là căn cứ tái hiện.

```powershell
node --test --test-name-pattern='review field scope: a non-date' .test-build-adapter-candidate/v10-field-failed/tests/facebook-public-candidate-review.test.js
```

Những ca đạt: optional missing/UNREADABLE nhận đúng single body, date null, temporal0, boundary `_HEADER_PUBLIC_OPTIONAL_TIME`, headerProof HEADING_PUBLIC và missing reason tương ứng; private/ad attributes/mixed wrappers/header split/body unknown vẫn0. Exact empty legacy rect chỉ áp dụng absolute/fixed, static không được ẩn Sponsored; empty rect/inset không cấp public proof hoặc body bắt buộc. Validator chặn ngày tự bịa, missing reason hoặc proof mâu thuẫn, enum array; payload chỉ candidates.json, không summary/started. Stop/owner loss, shared budget và regressions còn lại giữ đạt.

**Thay đổi assertions có chủ đích theo ADR-012:** giữ nguyên fixture quote/comment/embedded/hidden/range/partial tail/R-T2/R-T3/whitespace/96–97. Khi chỉ temporal thiếu hoặc unreadable nhưng header+single body hợp lệ, đổi từ samples0 sang đúng optional sample1 + temporal0/date null/missing reason; vẫn kiểm không có raw tail/author. Ca two-body/two-heading/header split, unknown body/ancestor, control-probe interruption hoặc global partial vẫn samples0. Geometry-only privacy assertion kiểm shape không chứa href/text; candidate permalink được phép trong payload. Không đổi fixture khó để xanh. Một typo test dùng probe.read đã sửa thành API hiện có probe.start trước chạy suite; không sửa sản phẩm.

Chỉ reviewer tests/evidence/output, không nguồn thật/native/runtime/shared dist/credentials/master/gate. Đã gửi R-F1 cho lead; dừng chờ owner fix-ready.

## Lịch sử lượt 20 — Baseline field scope cho ADR-012

Đọc [ADR-012](../decisions/ADR-012-optional-temporal-diagnostic.md) và [dispatch](../handoffs/lead-p02-field-scope-dispatch-2026-10-28.md). Giữ compiled v9 trước owner sửa trong `.test-build-adapter-candidate/v9-field-baseline/`. Bốn test mới chạy trên snapshot này: **1 PASS / 3 FAIL**, đúng khoảng cách contract cần sửa, không gọi là regression của v9 đã nghiệm thu.

- Public heading cùng header + một body đọc được nhưng thiếu temporal: v9 trả 0, ADR-012 cần diagnostic candidate với temporal thiếu/date null.
- Chỉ temporal có partial clip: v9 trả 0, ADR-012 cho phép body độc lập nhưng không được nhận partial timestamp hay lưu tail đó.
- Restricted/ad/body-unknown/public-only-in-body/header tách cụm/mixed wrappers/body thiếu: tất cả vẫn 0, PASS.
- Legacy `clip:rect(0px, 0px, 0px, 0px)` trên Sponsored: v9 trả 0 cả static/absolute; fixture mới kỳ vọng static vẫn reject vì clip không có hiệu lực, absolute empty clip được bỏ qua. Đây là mô hình synthetic, chưa là bằng chứng CSS Facebook thật.

Frozen fixed script `5f8918c463ad6d57847d5643d6c9527f4761e4bc640825fd74ca0538828e6f57`; compiled controller `ada22e6060613e73688e33ad6f1a85c32437e78c232a20896b8e55caf477974a`; compiled script module `482371fda4eda15410dcbf3992d979177481df9166aa1dbe7cd5f9662a25b59e`; frozen reviewer test `82087dc9d449e800ea9d84424849cbcac0d7c1930ce6e8a64fc21c5cbd42aa53`; reviewer source lúc baseline `2eee9acc88d9bdbba452cbbf279675b3793bef955e4276329ff3fddb60d5cd7d`.

```powershell
node --test --test-name-pattern='review field scope:' .test-build-adapter-candidate/v9-field-baseline/tests/facebook-public-candidate-review.test.js
```

Review v10 sẽ tách assertion classifier khỏi candidate admission: ngày từ quote/body/hidden/partial/whitespace sai vẫn không được matched, nhưng body có public header độc lập có thể được diagnostic admission theo ADR-012. Không thay fixture khó hoặc nới các guard public/body/negative/cluster. Chỉ reviewer files/output; không nguồn thật, runtime, credentials hoặc gate.

## Lịch sử lượt 19 — Local clip v9, R-L1 đã đóng

2026-10-28 Asia/Bangkok. Đọc [handoff v9](../handoffs/p02-local-clip-2026-10-28.md), local/global branch và geometry-shape schema. Fresh strict compile riêng + **57/57 reviewer tests PASS**. R-L1 đã đóng; không có blocker mới tái hiện trong scope. Năm owner files ổn định trước/sau; [manifest](p02-local-clip-files-2026-10-28.json) **13/13owned hashes khớp**, fixed script/compiled controller cùng khớp.

- Feed vàfallback đều chỉ giữ public sample phía sau local unknown; first boundary không có snippet/prefix trong result. Ca riêng unknownfeed→validoutsidearticle chứng minh covered:feedExamined1/mainExamined1/localIncomplete1, fallbackCOMPLETE; không recheck unknownfeed. CLEAR không còn bị gán BARRIER_STOP do local uncertainty.
- Global2500steps, auth/challenge và partial-tail/privacy regressions giữ nguyên. Code chỉ local-skip sau traversal/normalization hoàn tất, visibilityUnknown và không global/probe interruption; global stop vẫnfalse/dừng. Không scroll hoặc nới clipping.
- Geometry shapes kiểm đúng TEMPORAL/BODY, BOUNDS/X/PARTIAL/SUBPIXEL, CLIP_PATH/UNSUPPORTED vàMIXED/GT16/MULTIPLE; samples chưa chứng minh vẫn0. Validator chặn raw text/tọa độ/enumarray/count0 hoặc>2500/>5shapes. Các trường làenum/count; không payload, CSS value hoặc tọa độ tuyệt đối lọt metadata.

Schema assertions8→9/rejectold8. Hai positive baseline lúc đầu có cùng expected/actual array values nhưng `deepStrictEqual` gặp prototype từ VM khác realm; sửa test bằng `Array.from` trước so, **giữ expected duy nhất mẫu sau**, không thay sản phẩm hoặc nới expectation. Thêm hai tests có ý nghĩa cho covered/no-recheck và geometry schema; không mở suite khác.

| Snapshot lượt19 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate.ts` | `5b3548c0e629764274774a6583c38a4a5b1a0d528ba4de2aba68f5a42848eb2c` |
| `src/main/facebook-public-candidate-script.ts` | `b96bdfc1b7dc256b3126453b1f4d9831bc918423e14eb68b72fcd87b77d0c6e1` |
| `src/main/facebook-public-candidate-fields.ts` | `9a12713e07f1f51c8d9d1b8f8e3641fa46a2e92ede0ec479052616b7ba1a9755` |
| `src/main/facebook-public-candidate-fixture.ts` | `981c654f6d13e60bb80c73c50650708a7db8080031f00a162be43428bd779d50` |
| `tests/facebook-public-candidate.test.ts` | `8f104108bc65e37937cc059c949cb37f63fe0f3efa90f5fb63ffd3a7b5bed87e` |
| `tests/facebook-public-candidate-review.test.ts` | `4ebac3b0fe2fe9a6e398729bdaf9d6adbf454675623454b0f5b4e1baa6f18b0e` |
| Fixed script string | `5f8918c463ad6d57847d5643d6c9527f4761e4bc640825fd74ca0538828e6f57` |
| Compiled controller | `ada22e6060613e73688e33ad6f1a85c32437e78c232a20896b8e55caf477974a` |
| Compiled script module | `482371fda4eda15410dcbf3992d979177481df9166aa1dbe7cd5f9662a25b59e` |
| Compiled reviewer tests | `b01024d45bff2bd1e504cf194f5f43880f829c954c8af3c3246c243848a2e5c0` |

Strict compile flags/output riêng giữ nguyên; full57tests cuối chạy `node --test --test-reporter=dot .test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js`, exit0. Chỉ reviewer tests/report/output; không sourceowner/shared dist/runtime/UI/master/README/gates, không đọc tài khoản/credentials hoặc nguồn thật. Không claim fractional bounds là nguyên nhân Facebook; lead giữ activation/read. Reviewer chốt và dừng.

## Lịch sử lượt 18 — Local-stop baseline v8, R-L1 từng mở

Theo [dispatch local clip](../handoffs/lead-p02-local-clip-dispatch-2026-10-28.md) và [LIVE v8](p02-live-clip-scope-v8-2026-10-28.md). Giữ compiled v8 trong `.test-build-adapter-candidate/v8-local-baseline/` trước owner sửa. Strict compile riêng PASS; **3 targeted tests=1PASS/2FAIL**; không lặp unrelated suite.

**R-L1/P2 — Local geometry unknown dừng xét boundary sau và bị ghi như barrier.** `examine` nhánh incomplete trảfalse, feed/fallback caller dùng nó để ngừng scan; cùng đường fallback kết thúc BARRIER_STOP. Repro first post chỉ có clip-path unknown cục bộ trong body, kế sau là một public post hoàn chỉnh đã tải:

- Trong feed:0sample/examined2/64visits, fallbackBARRIER_STOP trong khi barriersCLEAR. Boundary sau chưa được nhận; first boundary có thể bị recheck thay vì tiếp tục.
- Qua fallback articles:0sample/examined7/77visits, cũngBARRIER_STOP/CLEAR. Expected chỉ mẫu public sau, không lưu prefix/body của first unknown; không cần scroll hoặc tăng cap.

Negative test PASS: global partial2500steps dừng tại examined1, auth password dừng trước examined, FORM challenge dừng tại examined1; đều không đọc/lưu candidate sau hoặc nội dung partial. Baseline chưa thay clipping predicate hay suy rounding là nguyên nhân. Geometry shapes mới sẽ được kiểm khi contract ready.

| Frozen local baseline lượt18 | SHA-256 |
| --- | --- |
| Source controller lúc capture | `4012f9a7182073398b536d6bb5e028f642f28dcebb3a0ffe06b604ab3a951dcc` |
| Source script lúc capture | `5ddeac6a70d1a9cd01b272557265ce6834639ad16ee82d3bcd30c8b34a402423` |
| Reviewer source | `7926a0c003bf39907aed3b9e1e46fe4250e686eaf93041e6a27982e42dff5627` |
| Fixed script string | `8be71fd65de32c340eaa7fd8b9f024b1588e32078bb18dee2c755755a73b9361` |
| Frozen compiled reviewer tests | `5008440a88ae1b16fe2462789a79ad371446644fef0112736c24187142e69704` |

```powershell
node --test --test-name-pattern='review local:' .test-build-adapter-candidate/v8-local-baseline/tests/facebook-public-candidate-review.test.js
```

Đã báo lead, chờ code-ready. Chỉ reviewer tests/report/output riêng; không implementation/shared dist/runtime/UI/master/README/gates hoặc nguồn thật.

## Lịch sử lượt 17 — Clip scope v8 review độc lập đạt

2026-10-28 Asia/Bangkok. Đọc [handoff v8](../handoffs/p02-clip-scope-2026-10-28.md), `extendClip`/`textClip`/seed và các điểm propagation candidate/control/discovery. Fresh strict compile riêng + **52/52 reviewer tests PASS**; không có blocker mới tái hiện trong scope. Source5files ổn định trước/sau, [manifest](p02-clip-scope-files-2026-10-28.json) **14/14owned hashes khớp**, fixed script và compiled controller của reviewer cũng khớp.

- Hai positive baseline dưới40wrappers đều1sample, trong global2500, unknown0/ancestorMisses0; có propagation/cache hits. Không tăng text96/cluster8 hoặc bỏ ancestor clipping.
- Seed xét main/feed từ ancestry đã có; `extendClip` clone frame từ parent, không mutate sibling. Unresolved seed cache vẫn có reasonANCESTOR, không mặc định visible. Đã đọc owner unit cache-unresolved synthetic (1seed miss/≤32steps) như evidence bổ sung, không gọi đó là independent reviewer fixture/native result.
- Negative clip/partial/unknown ở ancestor ngoài feed/candidate, sibling isolation, partialtail, excessiveRange, R-V1, quote/body/private, R-T1–3/whitespace/96–97 và late/Stop giữPASS. Các test reason mới xác nhận API, rect, unsupported clip vàpartial clip được phân biệt; không gán một reason cho mọiunknown.
- Schema assertions7→8 và rejectold7 đúng contract. Không thay expected sample/content.

Lượt đầu51/52PASS, failure duy nhất fixture1500feed-padding đã chạmcap trước fallback vì mỗi element nay có style/context charge. Giảm paddingfeed xuống500 để **vẫn đi đủ feed→discovery→candidate recheck** rồi PARTIAL tại2500; thêm assertfeedExamined1/mainExamined>0 và giữ no payload/partial-boundary. Barrier-budget fixture tính padding theo observed compact cost và extra-empty-element cost (v8 có cảwalk+clip), chừa16visits trước khi thêm32barrier visits; cùng invariant shared cap vẫnPASS. Đây là giữ test đúngphase, không nới capacity hoặc enumPARTIAL thànhNOT_USED.

| Snapshot lượt17 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate.ts` | `4012f9a7182073398b536d6bb5e028f642f28dcebb3a0ffe06b604ab3a951dcc` |
| `src/main/facebook-public-candidate-script.ts` | `5ddeac6a70d1a9cd01b272557265ce6834639ad16ee82d3bcd30c8b34a402423` |
| `src/main/facebook-public-candidate-fields.ts` | `9a12713e07f1f51c8d9d1b8f8e3641fa46a2e92ede0ec479052616b7ba1a9755` |
| `src/main/facebook-public-candidate-fixture.ts` | `e34ec5723f2176763c72131ec09be42e931339cc62de17c40ba59134de96592d` |
| `tests/facebook-public-candidate.test.ts` | `bff5a14913a324a317955143aadb8ad5671a26220c7f8f94d3e1383053cda93c` |
| `tests/facebook-public-candidate-review.test.ts` | `794fc358d9a0eab30406efa3bddf4034b2b105175bbe8a8442b2b2a93359e2f4` |
| Fixed script string | `8be71fd65de32c340eaa7fd8b9f024b1588e32078bb18dee2c755755a73b9361` |
| Compiled controller | `f2e969328da8725a69ba4dc091f32bb6d7b4166ffcfcf2c23bbd0506568f5c1c` |
| Compiled script module | `de0d3f32eeb1652ff317bbc95e10e0819c56a5dd3c3a6043fe2664fbef6d7bc5` |
| Compiled reviewer tests | `78bfeea2664ad2a5867d5d2559d0bb9fc7b387fed35b36dacd6aff6c411fb9e1` |

Lệnh strict compile giữ nguyên;52tests cuối chạy bằng `node --test --test-reporter=dot .test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js`, exit0. Chỉ reviewer tests/report/output riêng, không sourceowner/shared dist/runtime/UI/master/README/gates hoặc native/live. Không claim toàn61unknown thật đã được giải quyết; lead giữ activation/read. Reviewer đã chốt bàn giao và dừng.

## Lịch sử lượt 16 — Clip-scope baseline v7

Theo [dispatch clip scope](../handoffs/lead-p02-clip-scope-dispatch-2026-10-28.md) và [LIVE v7](p02-live-text-visibility-v7-2026-10-28.md). Giữ compiled v7 trong `.test-build-adapter-candidate/v7-clip-baseline/` trước owner sửa; **8 targeted tests=6PASS/2FAIL**. Không thay kết luận R-V1 của lượt15, không lặp suite rộng.

Hai positive fixture dùng Range rects hợp lệ, không lỗi API/rect:

- Post nằm dưới40wrappers đã đi qua:0sample,328visits,unknown6,clipChecks0, không node cap.
- Cùng40wrappers với80visible sibling text nodes thuộc một date link:0sample,2500visits/nodeLimittrue,unknown69,clipChecks0. Có80chars dưới96, không cần tăng text cap. Sốunknown có thể gồm attempts/recheck, không unique text nodes.

Đây là repro trực tiếp của `textClip` v7 dò32ancestor tới cache/body rồi không cache khi chưa resolve; nhiều sibling lặp chi phí. Chỉ chứng minh cơ chế này có thể gây budget exhaustion. Không khẳng định61unknown của nguồn thật đều là ancestor, cũng không biến unknown thànhvisible.

Negatives đãPASS: clip/partial/unknown geometry ở ancestor **ngoài feed/candidate**, partialtail, sibling cache isolation, excessRange, R-T2 deep invalidtail/R-T3whitespace. Test cũ gộp known-traversal depth35 vào unknown được tách: depth lớn trong traversal đã biết nay là positive của dispatch;9Range-rect negative vẫn0. Không bỏ clipping ancestor hoặc nới global2500/cluster8.

| Frozen baseline lượt16 | SHA-256 |
| --- | --- |
| Source controller lúc capture | `36dcff9dc42810bba578c9cad22f7622ec2a5853f2e943b5d22c84e767cea676` |
| Source script lúc capture | `40563a969363ebc3db8540a1ca28b26df11a307959327c31bcb9d5135d49e013` |
| Reviewer source | `87b14c5002de1f4d592f0ce4315856c2ec905e8757273b1028a20e6a5bf85995` |
| Fixed script string | `6d33353891fce4612a4e99201ad357b0f043905e997f6a1e59365ef570aa4cba` |
| Frozen compiled controller | `2d757df0e098439e84304412d46ad5efca0b1aeb3c9d6289691e16fe9387c2b4` |
| Frozen compiled script module | `132f5704e2f612c0e993aa4d93e1b00d84d2cdd2950a5c842fb0459ba69b1e60` |
| Frozen compiled reviewer tests | `c492ff655b39091d2217327aa0f843dfab5720a747ea83582d4a31abb42567df` |

```powershell
node --test --test-name-pattern='review clip scope:|review visibility: fully clipped|partial or unknown|excessive Range|deep invalid tail|whitespace text' .test-build-adapter-candidate/v7-clip-baseline/tests/facebook-public-candidate-review.test.js
```

Hai positive assertions có thêm message enum/count để lead tái hiện cost, không payload. Đã gửi lead; chỉ reviewer files/output riêng, không source edits/shared dist/runtime/UI/master/README/gates. Dừng chờ code-ready.

## Lịch sử lượt 15 — V7, R-V1 đã đóng

2026-10-28 Asia/Bangkok. Đã đọc geometry/clip/cache và schema7, fresh strict compile riêng + **49/49 reviewer tests PASS**. R-V1 được sửa; chưa có blocker mới tái hiện trong scope. Đã nhận biết source/owner test đổi trong lúc review do guard Range-list length, đọc phần sửa rồi fresh compile/rerun lại. Năm owner files ổn định qua lượt cuối; kết luận gắn hashes dưới đây, không dùng snapshot trước guard để gán cho bản mới.

- Parent box không còn thay Range proof: text empty/zero-area và Range missing/throw không làm temporal; body chỉ giữ text có geometry. Date visible cạnh110noise không render vẫn1sample, char/node limits0.
- Full clip của sibling bị bỏ mà không truyền clip frame sang sibling visible; kiểm cả hai thứ tự. Partial clip, clip-path, transform+overflow hoặc thiếu clip geometry làm unknown/toàn record thiếu, không giữ prefix date. Overflow32ancestor không cache và Range9rects cũng unknown/no payload.
- R-T1–3, deep/fragmented date,96/97limits, private/footer/ad/quote/body/embedded, schema/summary/lifecycle/late vẫnPASS. Native/layout proof thuộc owner; VM chỉ xác nhận hành vi từ geometry fixture đã khai báo. Không suy colortransparent là hidden hoặc tự xác nhận nguyên nhân Facebook.

Harness bổ sung đúng API clip `getBoundingClientRect`/client metrics, explicit Range rects; whitespace được mô phỏng có area, không mặc định dùng `.trim()` biến mọi whitespace thành invisible. Fixtures96/97 dùng whiteSpacepre để mô tả whitespace render. Zero-area vẫn width0/height0, không fake positive bằng rect thiếu chiều. Schema assertions6→7, rejectold6; expected content/boundary không nới.

Fixture budget cũ2475empty nodes nay tự vượt2500 vì geometry được charge thêm. Lượt đầu45/46PASS, chỉ failure đó; lead đồng ý hiệu chỉnh padding theo observed compact-candidate cost, chừa16visits. Candidate riêng vẫn đủ; cùng candidate +16barriers/32ancestryvisits chạm2500, partial và không có payload. Invariant shared budget giữ nguyên, không yêu cầu owner giảm charge để làm xanh test.

| Snapshot lượt15 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate.ts` | `36dcff9dc42810bba578c9cad22f7622ec2a5853f2e943b5d22c84e767cea676` |
| `src/main/facebook-public-candidate-script.ts` | `40563a969363ebc3db8540a1ca28b26df11a307959327c31bcb9d5135d49e013` |
| `src/main/facebook-public-candidate-fields.ts` | `9a12713e07f1f51c8d9d1b8f8e3641fa46a2e92ede0ec479052616b7ba1a9755` |
| `src/main/facebook-public-candidate-fixture.ts` | `b03edd96450d3f0acc8c17d67c5b97d739bd6e7f0aa66e8097570dd2a751fbb0` |
| `tests/facebook-public-candidate.test.ts` | `26fbf609d0ea688b2af8eb11958d8e94b05dab4c68d66b73258c7f7d976f9fe4` |
| `tests/facebook-public-candidate-review.test.ts` | `63b23025ddb6fbdd01a3de174a5acd1c747d1e8ad32fd6e638aa6b8efd4af370` |
| Fixed script string | `6d33353891fce4612a4e99201ad357b0f043905e997f6a1e59365ef570aa4cba` |
| Compiled controller | `2d757df0e098439e84304412d46ad5efca0b1aeb3c9d6289691e16fe9387c2b4` |
| Compiled script module | `132f5704e2f612c0e993aa4d93e1b00d84d2cdd2950a5c842fb0459ba69b1e60` |
| Compiled reviewer tests | `7e68ec427138f85c0f533397f28de13d2c9b79cceb030da153a495fc0452dcd9` |

Lệnh strict compile giữ nguyên; full49tests chạy lại cuối bằng `node --test --test-reporter=dot .test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js`, exit0. Sau owner bàn giao, đã đọc [handoff v7](../handoffs/p02-text-visibility-2026-10-28.md) và đối chiếu [manifest](p02-text-visibility-files-2026-10-28.json): **14/14 owned hashes khớp**, fixed script và compiled controller của reviewer cùng khớp. Không rebuild hoặc lặp tests sau đối chiếu vì source giữ nguyên. Chỉ reviewer tests/report/output riêng; không native/live/UI/shared dist/runtime/master/README/gates. Lead giữ quyết định activation/read; reviewer đã bàn giao và dừng.

## Lịch sử lượt 14 — Text visibility baseline v6, R-V1 từng mở

Theo [dispatch text visibility](../handoffs/lead-p02-text-visibility-dispatch-2026-10-28.md) và [LIVE v6](p02-live-temporal-scope-v6-2026-10-28.md). Giữ compiled v6 trong `.test-build-adapter-candidate/v6-visibility-baseline/` trước owner sửa. Strict compile riêng PASS; **10 targeted tests=6PASS/4FAIL**. Không lặp unrelated suite; kết quả42PASS lượt13 không thay thế4geometry regressions mới.

### R-V1/P2 — Parent có box bị dùng thay bằng chứng geometry của text

Vị trí v6 frozen `src/main/facebook-public-candidate-script.ts:33–36`: `visibleText` trảtrue ngay khi parent RENDERED; layout chỉ xét rect count nên predicate không chứng minh area của text. Reviewer VM fixtures khai báo Range[] hoặc rectwidth0/height0 cho chính text node, trong khi parent vẫn có box10×10:

- Empty vàzero-area date text đều làm outer post có1sample thay expected0.
- Visible date cạnh110noise fragments không có text area bị char/text-node limit và0sample thay expected1. Không mở cap để làm case này xanh.
- Body có một text visible cùng hai text empty/zero-area giữ cả hai đoạn không render trong snippet, thay vì chỉ visible text.
- Range API missing/throw cũng vẫn1sample khi parent có box, thay expected0/thiếu evidence.

Đây là4test failures của cùng predicate; chưa khẳng định4lỗi riêng hoặc nguyên nhân Facebook. VM fixture chứng minh nhánh code bỏ qua geometry được cấp; không phải native Chromium proof rằng mọi hidden/clipped/font pattern đều sinh rect đó. Chưa dựng clipping/transparent/font assumptions không có bằng chứng. Owner chịu native fixture để xác minh từng pattern sửa.

Six targeted regression tests vẫnPASS: R-T2 deep invalid tail, R-T3 whitespace,96/97caps/schema, deep scope, fragmented date và scope negatives quote/heading/body/comment/nested-story-link. Body/date expected không đổi. Harness thêm tùy chọn Range empty/zero-area/missing/throw, không tạo fake visibility positive từ rect thiếu width/height.

| Frozen visibility baseline lượt14 | SHA-256 |
| --- | --- |
| Source controller lúc capture | `dd2773326ea225b2e4023688c8423abbfb4cebfabc8bfe751c4addff62df4980` |
| Source script lúc capture | `576b92fd9050ec8ccaa45394116bd2a8f7adc01edfbc0c65541e484458787845` |
| Reviewer test source | `073f233069c9cecc8109407b30c7a19812c14ede2e60eef414ea00700474fc20` |
| Fixed script string | `cde0d7ac60865910ba4d5eddae5252542a6ba67eb99b7734d6dca474130cb462` |
| Frozen compiled controller | `3173cd4847594a8c4d153a6e76e9a0942cd394ff6bb028deeef3ccdc4396b15f` |
| Frozen compiled script module | `284bd4cc229a628aa4aacd8c846004e2305075aef45a5365711cdb74f6f6c935` |
| Frozen compiled reviewer tests | `e8f87e0d03bd28bfdd7573bdcf64e586777edbdd37870540292edc93771a7b75` |

```powershell
node --test --test-name-pattern='review visibility:|deep invalid tail|whitespace text nodes|text, record and control|review scope:' .test-build-adapter-candidate/v6-visibility-baseline/tests/facebook-public-candidate-review.test.js
```

Đã báo lead; chờ code-ready. Không native/live/UI/source reads/shared dist/runtime/master/README/gates hoặc owner source edits.

## Lịch sử lượt 13 — Scope v6 review độc lập đạt

2026-10-28 Asia/Bangkok. Đọc [handoff v6](../handoffs/p02-header-temporal-scope-2026-10-28.md), script scope/append/finish và schema/limits. Fresh strict compile riêng và **42/42 reviewer tests PASS**. Không có blocker mới tái hiện trong scope này. Đổi3positive version assertions5→6 và kiểm rejectold5; mọi expected sample/privacy/boundary giữ nguyên.

- Hai gaps baseline đã đạt: visible date dưới10wrappers có owner đã biết và date20chars chia20textnodes đều1sample. Header cluster vẫn8ancestor, không tăng scope tới feed/main. Collector lấy WeakMap owner trong charged walk, không search ancestor mới hoặc dùng `.textContent`.
- Bổ sung đúng ngưỡng trong test hiện có:96chars/96textnodes vẫn nhận temporal;97chars/97nodes loại record và không giữ body. Char-only overflow, record cap16 và control probe64 đều bị loại với reason counters tương ứng. R-T2 deep invalid tail được đọc whole string rồi classifierMisses>0/0sample; R-T3 whitespace giữ0sample.
- R-T1 quote và deep scope quote/heading/body/comment/nested-story-link vẫn0sample; private/footer/ad/hidden/cluster/embedded/alias/barrier/late/Stop/identity/contact regressions giữPASS. Counts mới chỉ metadata; validator chặn raw temporal text và array giả count. Không đồng nhất scopeMisses với một date bị cắt.

Năm owner source/test hashes trước/sau khớp. Fixed script string/compiled controller khớp manifest v6. Chỉ reviewer tests/report/output riêng thay đổi; không native/live/runtime/shared dist/master/README hoặc gates. Kết quả fixture không xác nhận shape timestamp thật hay đủ giải quyết LIVE; activation/read tiếp thuộc lead.

| Snapshot lượt13 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate.ts` | `dd2773326ea225b2e4023688c8423abbfb4cebfabc8bfe751c4addff62df4980` |
| `src/main/facebook-public-candidate-script.ts` | `576b92fd9050ec8ccaa45394116bd2a8f7adc01edfbc0c65541e484458787845` |
| `src/main/facebook-public-candidate-fields.ts` | `9a12713e07f1f51c8d9d1b8f8e3641fa46a2e92ede0ec479052616b7ba1a9755` |
| `src/main/facebook-public-candidate-fixture.ts` | `f284a356c47f57e2f2d75f5e4d4dd4940a0455364859d83d04d3e4e1059f2aab` |
| `tests/facebook-public-candidate.test.ts` | `0c968af8085105ce9c9b56449bf7edf4c1887dfd77b5b51e6e6a53bfbf7bd321` |
| `tests/facebook-public-candidate-review.test.ts` | `8642b0b5824c3e0da4dbed0842b35346bee21b8065656e26ba67e9212a8bb089` |
| Fixed script string | `cde0d7ac60865910ba4d5eddae5252542a6ba67eb99b7734d6dca474130cb462` |
| Compiled controller | `3173cd4847594a8c4d153a6e76e9a0942cd394ff6bb028deeef3ccdc4396b15f` |
| Compiled script module | `284bd4cc229a628aa4aacd8c846004e2305075aef45a5365711cdb74f6f6c935` |
| Compiled reviewer tests | `1776b13dbcf611e51953c91a0fd594b3b9ceff45d4695312b100c6d26cde2431` |

Lệnh compile/test toàn reviewer và output `.test-build-adapter-candidate` giữ nguyên. Tests/hashes đã chốt, báo lead rồi dừng chờ.

## Lịch sử lượt 12 — Scope baseline v5

Theo [dispatch scope](../handoffs/lead-p02-temporal-scope-dispatch-2026-10-28.md) sau [LIVE v5](p02-live-header-temporal-v5-2026-10-28.md), đã giữ compiled snapshot đã nghiệm thu trong `.test-build-adapter-candidate/v5-scope-baseline/` trước owner sửa. Chạy **6 targeted tests=4PASS/2FAIL**, không lặp suite rộng. Hai positive mới đều0sample thay expected1: timestamp hoàn chỉnh sau10wrappers trong header A đã biết scope; ngày20chars được tách thành20SPAN/text nodes. Cùng header cluster không đổi hoặc tăng8ancestor. Đây là gaps code có repro, chưa chứng minh nguyên nhân duy nhất của nguồn thật.

R-T2 deep invalid tail vàR-T3whitespace vẫn0sample; các inherited-scope negatives quote/heading/body/comment/nested-story-link đều0. Cap/schema negative test vẫnPASS. Theo thay đổi contract đã được lead chốt: bỏ **riêng** assertion `ancestorLimits>0` của R-T2 vì collector mới không bắt buộc ancestor search; giữ expected0 và không có body được lưu. Text-node cap negative chuyển từ17 lên97 để kiểm contract96 mới; cap96chars/global2500 không nới. Không đổi các behavioral expectations khác. Cần đối chiếu reason counters mới khi code/schema ready, không tự dựng schema giả.

| Frozen scope baseline lượt12 | SHA-256 |
| --- | --- |
| Source controller lúc capture | `6358415a68977d7ef80229f4311c4c46ca0df0dfb4347840950d8a2ac4e20cba` |
| Source script lúc capture | `2a78945e33b7744ef3603fc87f8cfa964c4482baff1815fe21821b898d65749d` |
| Reviewer test source | `533c1ba24ad3f58b85627ac681cc0d0fd3d76cf357e7fdd8c3dce24b65eb929e` |
| Fixed script string | `31ace7d597525c40bcba193762109f5e308a8d7d3774b57b4589f3786f7260c2` |
| Frozen compiled controller | `76cbbb7e632eb8388d0ac0d6e89ba5e450e7bdb74e3ccb18b6edc9510276469b` |
| Frozen compiled script module | `8e1e1e0c449e0040ec32e34879e5d6ffb2af9e8094e1437aa245e2f37589df64` |
| Frozen compiled reviewer tests | `ca0f83db743191112d6851e082579038e57828bb5df64981d1d1e73beba2698b` |

```powershell
node --test --test-name-pattern='review scope:|deep invalid tail|whitespace text nodes|text, record and control' .test-build-adapter-candidate/v5-scope-baseline/tests/facebook-public-candidate-review.test.js
```

Đã báo lead kết quả; chờ code-ready. Chỉ reviewer tests/report/output riêng, không implementation/shared dist/runtime/master/README/gates hoặc đọc nguồn thật.

## Lịch sử lượt 11 — V5 sau fix R-T2/R-T3

2026-10-28 Asia/Bangkok. Đọc phần fix trong [handoff](../handoffs/p02-header-temporal-2026-10-27.md) và [manifest mới](p02-header-temporal-fix-files-2026-10-28.json); fresh strict compile riêng và **39/39 reviewer tests PASS**. Không thay test source hoặc expectations từ snapshot failed lượt10. R-T1 và8temporal baseline,28regressions,3checks mới đều đạt. Không có blocker mới tái hiện trong scope fix này; chưa phải kết luận nguồn thật/P02.02 DONE.

Đã đọc `facebook-public-candidate-script.ts:145–156,182,221`: registered temporal record có WeakMap scope riêng, được truyền theo parent của các element đã walk. Khi text không nối đến root trong8ancestor, record của scope đó bị limited, không được match prefix. Không đi thêm ancestor hoặc truyền state qua sibling không cùng scope. Visible whitespace-only nodes được thu bằng raw string thay điều kiện normalized sample; vẫn qua giới hạn96chars/16nodes. Hai regression R-T2/R-T3 nay trả0sample như expected. Các positive nested/split/boxless/role-link cùng counterpart Friends vẫn đạt; cap/schema checks không bị nới.

Năm owner source/test hashes trước/sau review khớp. Fixed script string và compiled controller khớp manifest mới. Reviewer chỉ ghi report; không thêm suite hoặc đổi source/test, không native/live/runtime/shared dist/master/README/gates. Failed frozen snapshot lượt10 vẫn giữ để đối chiếu lịch sử.

| Snapshot lượt11 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate.ts` | `6358415a68977d7ef80229f4311c4c46ca0df0dfb4347840950d8a2ac4e20cba` |
| `src/main/facebook-public-candidate-script.ts` | `2a78945e33b7744ef3603fc87f8cfa964c4482baff1815fe21821b898d65749d` |
| `src/main/facebook-public-candidate-fields.ts` | `9a12713e07f1f51c8d9d1b8f8e3641fa46a2e92ede0ec479052616b7ba1a9755` |
| `src/main/facebook-public-candidate-fixture.ts` | `5a6e3fb012a4d7c70323cead8768b69493055a6eaf869d9eed9e84b0cf0d10a0` |
| `tests/facebook-public-candidate.test.ts` | `e18e988f3374ec59dea7fc9133292ed12154086c942be0a07183ec484f573987` |
| `tests/facebook-public-candidate-review.test.ts` | `591fbd49312cb47ed65c166cf197d68608352c0759856fb00d3fd19c9106f53f` |
| Fixed script string | `31ace7d597525c40bcba193762109f5e308a8d7d3774b57b4589f3786f7260c2` |
| Compiled controller | `76cbbb7e632eb8388d0ac0d6e89ba5e450e7bdb74e3ccb18b6edc9510276469b` |
| Compiled script module | `8e1e1e0c449e0040ec32e34879e5d6ffb2af9e8094e1437aa245e2f37589df64` |
| Compiled reviewer tests | `3af9c1aabb47d38a88e836f5d8dff46adc4b09be243b5493b2e09812e8693d2f` |

Lệnh compile/test và output `.test-build-adapter-candidate` giữ nguyên. Báo lead đủ evidence đóng finding; activation/đọc nguồn tiếp thuộc lead, reviewer dừng chờ.

## Lịch sử lượt 10 — V5 trước fix R-T2/R-T3

Đọc [handoff v5](../handoffs/p02-header-temporal-2026-10-27.md), source và manifest. Strict compile riêng PASS; final **39 reviewer tests =37PASS/2FAIL**. 28regressions trước +8temporal baseline +1cap/schema test PASS. Chỉ đổi3assert schema version4→5 theo contract mới; giữ mọi assertion hành vi. Lượt chạy đầu trước đổi schema là33/36PASS,3FAIL đều do version. R-T1 BLOCKQUOTE/Q đã đóng;5positive baseline đều chạy hết, gồm counterpart Friends không nhận sample.

### R-T2/P2 — Ancestor-limited tail không vô hiệu hóa prefix temporal

Vị trí v5 frozen `src/main/facebook-public-candidate-script.ts:154,169,219`. `collectTemporal` chỉ tăng ancestorLimits khi không tìm thấy registered link trong8ancestors, nhưng record đã giữ text trước đó vẫn eligible. Repro: header A có text `2 giờ`, sau đó8wrapper DIV +SPAN chứa visible ` NOT_A_TIMESTAMP`. Actual ancestorLimits>0 nhưng **SAMPLES_READY/1sample**; expected không promote date prefix từ phép đọc thiếu. Đây là thiếu tính toàn vẹn chuỗi temporal, không phải yêu cầu tăng ancestry cap.

### R-T3/P2 — Bỏ whitespace-only node ghép sai number tokens

Vị trí v5 frozen `src/main/facebook-public-candidate-script.ts:219`: điều kiện `&&sample` loại text node mà normalized text rỗng trước `collectTemporal`. A có SPAN(`1`), textspace, SPAN(`2 giờ`) có whole rendered text `1 2 giờ`; chuỗi thu được lại `12 giờ`, classifier nhận và trả **1sample**. Expected0. Cần giữ ranh giới whitespace trong collection có giới hạn; không nới whole-string classifier để hợp thức hóa chuỗi bị thay đổi.

Cả hai finding đều có fixture tái hiện, chưa biết có đúng DOM Facebook thực. Đã báo lead ngay để owner sửa. Không gán chúng thành nguyên nhân LIVE NO_TEMPORAL hoặc tuyên bố leak/nguồn đã được xác nhận public.

### Checks đã đạt và snapshot giữ lại

Cap/schema test độc lập PASS: tail text vượt96chars, hơn16textnodes, đăng ký quá16linkrecords, control probe vượt64nodes đều không promote candidate chưa hoàn tất; metadata textLimits>0/probeNodes64 đúng. Các schema âm version4, raw temporal text, enum-count array đều bị validator reject. Fixture dài dùng non-whitespace tail để tách khỏi R-T3. Barrier/privacy/late/Stop/shared2500/quote/hidden/cluster regressions đều PASS.

Owner source5files khớp hashes trước/sau final failed run. Sau đó lead cho owner sửa; kết luận này gắn **compiled frozen snapshot** `.test-build-adapter-candidate/v5-temporal-failed/`, không phụ thuộc source hiện đang được sửa. Copy giữ nguyên compiled module hashes, không rebuild nó.

| Failed snapshot lượt10 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate.ts` | `6358415a68977d7ef80229f4311c4c46ca0df0dfb4347840950d8a2ac4e20cba` |
| `src/main/facebook-public-candidate-script.ts` | `4883a8e1070d4585702296e31390cb6a08d9183b7d43d3be3d7885369a03b9c3` |
| `src/main/facebook-public-candidate-fields.ts` | `9a12713e07f1f51c8d9d1b8f8e3641fa46a2e92ede0ec479052616b7ba1a9755` |
| `src/main/facebook-public-candidate-fixture.ts` | `82ad67ff1b7c3d4cc4dcb062230ba5785aebe02790d117291c7e40478e6f52c0` |
| `tests/facebook-public-candidate.test.ts` | `d203a00c631fee4559b05d5af8698edbf2db2e7a733efea964ba00c8cc8f55f1` |
| `tests/facebook-public-candidate-review.test.ts` | `591fbd49312cb47ed65c166cf197d68608352c0759856fb00d3fd19c9106f53f` |
| Fixed script string | `4e4e15c6ebbe8d5d2d51df177cb27760d59b9b6fc63e750e2b64b809860e0637` |
| Frozen compiled controller | `76cbbb7e632eb8388d0ac0d6e89ba5e450e7bdb74e3ccb18b6edc9510276469b` |
| Frozen compiled script module | `7b19103f89f0848e2bbb8852f28b49bfd2dcce3d711bcad7f8c5c2adebd267be` |
| Frozen compiled reviewer tests | `3af9c1aabb47d38a88e836f5d8dff46adc4b09be243b5493b2e09812e8693d2f` |

Lead có thể tái chạy đúng2finding mà không compile/source mới:

```powershell
node --test --test-name-pattern='ancestor-limited text tail|whitespace text nodes' .test-build-adapter-candidate/v5-temporal-failed/tests/facebook-public-candidate-review.test.js
```

Không chạy native/live, không source edits/shared dist/runtime/master/README/gates. Tests đã chốt; chờ fix-ready, không polling hoặc mở suite khác.

## Lịch sử lượt 9 — Temporal baseline v4

Theo [dispatch temporal](../handoffs/lead-p02-header-temporal-dispatch-2026-10-27.md) và [LIVE v4](p02-live-overlay-v4-2026-10-27.md), đã giữ compiled v4 trước owner sửa trong `.test-build-adapter-candidate/v4-temporal-baseline/src`. Fixed script vẫn `55eb05c7…c699e`; controller/script source không thay đổi qua lượt baseline. Chỉ chạy **8 targeted temporal tests:2PASS/6FAIL**, không lặp28tests không liên quan và không thay kết luận R-O4 của lượt8.

Năm gaps dương đều tái hiện `samples0` thay expected1, trong khi cùng header với direct anchor text cho1sample: nested span trong A; text chia qua nhiều node trong A; role-link; A có rolebutton với text temporal; anchor/child display:contents có text render được. Đây là coverage gaps của code v4 theo fixture, chưa xác định loại nào là DOM của ngày giờ trên Facebook thật. Assertion positive dừng trước counterpart Friends ở các ca này; không claim counterpart đó đã chạy trong lượt baseline.

### R-T1/P2 — Ngày trong quote ở header được nhận như thời gian bài ngoài

Vị trí snapshot v4 `src/main/facebook-public-candidate-script.ts:146–150,174`: inspect prune ARTICLE/comment/control/navigation, nhưng chưa loại BLOCKQUOTE/Q trong header. Nhánh text temporal nhận A trực tiếp mà không phân biệt ancestor quote. Repro synthetic: cùng HEADER có H3 +Public badge +BLOCKQUOTE chứa A với text ngày tương đối; body ở ngoài quote. Actual **SAMPLES_READY/1sample**. Q counterpart cũng1sample. Không có TIME/ABBR hoặc temporal label khác.

Test chạy hết5variants trước khi assert: body/comment/embedded ARTICLE đều0; BLOCKQUOTE vàQ đều1. Tác động cụ thể là tín hiệu ngày từ trích dẫn được gán nhầm cho bài ngoài, không chứng minh leak hay source parser đã gặp trường hợp đó trong LIVE. Đã báo lead để owner sửa cùng boundary temporal, không nới expectation nhằm lấy thêm sample.

Hai negative tests PASS: hidden span/hidden unit/hidden ancestor/ordinary button/plain text không tự cấp temporal; heading và date/public thuộc hai header riêng hoặc wrapper chứa hai bài không được ghép. Giữ giới hạn hiện tại, chưa yêu cầu tăng depth/cap hoặc duyệt mọi button.

| Temporal baseline lượt9 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate.ts` | `4883b0cc012fb4f5c3dcc6ea738f58db63a5daf6dbd31c14fcbe412d9f09ba05` |
| `src/main/facebook-public-candidate-script.ts` | `fa32eb37704c2e87d671d1e275e96716898156e8bac5a229834e8c374f5aedd4` |
| `tests/facebook-public-candidate-review.test.ts` | `45d0697b6e433ac71503d1a583376285c045a2fb6d81785b130ff6ae55099a70` |
| Frozen fixed script string | `55eb05c71a39f90f9a350ea122258b23bfe98ec0c6f86edde5173f74466c699e` |
| Frozen compiled controller | `fdff7e8783f82b663a47d67afc05ae30750e9370a628ff63c8589edb5412feba` |
| Frozen compiled script module | `7818921bd689c6feb6137028bf14d3127b12a007a8d17d8805948dc23002778a` |
| Frozen compiled reviewer tests | `7dabf9da40e40096a2894ebc9ed0579db390612676118ed2189cf3eccdf79fea` |

Strict compile flags giữ nguyên. Test JS mới được copy vào frozen baseline `tests/`, dùng imports từ frozen `src/`, rồi chạy:

```powershell
node --test --test-name-pattern='review temporal:' .test-build-adapter-candidate/v4-temporal-baseline/tests/facebook-public-candidate-review.test.js
```

Chỉ thay reviewer tests/report và output riêng. Không source edits, shared build, runtime, session, source reads hoặc gates. Chờ lead báo code-ready để review một snapshot mới, không polling.

## Lịch sử lượt 8 — R-O4 đã đóng trên snapshot v4 sau fix

Fresh strict compile riêng PASS; **28/28 reviewer tests PASS** =26 tests đã chốt giữ nguyên expectations +2 tests direct FORM. Không có blocker mới tái hiện trong phạm vi review này. R-O4 đã được sửa: validator kiểm status/state/kind/evidence/count hai chiều; metadata CLEAR/NOT_STARTED hoặc status không tương ứng không được nhận như kết quả hợp lệ. Phần kiểm auth/challenge/denied/schema của test26 nay chạy hết, khác lượt7 đã dừng ở assertion đầu.

Đã đọc `facebook-public-candidate.ts:97–109`, `facebook-public-candidate-script.ts:44–45,169–171,190` và chạy fixed script thật trong VM fixture của reviewer:

- FORM chứa challenge/denied literal tại header hoặc body không có rolealert/dialog/input/iframe, XPath reads[]; đều đi nhánh text guard trong extraction và trả VISIBLE/inspected1/visible1 với kind/evidence đúng. Result đã qua validator.
- Có một post hợp lệ được xét trước FORM ở post thứ hai (examined2). Khi FORM chặn, sample trước đó bị xóa; cả nội dung đã staged lẫn literal FORM, author, URL không có trong result metadata.
- 15 empty alerts trước main +FORM →inspected16/VISIBLE. 16 empty alerts +FORM →inspected16/INCOMPLETE/CANDIDATE_LIMIT, visible0/kindNONE/evidenceNONE. Đây là quota dùng chung, không phải XPath sentinel (overflowfalse); samples trước đó cũng bị xóa.
- Giữ regression reject đổi VISIBLE thành CLEAR, thêm NOT_STARTED/INCOMPLETE giả và status không còn barrier nhưng vẫn mang VISIBLE. Không thay expectation nhằm làm xanh test.

Controller/script/owner test SHA-256 trước và sau lượt này khớp. Fixed script và compiled controller khớp snapshot lead cung cấp. Reviewer chỉ sửa hai tests mới và report này; không đổi source owner, shared build/runtime, session, master/README hoặc gate. Không chạy native/live; VM/fixture là bằng chứng hành vi giới hạn, không xác nhận DOM Facebook hay benchmark. Các hash dưới đây là snapshot cuối dùng cho kết luận.

| Snapshot lượt8 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate.ts` | `4883b0cc012fb4f5c3dcc6ea738f58db63a5daf6dbd31c14fcbe412d9f09ba05` |
| `src/main/facebook-public-candidate-script.ts` | `fa32eb37704c2e87d671d1e275e96716898156e8bac5a229834e8c374f5aedd4` |
| `src/main/facebook-public-candidate-fields.ts` | `adba33239a5362db14c73fdd3c60641b55d6f9105841d9b0974cea300ae06e53` |
| `src/main/facebook-public-candidate-fixture.ts` | `1a6385c15094824c7d4b29a39b9954639866b0bf48998ca9d4cb59ac4bbaf06e` |
| `tests/facebook-public-candidate.test.ts` | `07c969b84ea3477dac79c81ee3c6ed312e04208aa5455024be2857f2665055a2` |
| `tests/facebook-public-candidate-review.test.ts` | `519b0653071a7f19e7e9f9b1142f7098f94c1556ec28a144900204167a150b67` |
| Fixed script string từ compiled snapshot | `55eb05c71a39f90f9a350ea122258b23bfe98ec0c6f86edde5173f74466c699e` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate.js` | `fdff7e8783f82b663a47d67afc05ae30750e9370a628ff63c8589edb5412feba` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate-script.js` | `7818921bd689c6feb6137028bf14d3127b12a007a8d17d8805948dc23002778a` |
| `.test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js` | `e6eb0065834a4b3bc2ebccbce808e67cb5af912d1cc24f971fc5318f01b4d11e` |

Lệnh compile/test giữ nguyên ở cuối tài liệu; output `.test-build-adapter-candidate` riêng. Đã báo lead kết quả để quyết định activation/nguồn thật trong scope của lead; reviewer dừng chờ giao việc.

## Lịch sử lượt 7 overlay v4 — R-O1/2/3 đóng, R-O4 từng mở

Fresh compile riêng PASS; **26 reviewer tests =25PASS/1FAIL**. R-O1/R-O2/R-O3 đã đạt đầy đủ các loop empty/boxless/contents/zero-area, hidden ancestry, first-skipped/second-visible; metadata xác nhận inspected2/skip1/visible1 ở case thứ hai. Năm owner source/test hashes trước/sau review ổn định. Script cố định v4 chưa có lỗi barrier-flow tái hiện trong các ca đã chạy; còn validator consistency R-O4.

### R-O4 — Validator chấp nhận CLEAR mâu thuẫn với ACCESS_DENIED

Vị trí `src/main/facebook-public-candidate.ts:99–103`: validator kiểm chiều `state=VISIBLE` phải có status blocker, nhưng chưa kiểm chiều ngược lại hoặc invariants của CLEAR. Repro: tạo result hợp lệ từ visible alert có text “Access denied”, đổi **duy nhất** `barriers.state` từ VISIBLE thành CLEAR. `validatePublicCandidateResult` không throw, dù status ACCESS_DENIED, visible1, kindDENIED/evidenceDENIED_TEXT vẫn còn. Test cuối file thiếu expected INVALID_RESULT.

Tác động xác định: nhận metadata tự mâu thuẫn/false CLEAR tại boundary untrusted. Chưa có bypass lưu nội dung trong repro (samples0/statusdeny vẫn giữ), chưa thấy fixed script tự phát ra object này và không khẳng định đây là node/lỗi đã xảy ra trên Facebook. Đã báo lead để owner sửa hẹp validation; không bỏ hoặc nới regression.

### Các kiểm tra v4 đã đạt

Harness mô phỏng đúng bề mặt fixed XPath: expression cố định, contextdocument, resolver/resultnull, type7 ORDERED_NODE_SNAPSHOT, union theo document order rồi giới hạn17; không tự trả kết luận visibility. Geometry có width/height/top/right/bottom/left và viewport1024×768, Range lấy rect từ fixture; không dùng rect thiếuwidth để fake visibility.

- Đúng16 empty candidates →CLEAR;17th sentinel (kể cả visible) →INCOMPLETE/CANDIDATE_LIMIT, chỉ snapshotItem0–15 được đọc, không mẫu.
- Descendant checks128 dùng chung giữa overlay candidates; vượt128 →INCOMPLETE/DESCENDANT_LIMIT. Ancestor path32 hoàn tất thìCLEAR, thêm một lớp →ANCESTOR_LIMIT.
- Chi phí barrier dùng chung2500node với extraction: post riêng đủ budget, thêm16 empty barriers khiến boundary partial tại2500 và không lưu content.
- XPath không có/throw →API_UNAVAILABLE; deadline hết →TIME_LIMIT; đều INCOMPLETE, không candidate. Không đồng nhất incomplete với clear.
- Các21 tests trước đềuPASS, bao gồm17 privacy/layout/lifecycle regressions v3. Test cuối về viewport/deny/auth/schema dừng tại assertion R-O4 đầu tiên nên không claim toàn loop auth/challenge/metadata mới đã chạy hết.

| Failed snapshot lượt7 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate.ts` | `10ff1ed0ef788a22412489551c95114e6b08f3f93f1b7a42068ecf40f9aa2d24` |
| `src/main/facebook-public-candidate-script.ts` | `c33b0169e8f6beeb54ffe80dc9d0204f03b9176402b9d54b056a1e71dc2ee6eb` |
| `src/main/facebook-public-candidate-fields.ts` | `adba33239a5362db14c73fdd3c60641b55d6f9105841d9b0974cea300ae06e53` |
| `src/main/facebook-public-candidate-fixture.ts` | `1a6385c15094824c7d4b29a39b9954639866b0bf48998ca9d4cb59ac4bbaf06e` |
| `tests/facebook-public-candidate.test.ts` | `d0b2902945ad71caff7e61039943e44c39030325d8df38c9c3f95823eaab0d20` |
| `tests/facebook-public-candidate-review.test.ts` | `ae6fa4aa151a2436a1a9b3d827bfe3921cae71e92dc00427acc9bd92cf7f8ca5` |
| Fixed script string từ compiled snapshot | `292c6abfa52ba5a211dee5bc072561bb180d8763af57f9ded275410b274dc9bc` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate.js` | `687a1f2435fbfb8157a6da5dce2fea90eb442ee3700b9e3a4fc079537be90c22` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate-script.js` | `4e42bacd1c96c87e2cfbeb58aaffd49e9b445635d35c5345be32ac57e7e76e4b` |
| `.test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js` | `72aa3b13cca0bc4bcb0744d73f6c86fdc39227740646369b9bf2ebcb51b5957f` |

Lệnh compile/test và output riêng giữ nguyên. Chờ lead báo fix-ready; không source edits, shared dist, native/live/runtime hoặc gate.

## Lịch sử lượt 6 overlay baseline —3findings từng mở

Theo [LIVE overlay stop](p02-live-dom-layout-v3-2026-10-27.md) và [dispatch](../handoffs/lead-p02-overlay-visibility-dispatch-2026-10-27.md): compile riêng PASS; **21 reviewer tests =18PASS/3FAIL** trên đúng source v3 đã nghiệm thu trước đó. **17tests layout/privacy/lifecycle cũ vẫn PASS**, thêm một test visible overlay PASS và3tests overlay FAIL. Lịch sử17PASS không thay bằng chứng kiểm regression mới. Chưa biết node nào trên Facebook thật đã kích hoạt guard.

### Findings có repro trên v3

- **R-O1/P2 — Empty boxless alert tự tạo barrier.** `facebook-public-candidate-script.ts:35–36` dùng `walkable(node)` cho role alert/dialog. Synthetic empty boxless `role=alert` ngoài main cạnh một public post trả UNSUPPORTED_OVERLAY/samples0 thay SAMPLES_READY/samples1. Walkable chỉ loại HIDDEN nên BOXLESS cũng đủ kích hoạt. Test đã đặt cả contents/zero-area và dialog; baseline thất bại ngay case đầu nên chưa claim các case sau đã chạy xong.
- **R-O2/P2 — Hidden ancestry không được xét cho overlay.** Cũng tại barrier trên, node rolealert có style của chính nó visible nhưng ancestor display:none vẫn block. Actual samples0, expected1; không có overlay hiển thị. Test thêm visibility:hidden/opacity0 ancestor; baseline dừng ngay case display:none. Predicate cần phân biệt traversal/own box và ancestor visibility.
- **R-O3/P2 — First hidden match che mất second visible blocker.** Preflight dòng41–42 dùng querySelector lấy first match. First rolealert display:none bị bỏ qua, nhưng second visible rolealert ngoài main không được xét; actual SAMPLES_READY thay UNSUPPORTED_OVERLAY. Đây là false-negative có repro, không chỉ dừng nhầm. Không được sửa R-O1 bằng bỏ qua boxless/hidden first rồi tiếp tục extraction mà chưa kiểm những blocker tiếp theo trong giới hạn.

Test đối chứng visible rolealert/dialog và display:contents wrapper chứa descendant hiển thị đều trả UNSUPPORTED_OVERLAY, không trả nội dung ra report (PASS). Testfirst-empty/second-visible hiện có assertion status nhưng metadata mới mới phân biệt được node nào đã chặn; baseline không claim đã skipfirst đúng. Cases cap/incomplete/discovery metadata sẽ bổ sung khi contract fix rõ, không dựng schema giả trước owner.

Không thay source owner, shared build hoặc runtime. Đã báo lead sớm; chờ code-ready để rerun, không polling. Cùng lệnh compile/test ở cuối tài liệu.

| Overlay failed baseline lượt6 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate.ts` | `b84b43b6313d6a8944a245ce051395e1296aa5f5be97cf43a573a234efea1f11` |
| `src/main/facebook-public-candidate-script.ts` | `c29df29aecbbf5d5f9a017ced43ffdd5fe0082d3d08b4869af26540bf775f025` |
| `tests/facebook-public-candidate-review.test.ts` | `762dfa9616a9812d9698cf0e54ea72629e574f784db4a2f2a9233ac901c9526c` |
| Fixed script string từ compiled snapshot | `0c820ada5aaf8259d6ae2657f9d493217179827044507e9a583f2969eeef7b03` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate.js` | `1e7e54afa3979ee914173b9fd55042b6b6baf86ccccf70600ba27e3cb7b3b63b` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate-script.js` | `7be2b6dd10fe454a1dc448434f82da8c3bce25e966cac4fc1723ebb6a78dd885` |
| `.test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js` | `bbbd5b17b9a62d4d620528a0b6ab5ccfcd60f480b8ded7accede53bfbed94502` |

## Lịch sử lượt 5 layout/header v3

Theo [LIVE boundary v2](p02-live-candidate-boundary-v2-2026-10-27.md) và [dispatch layout/header](../handoffs/lead-p02-dom-layout-dispatch-2026-10-27.md): **compile riêng PASS,17/17 reviewer tests PASS**, chưa thấy finding chặn có repro trong phạm vi đã kiểm. R-C1/R-C2/R-C3 vẫn đóng. Năm owner source/test hashes được ghi ở đầu/cuối lượt review và đều trùng; reviewer không sửa implementation hoặc chạy native/source thật.

Đã đọc script/controller/schema3, helper sanitizer và native fixtures của owner. Ngoài12 regressions trước, thêm5 tests độc lập:

- Wrapper `display:contents` hoặc boxless cho traversal đi qua; text ở parent boxless chỉ được lấy khi text Range có layout; deep header cluster và pure nested marker chain tạo đúng1 message group.
- Hidden/display:none/aria-hidden/visibility:hidden hoặc collapse/opacity0/content-visibility:hidden ancestry vẫn bị loại, dù child khai visibility:visible. Public badge chỉ có label trên boxless node không tự cấp positive publicity.
- Marker lồng không được gộp khi outer có text riêng, inner có header/story, hoặc đi qua quote; sibling và disjoint bodies vẫn AMBIGUOUS_BOUNDARY. Các mẫu âm không lưu nội dung.
- Deep header không mượn Public từ body/sidebar/embedded article hoặc ghép time/header với public ở cluster khác. Footer Friends/ad, embedded/comment/private và phone split-node regressions vẫn PASS.
- Alias walk/normalization dùng chung cap2500; partial boundary giữ groupingComplete=false và payload rỗng. Schema3 reject version2, raw style field và enum/count coercion; summary chỉ các counters/enums đã validate.

Test R-C3 được cập nhật theo hành vi v3: bounded cluster nay nhận deep header ngay ở FEED_CHILD, không bắt buộc fallback khi đã có đủ cluster. Vẫn kiểm Public đúng1 mẫu/COFFEE_BODY, counterpart Friends0 và không DEEP_PRIVATE. Không nới privacy hoặc bắt source chọn đường xử lý cũ. Harness chỉ thêm computed-style/rect/text-range surface tối thiểu; không phải bằng chứng native CSS hoặc parser Facebook.

**Giới hạn:** fixture chứng minh xử lý được các cấu trúc tổng hợp này, không xác nhận Facebook đang dùng display:contents hoặc hai markers thật là aliases. Main/source/identity/publicity vẫn unverified; permission UNKNOWN, benchmark OFF, valid0. Lead đã chạy native fixtures riêng; report này chỉ nhận kết quả độc lập Node VM/tests của reviewer. Cooperative DOM deadlines không được xem là hard preemption từ VM.

| Snapshot hiện hành lượt5 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate.ts` | `b84b43b6313d6a8944a245ce051395e1296aa5f5be97cf43a573a234efea1f11` |
| `src/main/facebook-public-candidate-script.ts` | `c29df29aecbbf5d5f9a017ced43ffdd5fe0082d3d08b4869af26540bf775f025` |
| `src/main/facebook-public-candidate-fields.ts` | `adba33239a5362db14c73fdd3c60641b55d6f9105841d9b0974cea300ae06e53` |
| `src/main/facebook-public-candidate-fixture.ts` | `4e79faf216f5d429d2f5ecaec0f53927d0dc90f7ec69f70b63352c6e354fd0c0` |
| `tests/facebook-public-candidate.test.ts` | `5fb5a186e22b61467784b37cea20b285a83097e0b2074691cbafc52845d0571d` |
| `tests/facebook-public-candidate-review.test.ts` | `3769c87d8422cdc05f196671ebf24d4b0e039d51b22398269051d15b4be7af67` |
| Fixed script string từ compiled snapshot | `0c820ada5aaf8259d6ae2657f9d493217179827044507e9a583f2969eeef7b03` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate.js` | `1e7e54afa3979ee914173b9fd55042b6b6baf86ccccf70600ba27e3cb7b3b63b` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate-script.js` | `7be2b6dd10fe454a1dc448434f82da8c3bce25e966cac4fc1723ebb6a78dd885` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate-fields.js` | `ed6c1337d5a2a124160b8bfe18c59d1d6bfd642e1c37bfbbd4abfee4d5d1bbff` |
| `.test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js` | `824f31d621c653282baa94d38e49d4d22af71f1a7937809758b4e76a758ce838` |

Dùng đúng lệnh compile/test ghi bên dưới và output riêng `.test-build-adapter-candidate`. Chốt test/report và dừng; không shared dist/runtime/master/README/gate.

## Lịch sử lượt 4 boundary v2 — R-C3 đã đóng

**Compile riêng PASS;12/12 reviewer tests PASS. R-C1/R-C2/R-C3 đã đóng ở snapshot dưới.** Không sửa hoặc nới reviewer tests trong lượt4. Các source hashes trước/sau compile/test trùng nhau; kết quả không trỏ về failed snapshot cũ. Lead giữ nghiệm thu/native/runtime/gates, reviewer không chạy nguồn thật.

Đã đọc fix ở `facebook-public-candidate-script.ts:122–123`: chỉ không mark covered khi reason NO_HEADER, tối đa1body, không restricted/ad và có hint ngoài header depth hoặc nested article đã prune. Những boundary restricted/ad/ambiguous khác vẫn covered; public/header cluster/cap không bị nới. Fallback có thể rediscover đúng một post dưới7wrapper **bên trong first feed** và trả MAIN_COLOCATED_HEADER_TEMPORAL.

Regression R-C3 chạy hết: positive Public samples1/COFFEE_BODY; counterpart Friends samples0 và không có DEEP_PRIVATE trong result. Tám privacy/lifecycle regressions trước vẫn PASS; auxiliary feed/outer article, shared2500node budget và sanitized NOT_SCANNED/PARTIAL shapes cũng PASS. Đây là bằng chứng fixture giới hạn; chưa xác nhận boundary/identity/publicity/unique trên Facebook thật, không nâng benchmark hoặc gate.

| Snapshot hiện hành lượt4 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate.ts` | `91d3210ed4675e7800b483cbc02831bfd7843939b2e7c896940d9f889a7fbe0c` |
| `src/main/facebook-public-candidate-script.ts` | `1938bf5a45ec28b24e25ff4f9fac15e0a3fee9c7b756d31aaf1506de4e98df6b` |
| `src/main/facebook-public-candidate-fields.ts` | `adba33239a5362db14c73fdd3c60641b55d6f9105841d9b0974cea300ae06e53` |
| `tests/facebook-public-candidate-review.test.ts` | `3dc31a18448287eeff1f5b508a480a6197e6044ef3674064633d40944d890aae` |
| Fixed script string của compiled snapshot | `086660031bf0d691fe4a1826ae8387dd2cf78706043e88869000826ea02c8588` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate.js` | `2e5f09d418e93254798649fdbc49dc39c647a736ae6d6e4aa56791c7ee44712b` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate-script.js` | `4783fe45a1dd5ee0c0ff8d7ff9fbff2fc43a143a1be4e05330caefabf8ed6c20` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate-fields.js` | `ed6c1337d5a2a124160b8bfe18c59d1d6bfd642e1c37bfbbd4abfee4d5d1bbff` |
| `.test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js` | `29cb323090a86110c5be56f3feac68babcb3d73384fbc7a6477f6434eb6e23d9` |

Dùng đúng lệnh compile/test bên dưới, output riêng `.test-build-adapter-candidate`. Chốt report và dừng; không thay source owner, test, shared build, phiên Facebook hoặc master/README.

## Lịch sử lượt 3 boundary v2 — R-C3 từng mở

Đọc [LIVE candidates0/NO_HEADER7](p02-live-public-candidates-2026-10-27.md) và [dispatch boundary](../handoffs/lead-p02-candidate-boundary-dispatch-2026-10-27.md). Compile riêng PASS; **12 tests:11 PASS,1 FAIL**. Tám regressions privacy/lifecycle trước vẫn PASS; chưa nghiệm thu fallback mới vì R-C3 bên dưới. Lead đã tái chạy compiled reviewer snapshot và thấy cùng failure. Owner đang sửa; reviewer dừng chờ fix-ready, không polling hay sửa source.

### R-C3/P2 — Deep wrapper trong first feed bị covered trước fallback

Vị trí `src/main/facebook-public-candidate-script.ts:121`: sau NO_HEADER, điều kiện `c.bodies` làm `covered.add(child)`; `handled` ở dòng144 trả true cho node hoặc ancestor đã covered, nên fallback prune toàn wrapper. Đây là repro riêng **wrapper nằm trong first feed**, không thay bằng wrapper ngoài feed.

Fixture positive: `main → feed → 7 div wrappers → một post` với đúng một header chứa H3/time/Public, một canonical permalink và một message region. Header quá depth6 so với direct feed child, nhưng cluster ở post gần body hoàn toàn trong8ancestor của fallback. Direct scan báo NO_HEADER và đã thấy body; fallbackUsed=true nhưng không rediscover post. Actual samples0, expected1 `MAIN_COLOCATED_HEADER_TEMPORAL` với bounded snippet. Đây không phải wrapper trộn hai bài hoặc nội dung private cần giữ covered. Test có counterpart Friends phải samples0; ở lượt failing này phần counterpart sau assertion positive chưa chạy, không ghi nó PASS.

Test mới `review v2: a single deep feed-child wrapper can be rediscovered without allowing a private counterpart` giữ private/body/no-mixing guards, không chỉ nới header depth. Sửa cần cho phép discovery có giới hạn trên wrapper thuần thiếu header vì depth, trong khi restricted/ambiguous/embedded boundaries vẫn phải an toàn.

Ba tests v2 khác PASS: auxiliary first feed trước legitimate outer article (embedded/comment vẫn loại); feed scan/discovery/candidate recheck dùng chung2500nodes và partial boundary không lưu body; rejection shapes≤5 chỉ enums/counts, có NOT_SCANNED/PARTIAL thay vì coi thiếu quan sát làzero đã xác minh, summary không raw values. Script/result/envelope version2; validator reject version1/raw shape field. VM fixture không chứng minh native selector/layout trên Facebook thật.

| Failed snapshot lượt3 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate.ts` | `91d3210ed4675e7800b483cbc02831bfd7843939b2e7c896940d9f889a7fbe0c` |
| `src/main/facebook-public-candidate-script.ts` | `63d44dc1b5d87df2f5c5ce4fe64b2ff57eaea3c4161ae979e40aeb40f50be658` |
| `tests/facebook-public-candidate-review.test.ts` | `3dc31a18448287eeff1f5b508a480a6197e6044ef3674064633d40944d890aae` |
| Fixed script string của compiled snapshot | `b90dc0440c92050f7b5873aeaa3dc2d194d1950cfc4a11a679e551aaf8a905f7` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate.js` | `2e5f09d418e93254798649fdbc49dc39c647a736ae6d6e4aa56791c7ee44712b` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate-script.js` | `9e9440fe5ff1bf0c9cf924d27da42d73efb6aca142cbf0c7073cc172a1ae83c2` |
| `.test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js` | `29cb323090a86110c5be56f3feac68babcb3d73384fbc7a6477f6434eb6e23d9` |

Source hashes được đọc ngay sau lượt test; compiled và fixed-script hash xác định bản thực chạy dù owner có thể sửa source sau đó. Dùng cùng lệnh compile/test bên dưới; không shared build/runtime/gate.

## Lịch sử lượt 2 sau fixes

**Compile riêng PASS, 8/8 reviewer tests PASS. R-C1/R-C2 đã đóng trong snapshot dưới.** Không còn finding chặn từ các ca đối kháng đã kiểm; lead giữ nghiệm thu/native/runtime và gate. Không chứng minh extractor khớp DOM thật hoặc candidate đã là PUBLIC/unique/valid. Reviewer không sửa source owner.

- R-C1: nhãn restricted/ad trực tiếp ngoài body được kiểm cả sau khi `headerOpen` đóng; positive public/heading/time vẫn giữ scope header. Negative từ embedded article/comment đã prune không bị mượn để loại outer post. Regression footer Friends và Sponsored đều không lưu body; embedded/comment/sidebar/body-public tests vẫn PASS.
- R-C2: regex số nhận whitespace gồm newline; final aggregated snippet được redact và `contacts_redacted` xét cả thay đổi cuối. Regression giữ nguyên phone split; bổ sung assertion `[NUMBER]` có mặt, `contacts_redacted=true` và không reconstruct được số0901234567 từ text.
- Assertion reason precedence của fixture có hai post trong wrapper ban đầu quá chặt: sau fix negative signal, cả CONFLICTING_PUBLIC và AMBIGUOUS_BOUNDARY đều là lý do đúng để không lưu. Theo lead, test giữ fixture private sibling và mọi invariant không mẫu/không lưu body, nhận đúng một trong hai reason đó; thêm **hai PUBLIC siblings** để kiểm AMBIGUOUS_BOUNDARY riêng, chính xác. Không đổi production precedence chỉ để test xanh. Partial-boundary cap2500 vẫn kiểm sau các assertion này và PASS.

Trong lúc review, source script đổi từ `64ffa44a…` (negative trước ambiguity) sang `6c739f0a…` (ambiguity trước negative). Hai lượt trung gian7/8 phản ánh assertion reason precedence, không phải hai bug privacy tái phát. Hash source/script dưới ổn định trong lượt compile/test cuối; không dùng failed snapshot lượt1 cho kết quả8/8.

| Snapshot lịch sử lượt2 | SHA-256 |
| --- | --- |
| `src/main/facebook-public-candidate.ts` | `fb6ef32861399a51bff1cf292629c95a78e4a9f796259e6d4ad070f2d33f6b71` |
| `src/main/facebook-public-candidate-script.ts` | `6c739f0ac9c63e1d10a5880e458e173cdf5b53b5fdff89247354e86a0f5a3db8` |
| `src/main/facebook-public-candidate-fields.ts` | `adba33239a5362db14c73fdd3c60641b55d6f9105841d9b0974cea300ae06e53` |
| `tests/facebook-public-candidate-review.test.ts` | `e09ab983c78e4e5c0da35e759d6da9e73f1feeb8404f0461f93f95c3a5246566` |
| Fixed script string import từ compiled snapshot | `5ac3ae298e281911c02d637d213562e184adbc79edb91e23b51dc2a2f7622ed9` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate.js` | `7ebc11183a88d2167e7cf3e3c5b6c956ff00fa6322eec74254ddef48730acf6f` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate-script.js` | `5e99c56ccbda0a22ef446109bb6db1baa3c651ee2e245d2d5ede178527cbc7f5` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate-fields.js` | `ed6c1337d5a2a124160b8bfe18c59d1d6bfd642e1c37bfbbd4abfee4d5d1bbff` |
| `.test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js` | `e7406715144125b045df9a2d98149b3088f933ccf55e88c2d1abdd711b0abb40` |

Lệnh compile/test không đổi, có bên dưới. Chốt reviewer test/report và dừng; không shared build, source thật, runtime hoặc gate update.

## Lịch sử lượt 1 — Chưa đủ điều kiện nghiệm thu

Compile riêng PASS; **8 reviewer tests: 6 PASS, 2 FAIL**. Hai finding P2 đã gửi lead để owner sửa trước khi đọc nội dung thật. Không lấy số test baseline của owner/lead làm bằng chứng hai regression này đã đạt. Đây là repro synthetic, chưa khẳng định trang Facebook thật có đúng markup edge đã thử.

### R-C1: Bỏ qua tín hiệu restricted/ad trực tiếp sau body

Vị trí: `src/main/facebook-public-candidate-script.ts`, nhánh `marker` đóng `headerOpen`, rồi guard `!body && c.headerOpen && depth(node)<=6` bao quanh `restrictedLabels`/`adLabels` (snapshot đọc khoảng dòng54–60; text ad tương tự ở dòng75).

Repro trong `tests/facebook-public-candidate-review.test.ts`, test “direct restricted or sponsored signal after body cannot be ignored”:

```html
<div> <!-- một feed child -->
  <header><h3>…</h3><time></time><span aria-label="Public"></span></header>
  <div data-ad-preview="message">RESTRICTED_OR_AD_BODY</div>
  <footer><span aria-label="Friends"></span></footer>
</div>
```

Actual `samples.length=1`, expected0 với conflict/restricted reason. Tín hiệu Friends nằm ngoài body, không trong embedded article/comment/hidden subtree, nhưng bị bỏ qua vì headerOpen đã đóng. Thay Friends bằng Sponsored đi qua cùng guard; regression giữ cả hai case. Không yêu cầu lấy public label ở footer làm positive publicity: positive signal vẫn cần scope hiện có, còn direct negative/conflict không được lặng lẽ bỏ qua chỉ do thứ tự DOM. Khi validator nhận result này, nội dung nằm trong bộ sample có DIRECT_PUBLIC_LABEL dù có tín hiệu xung đột trực tiếp.

### R-C2: Contact number chia nhiều text node lọt redaction

Vị trí: `src/main/facebook-public-candidate-fields.ts:27` regex số chỉ chứa digits/space/parentheses/dot/hyphen; `facebook-public-candidate-script.ts:77` nối các text node bằng newline và dòng99 redact lần cuối.

Repro body `Call <span>090</span><span>123</span><span>4567</span>`. Mỗi chunk ngắn hơn ngưỡng regex, script nối thành `Call\n090\n123\n4567`; regex cuối không match newline. Candidate vẫn giữ toàn bộ số khi bỏ ký tự phân cách. Validator kiểm idempotence bằng chính redactor nên cũng chấp nhận. Expected contact không còn reconstruct được thành0901234567 trong payload được lưu. Đây là một phone pattern synthetic có thể sửa có giới hạn, không yêu cầu bảo đảm phát hiện mọi dữ liệu nhạy cảm bằng NLP.

## Những kiểm tra đã đạt

- Body snippet không lẫn author header, nested article hoặc comment; group/profile link không thành post identity, thiếu identity giữ null và reason.
- Sidebar/body/embedded public label không cấp publicity cho outer unknown hoặc restricted candidate.
- Wrapper chứa hai message regions bị AMBIGUOUS_BOUNDARY; boundary bị cắt tại2.500nodes không lưu partial body.
- Long post ID giữ string, permalink aliases cùng identity dedup; group/profile/photo/malformed duplicate identity query bị từ chối; tracking bỏ khỏi canonical URL.
- Candidate body/permalink chỉ trong payload local; summary/started/return không có body, URL, profile id hoặc post id. Permission UNKNOWN, benchmark false, valid0, FIXTURE giữ nguyên.
- Stop/owner loss ghi payload rỗng và giữ native capacity tới settlement; late payload không ghi đè.

Reviewer harness chỉ cung cấp DOM surface cố định cần cho script trong Node VM; không thay native layout hoặc chứng minh selector trên Facebook thật. Không chạy native fixture của owner, không nâng PUBLIC/unique/valid từ fixture.

## Lệnh và snapshot thất bại

```powershell
node node_modules/typescript/bin/tsc --ignoreConfig tests/facebook-public-candidate-review.test.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022 --types node --rootDir . --outDir .test-build-adapter-candidate --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --noImplicitOverride --noFallthroughCasesInSwitch --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --noEmitOnError
node --test .test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js
```

Owner đang thay source song song, nên bảng dưới ghi **đúng compiled snapshot của lần6PASS/2FAIL**, không gán hash source sau đó cho lần test cũ. Không build lại output reviewer trước khi lead yêu cầu rerun fix.

| Artifact | SHA-256 |
| --- | --- |
| Fixed script string import từ compiled snapshot | `8e0913b8f2c08f7db262c0ea6b93d883af17a9d86fe36d0c9dc8abebe5f267c9` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate-script.js` | `11f5177862ad9d021bdbbe2be73140bf2db305c0772500ae94a8462a4533a8a4` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate-fields.js` | `01d3cc1ca13d111367bd3b84f857a83b0dccd4d794aaa3c6b46511ceddd44b8e` |
| `.test-build-adapter-candidate/src/main/facebook-public-candidate.js` | `7ebc11183a88d2167e7cf3e3c5b6c956ff00fa6322eec74254ddef48730acf6f` |
| `.test-build-adapter-candidate/tests/facebook-public-candidate-review.test.js` | `2339f77e8dcb7327eb14c73926decd602e226653d022a0497dcde3525e19dc8b` |
| `tests/facebook-public-candidate-review.test.ts` | `d09b550e27d919a1bacde5fca4e07a2109b6b14203cd8d29c997c87c707e905d` |

Trạng thái cuối lượt1: chờ lead báo owner fix ready. Lượt2 đã hoàn thành và ghi kết luận ở đầu tài liệu; bảng failed snapshot này chỉ là lịch sử. Không polling liên tục, không sửa implementation hoặc tự nghiệm thu task/gate.
