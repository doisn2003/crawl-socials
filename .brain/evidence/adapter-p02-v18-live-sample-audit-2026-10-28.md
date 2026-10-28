# P02.02 — Audit độc lập LIVE v18

Ngày 2026-10-28, Asia/Bangkok. Reviewer: `csd_adapter`. Phạm vi: đúng ba run trong [evidence sạch v18](p02-live-subframe-v18-2026-10-28.json), mỗi run chỉ đọc `summary.json` và `candidates.json` ở kho local diagnostics. Không đọc `.env`, profile, nguồn/UI hoặc artifact khác; không sửa dữ liệu gốc. Báo cáo không lưu body, tên, địa chỉ cụ thể, ID Facebook hay URL nguồn.

**Kết luận: REOPEN_MATCH có evidence local khớp; relevance ACCEPT / CAFE_BRAND_CONTEXT. Đây là một context được đọc hai lần, không phải hai bài. Chưa nâng overall validity, identity hay source verification.**

## Đối chiếu ba run

| Vai trò | Run ref local, không phải ID Facebook | SHA-256 summary.json | SHA-256 candidates.json |
|---|---|---|---|
| Anchor | `candidate-019a4d43-4871-4827-9e91-5b4f11ebd492` | `f559af7bb1d8bb3279fda0c7c4d57b28aad95a6f9494d5f20c6c4a0f0d942293` | `6309d83a2be6708cc7c49c5fafbc5725b3c22402a692f2c97af9886d747214ec` |
| Verification | `candidate-4431a802-2f77-41ad-a98b-1455a717a2cd` | `3635147736c30eeee6ada77a4a0820328e86675295e42d908def4eb4e81406cc` | `ba8a978af549dfa827acb4a2fc1e9d92c4f9e3133a1ef0b0eb23a87b5bed4119` |
| Fresh read | `candidate-01a77755-a83f-47b2-ac54-3bb71ff18089` | `3c1737f84e43f0b533e2cd92f372d306c883ec4f5ac5940e85f0b80606f29fdb` | `7f3544ed9f28e3c08cd2cc4227540a23210ef88ca8af2cad048c4d04cdd28978` |

6/6 hashes tính lại từ toàn bộ file bytes khớp evidence lead. Anchor/reopened/fresh-read refs trong proof khớp run ID, summary hash và candidate-file hash thực tế. Payload có đúng một sample ở anchor và một ở fresh read. Summary sạch và summary gốc có cùng nội dung sau chuẩn hóa cách viết timestamp: một `finished_at` trong summary sạch dùng `.37Z`, file gốc dùng `.370Z`; cùng một instant, không phải sai hash hay dữ liệu bị sửa.

Body đã redact **373 ký tự**, khớp byte giữa anchor và fresh; SHA-256 UTF-8 text là `0561033b0991cf0740e3051eec27b003076e3dec46e23dc5792049e066d37d61`. Context hint khớp toàn bộ string fields trong local artifacts; quality đều `VISIBLE_SNIPPET`. Owner document generation tăng đúng một. Verification ghi một navigation, một fresh read, `fresh_document=true`, `REOPEN_MATCH/MATCHED`, trace năm entries không overflow hoặc cancellation. Trace có child-frame history và main same-document history được xử lý NO_OP trong đúng main context. Điều này là evidence v18; không suy ngược nguyên nhân v16.

Không tuyên bố toàn bộ sample object giống nhau: chỉ hai bộ đếm link khác (`group` 2→3, `other` 1→0); các trường sample còn lại khớp. Hai lần đều `public_signal=DIRECT_PUBLIC_LABEL`, `headerProof=HEADING_PUBLIC`, một message group với hai nested-alias markers và một public header cluster. Những metadata này không thay thế xác minh độc lập ranh giới post.

## Relevance

Nội dung là tuyển nhân sự **cho quán cà phê**, mô tả công việc phục vụ và hỗ trợ pha chế tại quán. Liên hệ với hoạt động quán đủ rõ, không chỉ là từ khóa xuất hiện tình cờ. Theo product contract và rubric hiện hành, tuyển dụng không phải exclusion; vì vậy ACCEPT ở chiều relevance. Đây không phải bài review/khám phá địa điểm/hẹn hò, và không được dùng để chứng minh đã có mẫu cho các nhóm nội dung đó. Không cần suy địa phương từ truy vấn vì geography ANY.

```json
{
  "schema_version": "1.0.0",
  "rubric_version": "coffee-relevance-1.0.0",
  "policy_version": "coffee-intent-v1",
  "campaign_id": "coffee-public-facebook-v1",
  "contract_version": "1.0.0",
  "observation_ref": "v18-live-current-post:anchor:sample-0",
  "record_version": "current-post-schema-14:sample-0",
  "result": "ACCEPT",
  "reasons": ["CAFE_BRAND_CONTEXT"],
  "evidence_refs": [
    {
      "ref": "v18-live-current-post:anchor:candidates.json#/samples/0",
      "version": "current-post-schema-14",
      "sha256": "6309d83a2be6708cc7c49c5fafbc5725b3c22402a692f2c97af9886d747214ec",
      "role": "CONTENT"
    },
    {
      "ref": "v18-live-current-post:fresh:candidates.json#/samples/0",
      "version": "current-post-schema-14",
      "sha256": "7f3544ed9f28e3c08cd2cc4227540a23210ef88ca8af2cad048c4d04cdd28978",
      "role": "CONTENT"
    }
  ],
  "missing_evidence": [],
  "rationale": "Snippet tuyển nhân sự cho quán cà phê và mô tả công việc phục vụ, hỗ trợ pha chế tại quán; mối liên hệ với hoạt động quán rõ. Rubric hiện hành không loại tuyển dụng. Hai evidence refs là hai lần quan sát cùng context."
}
```

Các evidence SHA trong quyết định là hash toàn bộ file, pointer chọn sample; không phải ID bài hoặc canonical identity. Quyết định đã kiểm bằng Ajv với schema hiện có. Đây là audit relevance của snippet diagnostic, không phải benchmark đã freeze hoặc nhãn overall valid.

## Redaction, body và các giới hạn

- Snippet có một placeholder `[[NUMBER]]`, phù hợp `contacts_redacted=true`. Kiểm trực quan và kiểm dạng số điện thoại/email/URL thông thường không thấy contact còn nguyên. Địa chỉ địa điểm vẫn còn trong local payload; sanitizer không phải ẩn danh toàn bộ địa chỉ hoặc mọi con số. Báo cáo không chép địa chỉ đó.
- Không đọc bản nguồn chưa redact: chưa đánh giá được recall/false-positive tổng thể của sanitizer. Hash khớp chứng minh body **đã redact** khớp, không chứng minh nội dung nguồn nguyên bản hoàn toàn giống nhau.
- Nội dung nhất quán một thông báo tuyển dụng; không thấy dấu hiệu rõ của chuỗi bình luận hoặc nhiều người trả lời bị ghép. Tuy nhiên không có DOM/comment gốc cho audit độc lập; `boundary_verified=false` được giữ nguyên. Metadata một message group và body lặp lại không tự chứng minh không có comment contamination.
- `post_id`, `permalink`, `published_at` vẫn null; source type UNKNOWN; temporal UNREADABLE; context hint vẫn UNVERIFIED với provenance OBSERVED_CURRENT_URL. Reopen match xác minh khả năng mở lại observed route và đọc cùng context/body theo contract kỹ thuật, chưa gán canonical permalink, verified identity hoặc phân loại nguồn.
- `full_text_verified=false`, quality VISIBLE_SNIPPET. Không gọi toàn văn, không xem thời gian vài giây của một read là thông lượng crawler, không tính anchor + fresh thành hai bài unique.
- Giữ `verified_valid_count=0`, permission UNKNOWN, benchmark OFF. Một mẫu không hoàn thành P06.01, không cho tỷ lệ precision/recall hoặc chứng minh mục tiêu 1.000 bài/24 giờ. Audit không gia hạn TTL của ba artifact gốc.

## Snapshot spec/evidence

| File | SHA-256 |
|---|---|
| Evidence sạch v18 | `04979932cf9aa15ce7e23f349fc15af428fe4b146566981b5de92beeaf8a6cdf` |
| Product contract 1.0.0 | `5d11553e630f02758fa244463de42db6fffff9084d4875a5901e4d41c64252de` |
| Campaign coffee | `858e5464b6fa70ca58ca97044bb52803cb3bffeb2309ead2abb0709cf78e2e8b` |
| Rubric coffee-relevance-1.0.0 | `66f2dbbef684295043be9d0c8caeac2f51ef169f7d1cda66f0f9590d009ea2ae` |
| Relevance decision schema 1.0.0 | `056195bfe834665166bcd596258be22a4de3eae697ebb1dd690cfd46d93318af` |

Reviewer không chạy thêm LIVE hay thay source/gate; hoàn tất audit, giữ vai trò review cho triển khai tiếp theo.
