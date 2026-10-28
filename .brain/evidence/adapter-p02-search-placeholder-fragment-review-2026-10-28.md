# P02.02 — Review observed search placeholder fragment

Trạng thái **FINAL REVIEW PASS**, không còn blocker trong phạm vi fragment patch. Reviewer `csd_adapter`, 2026-10-28. Theo [dispatch](../handoffs/lead-p02-search-placeholder-fragment-dispatch-2026-10-28.md) và [LIVE v20](p02-live-search-target-v20-2026-10-28.json). Không đọc UI/profile/credentials hoặc raw source URL; các fragment và tracking trong tests đều synthetic. Giữ baseline dưới đây; kết luận cuối ở cuối file.

V20 ghi4 HREF +2 NOT_LINK, không visibility uncertainty. Lead quan sát timestamp thuộc họ fragment `^#\?[a-z]{3}$` trên cùng origin/path; classifier frozen v20 từ chối mọi fragment. Đây là điều kiện cụ thể loại dạng href đó; chưa xác định đầy đủ các điều kiện phía sau hoặc bảo đảm mở được bài sau sửa.

## Frozen baseline

Giữ nguyên compiled v20 modules, discovery SHA `44828d3d6af163205b85018a57aed57bbae4d95a8d9f24019d941ba87f228943`, trong `.test-build-adapter-candidate/search-fragment-v20-baseline/`. Không compile source owner đang đổi. [Receipt hashes](adapter-p02-search-fragment-v20-baseline-files-2026-10-28.json).

Ba reviewer cases: **1 PASS / 2 FAIL đúng baseline**:

- Positive family same-origin/same-path: classifier trả null thay vì SEARCH_PLACEHOLDER; chưa thể chọn/click timestamp.
- Negative boundaries PASS: fragment sai dạng/độ dài/case/encoded, khác origin/path/query, fragment ở post route đều bị từ chối.
- Exact raw href binding test chưa đi tới bước mutation vì baseline discovery trả NO_ELIGIBLE_TIMESTAMP. Sau fix phải chứng minh đổi duy nhất fragment trên cùng node khiến STALE_TARGET/zero click, không strip/normalize away fragment để giữ binding.

```powershell
node --test --test-name-pattern='review placeholder fragment:' .test-build-adapter-candidate/search-fragment-v20-baseline/tests/facebook-search-post-open-review.test.js
```

Tests nằm trong `tests/facebook-search-post-open-review.test.ts`; positive chạy complete DISCOVER/CLICK scripts, không dùng loadURL hoặc fabricate post ID. Sau freeze sẽ giữ fixture/expectations và kiểm classifier/binding cùng native fragment cần thiết; không lặp suite không đổi. Quyền action/gates/validity không thay đổi, chưa claim đã sửa đủ nguồn thật.

## Final frozen review

Đã đọc [handoff](../handoffs/p02-search-placeholder-fragment-2026-10-28.md), source classifier và native fixture; đối chiếu manifest `p02-search-placeholder-fragment-files-2026-10-28.json`. Code chuyển kiểm fragment vào branch placeholder same-origin/same-path với đúng regex `^#\?[a-z]{3}$`; ngay sau branch vẫn từ chối mọi fragment trước post-route cases. Query/protocol/host/path/topic/duplicate/length guards giữ nguyên; không strip hoặc canonicalize href để vượt binding.

**30/30 focused checks PASS** trong `.test-build-adapter-candidate/search-fragment-final/`:16 reviewer +14 owner. Cả3 baseline cases đạt với fixtures/expectations nguyên. Same-node mutation chỉ đổi fragment được phép vẫn STALE_TARGET/zero click. Negative family/origin/path/query/post-route giữ fail-closed. R-SO1/2/3, shape bounds/redaction, Stop pendingCLICK/READ và pre-click owner/navigation regressions vẫn đạt trong cùng focused files; không chạy lại suite không đổi khác.

Native Electron reviewer tự chạy trên bản copy frozen build riêng:

| Case | Actual clicks / post reads | Kết quả |
|---|---|---|
| Fragment opaque cùng dạng quan sát | 1 / 1 | OPENED_POST_SAMPLE; click handler nhận nguyên observed href |
| Chỉ fragment đổi trên cùng element sau discovery | 0 / 0 | STALE_TARGET |
| Fragment cùng family nhưng trên post route | 0 / 0 | NO_ELIGIBLE_TIMESTAMP / HREF |

**3/3 native PASS**, external requests0, windows/webContents cleanup0. Native fixture khẳng định chỉ một initial search document request, không reload placeholder. Các native cases owner khác không được tính vào số reviewer tự chạy.

**27/27 owned hashes và67/67 copied native build hashes khớp** trước native run và cuối receipt. [Final receipt](adapter-p02-search-placeholder-fragment-final-files-2026-10-28.json) giữ đầy đủ hashes và native refs. Compiled controller không đổi: `6efb4afac58afc02f75bca753f199e1676640566909bd1e300571d0a6656e6de`. Discovery `bcbb45e85ce60432c6d7d3eb3702e885151c14718d470b3f631ef2b2dd3ccb5d`; click `4a4906d6869b384375872e6f4b91a9b1529448e10247b561143af08b2a8cb520`. Default search/current-post hashes vẫn nguyên.

Core-ready đã báo lead trước khi hoàn tất receipt. Không có blocker ở scope này; cần đúng một LIVE diagnostic để biết còn điều kiện khác loại timestamp hay không. Review không xác nhận Facebook bot-block, không claim đã thu được bài LIVE sau patch, không nâng gate/valid/source verification hoặc bắt đầu pilot.
