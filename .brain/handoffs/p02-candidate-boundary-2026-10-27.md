# P02 candidate boundary v2 — code ready

Ngày 2026-10-27, Asia/Bangkok. Theo [dispatch](lead-p02-candidate-boundary-dispatch-2026-10-27.md) sau [run thật NO_HEADER7](../evidence/p02-live-public-candidates-2026-10-27.md). Worker chỉ build/fixture; không đọc nguồn, restart runtime26904/source3476960 hoặc ghi shared dist. Không thay master/gates/policy/session/BrowserHost. Mục native/cờ LIVE/đường dữ liệu vẫn như [handoff trước](p02-public-candidates-2026-10-27.md).

## Thay đổi để lead thử tiếp

Candidate result, validator, started/summary/payload cùng **schema2**; metadata diagnostic cũ không đổi. Bổ sung `selection` và tối đa5 `rejection_shapes` vào summary đã lọc, không body/URL/name/attributes:

- Root/feed relationship: `firstFeedFound`, `feedLandmarks`, `fallbackUsed`, `feedExamined`, `mainExamined`, `fallbackScan`, `coLocationMisses`; counters heading/temporal/public/restricted/message/article và ngoài first feed trong discovery.
- Shape: origin FEED_CHILD/MAIN_ARTICLE/MAIN_COLOCATION, first-failure reason, tag/role enums, depth bucket, feedRelation; observed hint counts, outsideHeaderDepth, prune counts article/hidden/control/navigation/comment.
- Shape state COMPLETE/PRUNED/PARTIAL/NOT_SCANNED giữ rõ phạm vi quan sát. Hints0 ở PRUNED/PARTIAL/NOT_SCANNED **không chứng minh vắng tín hiệu** trong subtree chưa đọc. COMPLETE chỉ nói hoàn tất walk theo chính pruning policy này, không toàn nguồn. Khi fallback dùng, giữ tối đa3 shape feed để còn chỗ cho2 shape fallback. Discovery shape có thể mô tả root chưa được `examine`, khác số examined boundaries.

First feed được thử như cũ. Nếu6 child đầu chưa có header+temporal landmarks, dừng dùng feed đó làm giả thuyết duy nhất và dành budget còn lại cho main. Khi chưa có sample, còn node/time/12-boundary budget, fallback duyệt **main đã chọn**, không gộp main/feed thành candidate. Dùng chung counter2500nodes cho feed pass, discovery, prune và candidate recheck; không reset sau fallback. Một DOM node đọc lại cũng tiêu thụ counter lần nữa. Cùng deadline1giây cooperative/4giây main,12 examined,5samples,32KiB output,1action và các Stop/late/owner guards.

Fallback nhận outer ARTICLE khi không có ancestor post context đã quan sát; embedded article/comment vẫn prune. Với message marker, theo tối đa8 ancestor tìm heading+temporal co-location, chọn root gần hơn rồi chạy lại toàn bộ guards cũ ở root đó. Header depth6 **không nới**; root gần đúng hơn làm wrapper thuần không che header. Header/time/public còn phải cùng cluster không chứa message marker để tránh ghép header A với public/body B. Private/ad/multiple body/identity ambiguity vẫn khóa boundary; outer context khác không được mượn. Wrapper chỉ thiếu header do độ sâu,≤1message và không negative/ambiguous signal được phép rediscover; đây là fix R-C3 của reviewer. Completed/blocked regions không bị đọc thành sample lần nữa. Header frame contributions của candidate đã xử lý được trừ trước sibling tiếp theo.

Đây vẫn là heuristic chưa xác minh DOM Facebook: main/first feed, message marker families, temporal formats, cluster/ancestor bounds có thể tiếp tục không khớp. NO_HEADER chỉ là first failure; `NO_COLOCATED_BOUNDARY`/`NO_HEADER_CLUSTER` nói thiếu quan sát cụ thể. Không suy source rỗng hoặc Facebook chặn từ0sample. Phạm vi ancestry hữu hạn và pruning có thể bỏ candidate; native selector/layout không hard-preempt từ JS. Không mở click/scroll/hover/network/GraphQL/continuation.

Body/permalink chỉ `candidates.json` local; missing/null/UNKNOWN, direct public signal, negative footer checks, newline-contact redaction và retention7ngày giữ nguyên. `boundary` thêm MAIN_ARTICLE_HEADER_TEMPORAL và MAIN_COLOCATED_HEADER_TEMPORAL để không gọi mọi kết quả là feed child. Verified valid0/benchmark false/permission UNKNOWN. Không relevance/unique/source-coverage claim.

## Kiểm chứng snapshot sau fix

```powershell
node scripts/facebook-dom-diagnostic-build.mjs
node --test .test-build-csd-dom/tests/facebook-dom-diagnostic.test.js .test-build-csd-dom/tests/facebook-public-candidate.test.js .test-build-csd-dom/reviewer/tests/facebook-public-candidate-review.test.js
node scripts/facebook-public-candidate-smoke.mjs --boundary --output .brain/evidence/p02-candidate-boundary-fixture-2026-10-27.json
node scripts/facebook-public-candidate-smoke.mjs --output .brain/evidence/p02-candidate-boundary-candidate-regression-2026-10-27.json
node scripts/facebook-dom-diagnostic-smoke.mjs --output .brain/evidence/p02-candidate-boundary-metadata-regression-2026-10-27.json
```

Build PASS; **35/35 tests** =23 owner +12 read-only reviewer PASS. Reviewer test được compile riêng vào `.test-build-csd-dom/reviewer` với strict flags như lượt trước; không sửa source test reviewer hoặc output của họ. **Native9/9 PASS**:3 boundary +3 candidate regression +3 metadata regression. Mỗi synthetic child đóng sạch, external0 theo local protocol, observer không attach; fixture data temp được xóa, `.brain` chỉ summary/hashes.

Boundary fixture: first nested auxiliary feed đứng trước bài thật, legitimate outer ARTICLE chứa embedded/comment, deep DIV post ngoài feed =>2 public-signal samples, đúng hai origin, không private text. Lượt2 dùng deep feed-child wrapper Public/Friends và headerA/bodyB bị tách: đúng1 Public sample, private0 và NO_HEADER_CLUSTER cho cross-body. Lượt3 feed/discovery/recheck chung cap2500, incomplete snippet không lưu và shape PARTIAL. Reviewer regression xác nhận R-C3 fixed với counterpart Friends0, auxiliary feed không grant publicity, bounds và shape redaction. Regression cũ vẫn kiểm alias/body missing/contact/footer signals/lifecycle.

Thêm native-only fixture switch `--csd-candidate-boundary-fixture`, chỉ hợp lệ cùng `--csd-facebook-public-candidate-fixture` (FIXTURE); smoke `--boundary` chọn biến thể này. Không đổi LIVE trigger.

Sửa source trong candidate script/controller/fixture/owner test và index/smoke cho fixture variant. Snapshot gồm [manifest](../evidence/p02-candidate-boundary-files-2026-10-27.json) với owned files, compiled controller, fixed script string và toàn isolated build. Copied probe-build metadata vẫn là bootstrap baseline. Lead đối chiếu rồi nạp và đọc đúng một lượt thật; worker giữ source ổn định, không tự chạy.
