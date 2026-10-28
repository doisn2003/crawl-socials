# P02.02 — Review độc lập DOM diagnostic

Ngày 2026-10-27, reviewer `/root/csd_adapter`. Đọc [ADR-010](../decisions/ADR-010-bounded-source-diagnostic.md) và [dispatch](../handoffs/lead-p02-dom-diagnostic-dispatch-2026-10-27.md). Review trong khi owner đang triển khai; không phải nghiệm thu toàn task hoặc quyền chạy benchmark.

## Kết luận snapshot

**Không còn blocker thực dụng trong phần script/schema đã kiểm; snapshot hiện hành là result-region v2, hỗ trợ Posts và Top mixed đúng bổ sung ADR-010.** Lượt review mới nhất compile PASS, **9/9 tests PASS**. Hai finding scope/root đã báo lead sớm và sửa; lịch sử bên dưới được giữ lại, không dùng yêu cầu Posts-only cũ để chặn Top đã có evidence thật. Lead review host/lifecycle/menu/build riêng. Reviewer chưa chạy source Facebook, không restart app hoặc dùng phiên người dùng. Không đặt Meta grant/G00 làm điều kiện cho diagnostic hẹp theo ADR-010.

## Lượt 3 — Result-region v2 sau DOM thật NO_MATCH/PARTIAL

Đọc [evidence LIVE đầu tiên](p02-live-dom-structure-2026-10-27.md), [dispatch](../handoffs/lead-p02-result-region-dispatch-2026-10-27.md) và handoff owner. NO_MATCH sau cap2500 và post-link2 không có nghĩa nguồn0bài. V2 chọn semantic main/feed bằng tối đa3 first-match probes, fallback-body có khai báo; không biến selected root thành verified results.

**Finding P2 đã đóng:** ở bản v2 đầu, `facebook-dom-diagnostic-script.ts:38` loại `nav *`/`aside *` nhưng chưa loại chính `nav`/`aside`. `<nav role="main">` hoặc `<aside role="main">` vẫn match selector; selected root xử lý trực tiếp ở dòng46/79 nên không qua TreeWalker pruning. Kết quả có thể lấy cấu trúc sidebar/navigation trái scope. Báo lead ngay khi đọc code; owner đã thêm `:not(nav):not(aside)`. Regression reviewer kiểm cả hai root tự thân, cùng nav/aside/hidden/dialog subtree trong main; PASS ở snapshot đã sửa. Owner sửa trước lần chạy reviewer nên không ghi nhận một lượt test đỏ v2 giả tạo. Chưa có bằng chứng trang Facebook thật sử dụng markup edge này.

Reviewer test harness được cập nhật đúng bề mặt v2: tag/attribute/`:not(descendant)` selector subset và TreeWalker FILTER_REJECT semantics; không xây browser/parser framework, không dependency mới. **Compile riêng PASS, 9/9 tests PASS**. Ba tests v2 mới kiểm:

- 2.600 chrome elements trước main không tiêu hết cap vùng kết quả; chọn main/role-main được dedup, feed lồng vẫn là candidate riêng; `FIRST_PER_SELECTOR`, `verified=false`, `POST_LINK_STRUCTURE` và không article/public claim. Hai main cùng selector chỉ quan sát first, không giả tổng số root.
- Loại root nav/aside và pruning các subtree navigation/sidebar/hidden; dialog không sinh article/link samples.
- 7 links cùng post-like URL vẫn là7 link occurrences, tối đa5 samples ×8ancestors =40 tổng; các role lạ thành OTHER, pagelet/label chỉ presence booleans, không raw value/href/text/name. Validator reject v1, steps41, root verified=true và raw href field.

Sáu tests route/mixed/provenance/redaction/bounds/auth trước giữ PASS sau schema bump. Controller report và script result cùng version2. Main validator giữ allowlist/counter consistency; metadata không có entity/identity/public/unique claim. Không chạy native fixture của owner hoặc source thật. Output vẫn `.test-build-adapter-dom`, dùng cùng lệnh dưới.

Giới hạn đúng hiện trạng: candidate count chỉ là first-per-selector, không đo root ambiguity đầy đủ; `COMPLETE` chỉ vùng đã chọn sau pruning. QuerySelector/native layout có cooperative deadline, không hard cap2500 thao tác engine nội bộ. Ancestor hint chưa quét descendants; public/source/entity chưa xác minh. Những giới hạn này đã được owner ghi, không dùng để kết luận source cạn hoặc gate PASS.

| Snapshot hiện hành v2 | SHA-256 |
| --- | --- |
| `src/main/facebook-dom-diagnostic-script.ts` | `6948d8e2a2179142b5ae7f049e3d8d0aeae95e4640756f826351175393ce1414` |
| `src/main/facebook-dom-diagnostic.ts` | `5c3a323f6839557e94761b6da1e25bfbdd3df90d334e649caaa1e9fcc02606c1` |
| `tests/facebook-dom-diagnostic-review.test.ts` | `016996729f8846aca147a8787b0f8a17b89a090c039de3711cf6a3a6758409cf` |

## Lịch sử lượt 2 — Top mixed theo evidence UI lúc 20:44

Đọc bổ sung ADR-010/dispatch: lead quan sát search trực tiếp trả exact `/search/top/`, có Page/post/ad; preflight bản đầu trả UNSUPPORTED_ROUTE với actions0. Đây là input kỹ thuật mới cho scope metadata diagnostic, không phải bằng chứng user tìm sai entity/Actor.

Snapshot mới được đọc: script và main guard nhận đúng `/search/(posts|top)/?`, không mở toàn search family. Script phân biệt `SEARCH_POSTS` và `SEARCH_TOP_MIXED`. Validator giữ enum riêng; controller đối chiếu `expectedRoute` với output. Mixed structural hints không được đổi thành post identity/publicity/source type đã xác minh. Fixture native mới có Page link, post link và external/ad link; reviewer chỉ đọc fixture, không chạy native smoke/live của owner.

Updated reviewer tests **6/6 PASS**: Posts/Top route riêng; People/Groups/Pages/Videos và suffix `/top/other`, `/posts/other` bị từ chối; raw-data redaction trên cả hai route; Top đi qua controller FIXTURE với `diagnostic_only=true`, `benchmark_eligible=false`, `platform_permission=UNKNOWN`, `verified_valid_count=0`, `candidates_collected=0`, PUBLICITY/SOURCE_TYPE_UNVERIFIED. Public label hint vẫn không phải PUBLIC claim. Ba tests bounds/auth/content false-positive cũ vẫn PASS.

Fake sink của test reviewer đã được cập nhật theo return type mới: trả hash JSON in-memory thay vì void; không giả artifact file trên disk. Compile output riêng `.test-build-adapter-dom`; lệnh bên dưới giữ nguyên. Không sửa source của owner hoặc shared build.

| Snapshot lịch sử lượt 2 | SHA-256 |
| --- | --- |
| `src/main/facebook-dom-diagnostic-script.ts` | `2d2e260de8b9f63108ea4311acf24d7a12051f037c43810585580afad2c66826` |
| `src/main/facebook-dom-diagnostic.ts` | `0db6e87b7d0e84d081b429b02e26d61360314ddb0afd0a0b50462ebf3ee1073a` |
| `src/main/facebook-dom-diagnostic-fixture.ts` | `182af82e6c9e6859a98e9fb52d42130f9ee09d1dc51cf2f2021bc5fbed997eef` |
| `tests/facebook-dom-diagnostic-review.test.ts` | `8419a362c96b568c9aa347df103317272a5ff21d52237d9d6911e37d12e9a8fe` |

## Lịch sử lượt 1: finding P2 đã sửa — chấp nhận toàn search family

- Bản đầu: `src/main/facebook-dom-diagnostic-script.ts:14–15` nhận toàn `/search/*`; `inspectDomRoute` ở `src/main/facebook-dom-diagnostic.ts:58` cũng vậy. Test owner còn chấp nhận `/search/top/`.
- Repro: URL `/search/top/?q=cafe%20H%C3%A0%20N%E1%BB%99i` với một synthetic `<article>` trả `HEURISTIC_MATCH`. Tương tự People/Groups/Pages/Videos có thể được inspect dù ADR chỉ cho owned Posts view. Không có bằng chứng selected Posts tab trong nhánh `SEARCH_OTHER` để thu hẹp scope.
- Owner sửa cả hai gate thành exact `/search/posts` hoặc `/search/posts/`; script gán route `SEARCH_POSTS` sau gate. Reviewer không sửa implementation.
- Regression độc lập ban đầu **4/5 PASS, 1 FAIL** với actual `HEURISTIC_MATCH`, expected `UNSUPPORTED_ROUTE`; sau fix compile lại, **5/5 PASS**. Các route khác bị từ chối trước khi duyệt DOM.

## Kiểm độc lập và dữ liệu ở lượt 1

[tests/facebook-dom-diagnostic-review.test.ts](../../tests/facebook-dom-diagnostic-review.test.ts) dùng Node VM và DOM surface nhỏ, cố định; không thay browser thật hoặc xây parser/framework. Năm test kiểm:

1. Chỉ đúng route Posts được inspect; các loại search khác không đọc node.
2. Tên người, nội dung, HTML, query và token trong link không đi vào output; output chỉ enum/count/bucket. Public/restricted label đều chỉ là hint.
3. No-match, tối đa 2.500 node, 5 structural samples và time-limit flag rõ; không có khẳng định source exhausted.
4. Password/OTP input, iframe reCAPTCHA, challenge/access-denied trong form/dialog xóa samples và trả trạng thái dừng tương ứng.
5. Nội dung bài nhắc “Confirm your identity” hoặc “Access denied” ngoài form/dialog không tự bị xem là auth barrier.

Đã đọc strict main validator: reject key lạ/enum coercion, giới hạn cards/counters và tạo lại object theo allowlist. Output không trả raw text, HTML, attributes hoặc URLs. Metadata ghi diagnostic-only, benchmark ineligible, permission UNKNOWN, valid count0; heuristic public label không trở thành PUBLIC. Script cố định không fetch/navigation/click/scroll. Native script nằm trong isolated world; ownership/lifecycle/elapsed handling được lead kiểm riêng.

Lệnh đã chạy, output riêng:

```powershell
node node_modules/typescript/bin/tsc --ignoreConfig tests/facebook-dom-diagnostic-review.test.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022 --types node --rootDir . --outDir .test-build-adapter-dom --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --noImplicitOverride --noFallthroughCasesInSwitch --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --noEmitOnError
node --test .test-build-adapter-dom/tests/facebook-dom-diagnostic-review.test.js
```

Compile PASS; **5 tests PASS, 0 fail** sau fix. Không chạy build/smoke chung của owner, không tạo LIVE evidence từ VM.

## Giới hạn và hash snapshot

Heuristic chỉ nhận article/role=article và các label đã khai báo, chưa xác minh schema Facebook thật. `NO_MATCH` chỉ nghĩa không thấy heuristic trong đoạn DOM đã duyệt; nếu nodeLimit/timeLimit thì càng không thể kết luận không có bài/auth/challenge. Counts có thể gồm DOM ẩn bởi CSS/ancestor; chưa phải bài đang nhìn thấy hoặc ứng viên công khai. Script time limit là cooperative giữa các node; Node VM không chứng minh thời gian layout/native execute ở trang thật. Đây là giới hạn đã nêu, không nâng thành bug hay false gate.

Các file host/menu/fixture/integration được đọc để hiểu boundary, nhưng review này không thay kết luận host/runtime của lead. Source còn có thể thay đổi sau snapshot. Bảng dưới giữ **hash lịch sử lượt 1**, đã được thay bởi bảng snapshot hiện hành ở lượt 2:

| File | SHA-256 |
| --- | --- |
| `src/main/facebook-dom-diagnostic-script.ts` | `2580e89e4845178bc473f91c06c0e21941eea8197996bd925ff52130d4921408` |
| `tests/facebook-dom-diagnostic-review.test.ts` | `98468bf09f7dd89022c2d6b4aafbebf1ca42238cbff7e04a2a7ec43e7e66c2aa` |

Không sửa source owner, master plan, README, session, shared dist hoặc gate. Reviewer dừng sau bàn giao để lead nghiệm thu và thử diagnostic thật theo ADR-010.
