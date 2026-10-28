# P02 header tree v11 — code ready/frozen

28/10/2026 Asia/Bangkok, theo [dispatch](lead-p02-header-tree-dispatch-2026-10-28.md). Owner không thao tác runtime11256/source1576380, shared dist, .env/master. Permission UNKNOWN/benchmark OFF/valid0; chưa LIVE.

**Repro native v10:** shallow/deep20/mixed16–18wrappers chỉ1/3candidates,2NO_HEADER_CLUSTER, ancestorLimits2,267steps; [baseline](../evidence/p02-header-tree-v10-baseline-2026-10-28.json) khớp fixed script đã nghiệm thu.

**V11:** tạo parent links từ element đã visit trong boundary, root không nối ra ngoài. Aggregate reverse-order một lần, gồm **heading/pub/time/BODY qua toàn cây đã biết**; không còn propagate heading8/body32. Common frame chỉ có proof nếu heading+directpublic và không chứa body. Temporal matched sau aggregate truyền qua cached frame parents trong cùng budget. Pending control dùng chính parent frames, không dò8ancestor lần nữa. Article/comment/quote/navigation bị cut khỏi header tree; quoted marker không cấp body độc lập cho outer candidate. Body alias/optional/negative/publicity/geometry guards giữ.

Mọi aggregate frame/late temporal edge/control ancestry charge global2500steps/1giây; không reset/increase caps. Thiếu visited parent hoặc aggregate bị ngắt: không proof/sample. Replace limit `headerAncestors` bằng `headerTreeNodes:2500`, là budget chung. Candidate discovery/alias caps khác giữ nguyên.

Schema11 đồng nhất script/controller/validator/writer/fixtures. Headers thêm publicClustersFound/treeNodes/treeEdges/ancestryCuts/treeIncomplete. Rejection header phân biệt publicClusterFound với temporal clusterFound, treeState COMPLETE/INCOMPLETE/NOT_SCANNED, depth NONE/SHALLOW/DEEP (khoảng cách evidence tới common frame, ngưỡng8 chỉ là bucket). ancestorLimit nay chỉ structural/budget incomplete, không cap8. Chỉ enum/count, không raw paths/DOM/date/URL. Hai OTHER/range unknown không bị nới predicate.

**PASS:** build,16/16 owner candidate tests,3/3 native header-tree +3/3 optional-time regression. Không sửa/chạy reviewer harness, không lặp unrelated suites.

- Header positive3/369steps: public clusters3/temporal cluster1,102tree nodes/99edges, cuts0/incomplete0.
- Negative0/597steps: split header direct hoặc body dưới40wrappers (R-H2), two bodies, body/quote/sidebar public, private sibling, ads, quoted header. NO_HEADER_CLUSTER2, không ancestry cap.
- Global partial0/2500steps/1boundary: treeIncomplete1, cả public/temporal proof false. Unit missing visited-parent có ancestryCuts1/treeState INCOMPLETE, không dùng isolated partial frame để cấp proof. R-F1 control/link/body/quote/author và lifecycle/global guards PASS.
- Native external0, observer không attach, shutdown0windows/0WebContents, temp cleanup. Chưa chứng minh nguyên nhân duy nhất hoặc yield trên nguồn thật.

```powershell
node scripts/facebook-dom-diagnostic-build.mjs
node --test .test-build-csd-dom/tests/facebook-public-candidate.test.js
node scripts/facebook-public-candidate-smoke.mjs --header-tree --output .brain/evidence/p02-header-tree-native-2026-10-28.json
node scripts/facebook-public-candidate-smoke.mjs --optional-time --output .brain/evidence/p02-header-tree-optional-regression-2026-10-28.json
```

[Manifest v11 ban đầu](../evidence/p02-header-tree-files-2026-10-28.json) giữ snapshot trước R-H3; các số16tests/6native ở trên thuộc snapshot đó. Copied probe-build metadata là bootstrap baseline.

## R-H3 fix — current source/build frozen

Reviewer báo full69=68PASS/1FAIL: quoted inner message marker bị bỏ nhưng text vẫn nhập vào outer body. Sửa hẹp: marker quoted vẫn được track, đánh dấu ambiguity và prune subtree **trước khi đọc inner text**. Nó không thể cung cấp body cho outer admission, kể cả khi là marker duy nhất. Schema11/caps/header tree unchanged; không sửa reviewer tests/runtime/shared dist.

Current build PASS; **17/17 owner tests**, **3/3 native layout +3/3 native header-tree PASS**. Owner regression BLOCKQUOTE/Q với0/40wrappers giữ0samples, AMBIGUOUS_BOUNDARY1 và không quoted payload; native layout fixture cũ giữ pure-alias positive1, nested/quote negatives0, global partial0. R-H1/R-H2 native3/0/0 tiếp tục PASS. Không tự tuyên bố reviewer đã đóng finding.

```powershell
node scripts/facebook-dom-diagnostic-build.mjs
node --test .test-build-csd-dom/tests/facebook-public-candidate.test.js
node scripts/facebook-public-candidate-smoke.mjs --layout --output .brain/evidence/p02-header-tree-quoted-fix-layout-2026-10-28.json
node scripts/facebook-public-candidate-smoke.mjs --header-tree --output .brain/evidence/p02-header-tree-quoted-fix-native-2026-10-28.json
```

[Manifest hiện tại](../evidence/p02-header-tree-quoted-fix-files-2026-10-28.json). Source/build dừng chỉnh để lead/reviewer kiểm lại; owner LIVE0, permission UNKNOWN/benchmark OFF/valid0.
