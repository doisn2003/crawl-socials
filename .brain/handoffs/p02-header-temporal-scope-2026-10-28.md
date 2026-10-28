# P02 temporal scope v6 — code ready

Ngày28/10/2026, Asia/Bangkok. Theo [dispatch](lead-p02-temporal-scope-dispatch-2026-10-28.md) và [LIVE v5](../evidence/p02-live-header-temporal-v5-2026-10-28.md):2108nodes/7boundaries/0samples, local text/ancestor limits có dấu vết, không global cap. Source shape thật vẫn chưa được xác nhận. Owner không thao tác runtime6680/source724678, shared dist hoặc master/gates; permission UNKNOWN/benchmark OFF/valid0.

## Thay đổi hẹp

- `collectTemporal` dùng record owner trong `temporalScopes`, đã truyền từ parent qua chính bounded walk. Không tìm lại8ancestor trên mỗi text node, không dò thêm subtree, không `.textContent`, không suy owner khi map không biết. Text trước body, ngoài heading/quote và các vùng bị prune mới được thu. Whitespace visible vẫn tham gia raw string. Main walk vẫn charge từng node vào2500nodes/1giây.
- `headerTextNodes`16→96 theo quyết định lead, `headerTextChars` vẫn96. Append xét cả hai cap; vi phạm làm record limited, toàn record không match. Whole string chỉ được classify sau boundary walk hoàn tất. Prefix hợp lệ với tail không hợp lệ vẫn0sample; tail vượt char/node/global cap không dùng để giữ prefix.
- Header cluster giữ8ancestor, không ghép time/public/heading khác cluster. Các cap16records/4control probes/64probe nodes/12boundaries/5samples/32KiB/main4giây và negative/barrier/identity/contact/lifecycle guards giữ nguyên. Loại `limits.temporalAncestors` đã không còn áp dụng; `headerAncestors:8` vẫn đúng. Không đổi classifier hoặc network/session/BrowserHost/UI/menu.
- Script/result/controller/validator/writer/payload cùng **schema6** vì metadata temporal đổi. Các native fixture version assertions đổi6; index/smoke/flags giữ nguyên. Chỉ build `.build-csd-dom`, tests `.test-build-csd-dom`.

## Metadata counts

Thay `temporal.ancestorLimits` bằng các counter dưới đây, cùng allowlist ở diagnostics và tối đa5 rejection shapes. `diagnostics.headers.ancestorLimits` vẫn dành cho header cluster, không đổi.

| Counter | Ý nghĩa quan sát |
| --- | --- |
| `recordLimits` | Lần register bị cap16records từ chối. |
| `charLimits` | Record đã thấy phần text vượt96chars, tối đa1lần/record. |
| `textNodeLimits` | Record đã thấy quá96textnodes, tối đa1lần/record. |
| `probeLimits` | Control probe bị cap64nodes ngắt; boundary chưa hoàn tất bị loại. |
| `scopeMisses` | Visible text đủ điều kiện header nhưng parent không có known temporal owner; không suy owner. Có thể là text thông thường ngoài link, không chứng minh một link bị cắt hoặc có date. |
| `emptyText` | Record hoàn tất, không có label temporal được nhận, visible string rỗng sau normalize. |
| `classifierMisses` | Record hoàn tất, không limited/heading, có visible string nhưng whole string không thuộc format đã biết. |

`textLimits` giữ aggregate compatibility: record-limit attempts, first char/node limit của record và probe limit; các reason có thể chồng nhau nên không cộng chúng thành unique records. `unmatched` vẫn gồm limited/heading/empty/classifier miss; register thất bại chưa có record không thuộc unmatched. Counter là observed attempts, không unique posts, không bằng chứng hoàn chỉnh khi bị prune/partial. Không ghi raw date/text/label/href/CSS/DOM path, không max-length raw values.

R-T2 đổi lý do đúng contract: tail sau8wrappers được thu đầy đủ rồi **classifier không match**, thay vì vô hiệu vì ancestor cap. Expected0 giữ nguyên, bỏ assertion temporal ancestorLimits>0 vì collector không còn probe đó. R-T3 whitespace và R-T1 quote expected0 giữ nguyên.

## Checks trên snapshot v6

```powershell
node scripts/facebook-dom-diagnostic-build.mjs
node --test .test-build-csd-dom/tests/facebook-public-candidate.test.js
node scripts/facebook-public-candidate-smoke.mjs --temporal --output .brain/evidence/p02-header-temporal-scope-2026-10-28.json
```

Build PASS; **12/12 candidate unit tests PASS**, **3/3 native temporal cases PASS**. Không lặp unrelated native suites; không sửa/chạy reviewer harness. Reviewer baseline v5 đã được lead báo6targeted tests=4PASS/2FAIL; chưa gán kết quả đó cho snapshot mới.

- Positive:5samples/323visits. Date20chars tách từng ký tự sau10wrappers (display:contents), role-link boxless có whitespace node, A role=button với đúng96chars/96textnodes, control và label-only control đều nhận được. Không TIME/ABBR hỗ trợ; char/node limits0. Cluster được tính tại link root trong phạm vi8ancestor.
- Negative:0samples/197visits. Giữ R-T2 deep invalid tail, R-T3 spaced digits, R-T1 plain Q/quote, body/comment/embedded/sidebar/heading/hidden/cross-cluster và footer Friends/Sponsored. NO_TEMPORAL7, CONFLICTING2, AD1, NO_HEADER_CLUSTER1; classifierMisses12/emptyText1, không temporal ancestor counter.
- Limits/partial:0samples/2500visits.97textnodes/97chars (prefix sau trim vốn hợp lệ) bị loại; single text node97chars cũng bị loại. Hai boundary hoàn tất cho NO_TEMPORAL2, rồi global incomplete boundary1. charLimits3/textNodeLimits2/emptyText1, không giữ partial prefix/body.97nonemptytextnodes cũng vượt96chars nên hai reason có thể cùng xuất hiện; single-node case tách được char-only.
- Unit schema rejectsv5/raw temporal fields/non-numeric scope counter/out-of-range limit counts; lifecycle/barrier/bytes/redaction checks vẫn PASS. Native external0, observer không attach, shutdown0windows/0WebContents, temp data xóa sạch.

[Evidence](../evidence/p02-header-temporal-scope-2026-10-28.json) và [manifest source/build frozen](../evidence/p02-header-temporal-scope-files-2026-10-28.json). Manifest hash chuỗi fixed script thực thi và compiled controller module riêng; copied probe-build metadata chỉ là bootstrap baseline. Source/build giữ ổn định cho reviewer/lead; owner LIVE reads0. Chưa chứng minh shape timestamp thật hoặc đủ giải quyết LIVE, chưa activation từ worker.
