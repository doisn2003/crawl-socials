# Lead review P03.01 — 2026-10-27

Reviewer `/root`. Đã đọc domain/application, 14 tests, spec, fixture và handoff. Lead chạy compile cô lập `.test-build-intent/tsconfig.intent.json` PASS, `node --test .test-build-intent/tests/campaign-intent.test.js` **14/14 PASS**. Không dùng build output đang thuộc controller owner.

## Vòng 1: R05 cần sửa trước nghiệm thu

**P03.01 còn IN_PROGRESS. R05 — alias được mô tả là tiếng Việt nhưng xóa dấu của chữ thuộc hệ chữ khác.** `normalizeIntentText` normalize NFD rồi xóa bộ combining marks trên toàn chuỗi, không xét base character. Những mark đó cũng xuất hiện trong Cyrillic/Greek.

Lead chạy trực tiếp module đã compile, không sửa source/test của agent:

| Input | Canonical giữ nguyên | Alias hiện tại | Kỳ vọng với policy VIETNAMESE_DIACRITICS_V1 |
| --- | --- | --- | --- |
| й | й | и | й |
| и | и | и | и |
| ά | ά | α | ά |
| α | α | α | α |
| Đặng | Đặng | dang | dang |
| Müller | Müller | müller | müller |

Code comment hứa giữ other scripts/marks nhưng không đúng ở hai ca đầu. Canonical/raw không mất dữ liệu và model chưa dùng alias để merge/query, nên đây không phải bằng chứng đã đếm sai bài hoặc mất dữ liệu gốc. Tuy nhiên alias/collision report sai policy và có thể khiến consumer sau dùng sai.

Yêu cầu khoanh folding trên chữ/nguyên âm tiếng Việt phù hợp, giữ combining sequences của hệ chữ khác; thêm regression composed/decomposed Greek/Cyrillic và mixed scripts, vẫn kiểm Vietnamese positive cases. Không dùng NLP/LLM/phát hiện ngôn ngữ hoặc đổi alias thành query. Có thể triển khai bằng mapping tập ký tự tiếng Việt để tránh global strip marks; ghi phạm vi đúng.

Các phần khác review đúng: CampaignValidator có sẵn, source snapshot tách biệt/deep-frozen, explicit brand/phrase, Hanoi preference, empty exclusions và NOT_EVALUATED semantics; không tự tạo query hoặc claims LIVE. Chờ sửa R05 rồi đối chiếu test/hash và nghiệm thu.

## Vòng 2 — R05 đã sửa, nghiệm thu P03.01

Lead đọc bản mapping ký tự tiếng Việt sau NFC/case, không còn global stripping combining marks. Chạy lại compile riêng `.test-build-intent/tsconfig.intent.json` PASS và **16/16 tests PASS**, gồm hai regression Cyrillic/Greek composed/decomposed và mixed script/collision. Manifest **9/9 hashes khớp**. Raw/canonical và nghĩa giới hạn của alias được giữ rõ.

**P03.01 DONE.** P03.02 và P06.01 đủ dependency offline nhưng chưa giao triển khai; ưu tiên kết thúc review controller/source trước. Subagent được giao review read-only writer/freeze của P02.02, chỉ ghi nhận xét ở evidence riêng, không sửa controller hoặc tự nghiệm thu/gate.
