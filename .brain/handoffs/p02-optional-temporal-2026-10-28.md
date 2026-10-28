# P02 field scope v10 — code ready/frozen

28/10/2026 Asia/Bangkok, theo [dispatch](lead-p02-field-scope-dispatch-2026-10-28.md) và [ADR-012](../decisions/ADR-012-optional-temporal-diagnostic.md). Owner không thao tác runtime27448/source459872, shared dist, .env, master hoặc credentials. Permission UNKNOWN/benchmark OFF/valid0, chưa LIVE.

**Schema10:** thêm boundary `FEED_CHILD/MAIN_ARTICLE/MAIN_COLOCATED_HEADER_PUBLIC_OPTIONAL_TIME`. Nhánh này chỉ nhận đúng1heading, direct public cùng header cluster8ancestor không chứa body,1body đã normalize hoàn tất và text đọc được. Private/ad/conflicting identity/mixed bodies/unknown body/header/publicity/global incomplete vẫn loại. Date quan sát ở header khác vẫn không được mượn: temporal observed nhưng sai cluster tiếp tục reject.

Known temporal link/control record có geometry UNKNOWN chỉ làm record limited và temporalUncertain; không poison toàn boundary. OTHER/BODY uncertainty vẫn strict, không bỏ mọi unknown. Header/public signals cũng kiểm clip context và positive element geometry; empty/unknown/partial signal không cấp proof. Không ép partial thành date/substring/epsilon. Negative ad/restricted exact text trong temporal unknown vẫn giữ veto bảo thủ.

Mọi sample có `published_at:null`; metadata `temporalStatus=OBSERVED/MISSING/UNREADABLE`, `headerProof=HEADING_TEMPORAL_PUBLIC/HEADING_PUBLIC`. Optional-time có temporal0 và flags timeTag/abbr/ariaTemporalfalse; missing reason tương ứng `TEMPORAL_NOT_OBSERVED` hoặc `TEMPORAL_UNREADABLE`. Validator chặn date tự điền, status/reason/boundary mâu thuẫn, body null, thiếu public/proof, nhiều heading/body. Nhánh temporal cũ vẫn phải có observed temporal/header cluster; published_at vẫn chưa parse.

**Exact empty CSS:** legacy rect gồm4px bounds và positioning absolute/fixed, right≤left hoặc bottom≤top; inset1–4percent components đối diện cộng≥100%. Chỉ chứng minh empty, không giải nghĩa arbitrary nonempty clips. Empty là hidden dù ancestor clip chưa hỗ trợ; không suy mọi clip hidden. Static/relative/sticky legacy clip không có tác dụng được giữ visible, native Sponsored/static/rect0 vẫn bị chặn. Unknown positioning/complex CSS tiếp tục UNKNOWN. Counters clipEmptyLegacy/clipEmptyInset/clipLegacyInactive, không raw CSS. Caps/body/publicity/session/identity/contact/lifecycle giữ nguyên.

**PASS:** isolated build,15/15 unit tests và12/12 native cases: optional-time3, temporal3, geometry3, local-clip3. Không sửa/chạy reviewer tests. Native optional5/0/1samples tại144/296/67steps: no-date/partial-date/accessible-only empty clips/static clip;12negative boundaries gồm private/quote/body-only public/no heading/mixed/unknown body/OTHER/publicity/hidden header/empty body/cross cluster/static Sponsored; fallback partial date vẫn optional null. External0, observer không attach, shutdown0windows/0WebContents/temp cleanup.

Regression migration theo ADR-012 giữ **temporal proof**, thay kỳ vọng candidate bắt buộc0: R-T1 quote/body/heading, R-T2tail và R-T3whitespace vẫn temporal0/date null; public outer body có thể là optional candidate. Private/ad/cross-cluster được xét trước cap5, không đổi expected loại.97chars/nodes không thành observed temporal nhưng2body hoàn tất trước global cap được giữ với UNREADABLE; boundary global partial không lưu. Local clip3temporal-only unknown trở thành optional, BODY/OTHER unknown vẫn bị loại. Reordered/renamed synthetic public-body sentinels để không nhầm public fixture với private source; embedded/comment/private payload assertions giữ.

```powershell
node scripts/facebook-dom-diagnostic-build.mjs
node --test .test-build-csd-dom/tests/facebook-public-candidate.test.js
node scripts/facebook-public-candidate-smoke.mjs --optional-time --output .brain/evidence/p02-optional-temporal-native-2026-10-28.json
node scripts/facebook-public-candidate-smoke.mjs --temporal --output .brain/evidence/p02-optional-temporal-regression-2026-10-28.json
node scripts/facebook-public-candidate-smoke.mjs --visibility --output .brain/evidence/p02-optional-temporal-geometry-2026-10-28.json
node scripts/facebook-public-candidate-smoke.mjs --local-clip --output .brain/evidence/p02-optional-temporal-local-clip-2026-10-28.json
```

[Manifest v10 ban đầu](../evidence/p02-optional-temporal-files-2026-10-28.json) giữ snapshot trước R-F1; các số15unit/12native ở trên thuộc snapshot đó. Copied probe-build metadata là bootstrap baseline.

## R-F1 fix — source hiện tại đã frozen

Theo finding reviewer lượt21 (baseline63/64PASS), sửa đúng2nhánh visible text: direct text ngoài body/quote/heading ghi restricted labels; pending header-control probe ghi restricted text trước optional admission. Không đổi schema10, classifier, caps, body/publicity proof, runtime/shared dist hoặc reviewer tests. Header/footer text Friends/Bạn bè mâu thuẫn direct Public bị loại; body, quote và author text không bị coi là badge.

Current build PASS; **16/16 owner candidate tests**, **3/3 native optional-time cases PASS**. Unit regression gồm link English/Vietnamese, pending BUTTON, direct footer và positive body/quote/author. Native first case tăng độ khó:3public-header candidates có A Friends/A Bạn bè/BUTTON-span Friends bị CONFLICTING_PUBLIC; chỉ2candidates body/quote counterparts còn lại được lưu. Các exact-empty/static clip assertions vẫn kiểm; negative12boundaries0sample và fallback partial-temporal optional1 vẫn PASS. Không lặp unrelated suites và không tự tuyên bố reviewer đã đóng finding.

```powershell
node scripts/facebook-dom-diagnostic-build.mjs
node --test .test-build-csd-dom/tests/facebook-public-candidate.test.js
node scripts/facebook-public-candidate-smoke.mjs --optional-time --output .brain/evidence/p02-optional-temporal-restricted-fix-2026-10-28.json
```

[Manifest hiện tại](../evidence/p02-optional-temporal-restricted-files-2026-10-28.json) thay manifest baseline. Source/build dừng chỉnh để lead/reviewer kiểm/nạp/read. Owner LIVE0, benchmark OFF/permission UNKNOWN/valid0; chưa chứng minh yield/source type/relevance/date trên nguồn thật.
