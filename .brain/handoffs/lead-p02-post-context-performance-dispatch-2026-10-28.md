# P02.02 — Tối ưu quét security trước post-context

Đọc [nghiệm thu/LIVE v14](../evidence/lead-p02-post-context-review-2026-10-28.md). Lượt thật1574ms, visited0/inspected0, TIME_LIMIT trước body. Không auth/challenge/deny được quan sát. V14 source đã nhận về correctness offline nhưng chưa đọc được current post trên nguồn.

- **CSD agent**: source/owner tests/native workload + manifest/handoff, build riêng như trước. Không reviewer files/shared dist/runtime/.env/master/README.
- **csd_adapter**: baseline frozen v14 trên native workload hoặc harness phù hợp; kiểm semantics security/uniqueness/sentinel và workload sau fix. Chỉ reviewer tests/report/build riêng. Phối hợp file harness với owner trước khi sửa cùng file; ưu tiên dùng script riêng trong reviewer build.
- **Lead**: shared dist/runtime25552/main1837224/source2230372,1/3 starts và nghiệm thu/LIVE. Không lặp v14.

1. Tái hiện chi phí trước barrierSpend trên native DOM nhiều element/text không liên quan, gồm những vùng phía sau và comments. Đo rõ stage security XPath/dialog XPath/preparation nếu cần; không cho timings làm nguồn dữ liệu hay đổi budget. Có thể benchmark offline frozen script và predicate riêng trên fixture tổng hợp; không nguồn thật trong worker.
2. Tối ưu fixed security predicate: hiện normalize/translate lặp nhiều lần trên mọi element/attribute/text. Có thể lọc node có attribute trước, gộp exact phrases không trùng và normalize một lần theo cách tương đương, hoặc cơ chế có bound khác. Đây là gợi ý, cần đo và chứng minh. Không substring fuzzy, không giới hạn security scan chỉ trong post khiến bỏ wrapper/sibling auth; không bỏ text/attribute marker để xanh.
3. Giữ priority auth/challenge/deny trước allowed dialog,16+1 sentinel, hidden/visible rules, outer wrapper uniqueness,1s script/4s main/2500 steps và shared3 starts. Exact marker ở cuối DOM lớn vẫn phải được tìm/dừng; overflow/incomplete vẫn không xuất payload. Giữ comment isolation và route hints UNVERIFIED.
4. Baseline và fix trên cùng workload, native positive và cuối-DOM barrier negatives; nêu thời gian đo và điều kiện máy, không hứa mọi Facebook DOM <1s. Không nới guard/cap hoặc benchmark sang mạng. Reviewer không cần thêm broad framework, chỉ checks liên quan và regression bị đụng.
5. Chốt freeze/hashes nhanh sau proof hữu ích; lead nạp và thử đúng1current-post action. Nếu vẫn quá chậm, báo stage thực sự nghẽn để đổi thuật toán, không thử nguồn lặp vô hạn.

Task vẫn P02.02 IN_PROGRESS. Không gate PASS, không source AVAILABLE, không tự thêm collector/continuation/DB.
