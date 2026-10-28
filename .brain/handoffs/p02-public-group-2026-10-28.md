# P02 exact public group v13 — code ready/frozen

28/10/2026 Asia/Bangkok, theo [dispatch](lead-p02-public-group-dispatch-2026-10-28.md). Không thao tác runtime24084/source2819162, shared dist, .env/master. Owner LIVE0; permission UNKNOWN/benchmark OFF/valid0/P02.02 chưa gate PASS.

**R-G1:** chỉ thêm exact normalized `đã chia sẻ với nhóm công khai` vào vocabulary chung discovery/examine/header tree/semantic scope. Không substring hoặc suy từ filter. Thêm exact negative counterpart `đã chia sẻ với nhóm riêng tư` để không bỏ conflict; counterpart này có lý do ngôn ngữ nhưng **chưa được quan sát trên nguồn**, chỉ native synthetic. Không thêm public language variants chưa đo.

**R-G2:** own public label trên BUTTON/rolebutton ở header được kiểm visibleSignal và cluster **trước prune**. Children vẫn chỉ qua bounded pending-control probe4controls/64nodes; nếu public-control bắt buộc chưa probe được vì capacity/record cap hoặc gặp structural subtree thì giữ uncertainty/loại candidate. Attribute/text/split negative veto vẫn kiểm. Discovery chỉ giữ own-label hint rồi prune children; final examine mới cấp proof. Không tự nhận nested label dưới control chưa có own label hoặc control trong author/body/quote. No cap/epsilon/time-parser changes.

Schema13 đồng nhất. Header diagnostic/rejection thêm publicLabelsSeen/publicSignalsAccepted/publicControlsPruned. Là attempts/geometry-positive signals, không candidate/unique/verified-public counts, không raw label/DOM/URL. source_type UNKNOWN, date null và PUBLICITY_NOT_INDEPENDENTLY_VERIFIED giữ nguyên; group label không tự gán source type GROUP.

**Baseline native v12:**1/5, chỉ KNOWN_PUBLIC_GRAPHIC được nhận; known old-label BUTTON cũng thiếu publicity. [Baseline](../evidence/p02-public-group-v12-baseline-2026-10-28.json) khớp fixed script v12. Không suy AX=DOM attribute/mapping boundary Facebook thật.

**Current PASS:** isolated build,18/18 owner candidate tests,3/3 native public-group +3/3 native auxiliary regression. Native5positive gồm SVG aria group, graphic title group, BUTTON old label, rolebutton group, IMG old label; public labels seen/accepted5, controls pruned2.12negative boundaries0samples: private/conflict, body/quote/comment/hidden/partial/outside-header/substring, body-button/nested-only and public-control child Friends. Fallback2samples gồm own-label control trong non-ARTICLE co-location. Unit còn kiểm IMG/SVG/title/button variants, nested-only0, child conflict0 và không admission khi4control/64node budget không đủ. Native external0/observer không attach/shutdown0windows/0WebContents/temp cleanup. Không sửa/chạy reviewer files hoặc unrelated suites.

```powershell
node scripts/facebook-dom-diagnostic-build.mjs
node --test .test-build-csd-dom/tests/facebook-public-candidate.test.js
node scripts/facebook-public-candidate-smoke.mjs --public-group --output .brain/evidence/p02-public-group-native-2026-10-28.json
node scripts/facebook-public-candidate-smoke.mjs --auxiliary --output .brain/evidence/p02-public-group-auxiliary-regression-2026-10-28.json
```

[Manifest frozen](../evidence/p02-public-group-files-2026-10-28.json). Source/build dừng chỉnh cho lead/reviewer nạp/read. Chưa chứng minh nhãn/control là nguyên nhân duy nhất hoặc yield trên nguồn thật; fallback/global budget vẫn giữ. Copied probe-build metadata là bootstrap baseline.
