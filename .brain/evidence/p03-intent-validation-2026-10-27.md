# P03.01 — Intent model validation, 2026-10-27

Owner subagent `/root/csd_adapter`, theo [dispatch](../handoffs/p03-intent-dispatch-2026-10-27.md). Đầu ra [spec](../specs/campaign_intent.md). Chưa tự cập nhật trạng thái task/gate trong master plan.

## Kiểm đã chạy

```powershell
.\node_modules\.bin\tsc.cmd -p .test-build-intent/tsconfig.intent.json
node --test --test-reporter=tap .test-build-intent/tests/campaign-intent.test.js
```

Compile cô lập PASS, **16/16 tests PASS** sau R05, 0 fail/skip; [TAP](p03-intent-tests-2026-10-27.tap). Config riêng extend tsconfig.tests.json nhưng chỉ include `tests/campaign-intent.test.ts`, outDir `.test-build-intent`; không ghi build chung.

| Invariant | Bằng chứng kiểm |
| --- | --- |
| Trace Unicode | Composed/decomposed có cùng key; raw khác được giữ, trace chỉ ra NFC thay đổi; NBSP/tab/NEL/em-space/narrow-space được chuẩn hóa |
| Không ép type | Null/undefined/array/object/String wrapper, text rỗng/control/lone surrogate trả code cố định, không echo payload; emoji hợp lệ được giữ |
| Literal và alias | Dấu/punctuation/fullwidth giữ ở canonical; Tiny Cafe không thành cafe; umlaut không tự bị fold thành Latin trơn |
| Explicit structure | Keyword mặc định không được suy thành brand; declaration BRAND/EXACT_PHRASE có ref/index đúng; source path và text nguyên vẹn |
| Collision | ma/má/mà và Tiny Cafe/Tiny Café giữ term riêng, alias collision chỉ để đối chiếu; NFC/space/case duplicate keyword báo lỗi thay vì tự bỏ dòng |
| Campaign contract | Snapshot giữ mode DRAFT, target 1.000/86.400, source minima, policy/open questions và language/content data; Hanoi ANY preference không thành required filter |
| Negative conditions | Exclusions rỗng không tự thêm; điều kiện âm giữ nguyên, NOT_EVALUATED; không giả substring matcher hoặc đánh giá negative review |
| Boundary/determinism | Dùng validator CampaignSpec hiện có, gồm R01 from < to; enum declaration array/object bị từ chối; input mutation không thay model, deep-frozen output không sửa được; cùng input ra cùng output |

## R05 — sửa sau review vòng 1

[Lead review](lead-p03-intent-review-2026-10-27.md) chỉ ra NFD + xóa combining marks toàn chuỗi đổi alias Cyrillic й→и và Greek ά→α, sai phạm vi policy; bộ 14 test trước chưa bắt được. Raw/canonical vẫn nguyên và chưa có merge/query thực thi, không coi lỗi alias là bằng chứng đã mất raw data hoặc đếm sai bài.

Đã thay global stripping bằng bảng ký tự nguyên âm tiếng Việt có dấu và đ, áp dụng sau NFC/case normalization. Marks/ký tự ngoài bảng giữ nguyên. Thêm hai regression có composed/decomposed Cyrillic/Greek, mixed-script, residual mark trên x; kiểm Đặng→dang, café→cafe, Müller giữ umlaut. Kiểm model collision report chỉ báo Đặng/Dang, không báo й/и hoặc ά/α. Tổng **16 tests PASS**. Không NLP, language detection, query expansion hoặc thay normalization policy thành bộ fold mọi hệ chữ.

## Giới hạn đã giữ rõ

- Chỉ normalization/modeling. Không classifier, semantic parsing, entity resolution, post relevance, query expansion, LLM, UI hoặc lookup nguồn. Nhãn BRAND/PLACE không chứng minh entity đúng ngữ cảnh; `entity_verification=NOT_PERFORMED`.
- Intent/exclusion là condition chưa đánh giá. Không quảng cáo đã hiểu phủ định, câu điều kiện hoặc giải quyết yêu cầu semantic của P06.
- Case key dùng Unicode lowercase mặc định; không full Unicode case-fold hoặc NFKC. Accent alias là mapping dấu tiếng Việt có version, không chống homograph và không dùng làm identity/dedup bài.
- Declaration gắn keyword index của snapshot, không là ID entity toàn cục. Caller phải cập nhật declaration khi đổi thứ tự keyword; module không tự đoán annotation cũ.
- Public API builder yêu cầu một CampaignValidator tin cậy từ ứng dụng; không nhận validator do raw payload cung cấp. Không tự thêm field vào campaign/schema hoặc thay contract.

Không sửa `src/domain/campaign.ts`, schema/config coffee, adapter/observer/main/preload/renderer, package/lock/tsconfig chung, source-probe/preflight artifacts, master plan/README. Không chạy Electron/live hoặc thêm dependency. Chưa nhận P03.02.

[Handoff](../handoffs/p03-intent-2026-10-27.md) · [SHA-256 manifest](p03-intent-manifest-2026-10-27.json).
