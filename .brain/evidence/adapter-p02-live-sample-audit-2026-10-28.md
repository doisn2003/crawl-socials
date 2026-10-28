# P02.02 — Audit độc lập một sample LIVE v15

Ngày 2026-10-28, Asia/Bangkok. Reviewer: `csd_adapter`. Theo [dispatch](../handoffs/lead-p02-route-verification-dispatch-2026-10-28.md), chỉ đọc đúng `candidates.json` trong `local_directory` của [summary sạch v15](p02-live-post-performance-v15-2026-10-28.json). Không đọc profile, `.env`, artifact khác hoặc nguồn/UI mới; không chỉnh artifact gốc. Báo cáo không chép body, địa chỉ cụ thể, tên người, ID Facebook hoặc URL nguồn.

## Quyết định relevance

**ACCEPT / CAFE_BRAND_CONTEXT** cho nội dung sample 0 đã lưu. Snippet mô tả việc sang nhượng một quán cà phê cụ thể và điều kiện mặt bằng/hoạt động của quán; mối liên hệ với quán đủ rõ, không chỉ khớp từ khóa. Product contract và rubric không loại sang nhượng. Không cần biết chính xác địa phương để phân xử vì geography ANY; không suy địa phương từ truy vấn.

206 ký tự đã lưu đủ nghĩa để quyết định relevance ở phạm vi snippet này. `VISIBLE_SNIPPET` không chứng minh đã lấy toàn bộ bài; không đổi chất lượng text thành FULL và không cần gán CONTENT_TRUNCATED chỉ vì đây là snippet khi ý quyết định đã rõ.

Quyết định dưới đây chỉ ở chiều relevance, theo spec hiện có cho phép thử diagnostic; không đại diện một campaign/run benchmark đã freeze:

```json
{
  "schema_version": "1.0.0",
  "rubric_version": "coffee-relevance-1.0.0",
  "policy_version": "coffee-intent-v1",
  "campaign_id": "coffee-public-facebook-v1",
  "contract_version": "1.0.0",
  "observation_ref": "v15-live-current-post:sample-0",
  "record_version": "current-post-schema-14:sample-0",
  "result": "ACCEPT",
  "reasons": ["CAFE_BRAND_CONTEXT"],
  "evidence_refs": [
    {
      "ref": "v15-live-current-post:candidates.json#/samples/0",
      "version": "current-post-schema-14",
      "sha256": "aa27d62070326ef61b0a86426211214085c7037e16adf5dbfeb2615dba5c15d5",
      "role": "CONTENT"
    }
  ],
  "missing_evidence": [],
  "rationale": "Snippet mô tả sang nhượng một quán cà phê và điều kiện mặt bằng/hoạt động của quán, đủ chứng minh liên quan đến quán theo rubric; không có exclusion sang nhượng."
}
```

Evidence ref xác định sample bằng JSON pointer; SHA-256 là **toàn bộ bytes candidates.json**, không phải hash riêng text hoặc danh tính bài. Payload thực tế khớp hash trong summary trước audit. `record_version` ở đây chỉ version artifact/schema và vị trí sample, chưa có domain record trong DB.

## Contact redaction và ranh giới nội dung

| Chiều kiểm | Quan sát và giới hạn |
|---|---|
| Contact redaction | Text có placeholder `[NUMBER]` ở phần liên hệ, phù hợp cờ `contacts_redacted=true`. Không thấy email hoặc số liên hệ nguyên trong snippet được audit. Một số đo diện tích còn lại có ý nghĩa nội dung, không tự xem mọi chữ số là contact. |
| Giới hạn redaction | Không đọc bản nguồn chưa redact, nên không chứng minh mọi contact của bài gốc đều đã được phát hiện, cũng không đánh giá false positive/recall tổng thể của sanitizer. |
| Body so với comment | Nội dung nhất quán một mô tả chuyển nhượng quán; không thấy dấu hiệu rõ của chuỗi trả lời, nhiều tác giả hoặc UI controls bị ghép vào text. Summary ghi một message group và một nested alias, phù hợp đường đọc một body. |
| Giới hạn containment | Không có DOM gốc/comment gốc để đối chiếu độc lập. Artifact vẫn `boundary_verified=false`; tính mạch lạc của text và metadata không đủ để xác minh chắc chắn mọi phần đều thuộc post, hoặc không có comment contamination. Không nâng boundary proof. |
| Độ đầy đủ | `VISIBLE_SNIPPET`, 206 ký tự; không phải tuyên bố full text. Temporal status UNREADABLE và ngày đăng thiếu; UNBOUNDED không tự loại relevance. |

## Các chiều chưa được nâng trạng thái

- Sample `post_id` và `permalink` vẫn null; context hint có ID/route từ `OBSERVED_CURRENT_URL` nhưng `UNVERIFIED`, chưa mở lại để đối chiếu.
- `source_type=UNKNOWN`; một public-group signal và một public header cluster là evidence diagnostic, không tự cấp source classification hoặc overall public validation.
- Chưa đủ evidence cho overall ACCEPT, identity unique, canonical permalink hoặc source AVAILABLE. Giữ **verified_valid_count=0**, benchmark OFF, permission UNKNOWN.
- Không cộng sample này với hai snippet v13 thành ba bài unique. Một mẫu không hoàn tất P06.01, không là quality score hoặc evidence đạt 1.000 bài/24 giờ.

## Snapshot/hashes đã dùng

| Evidence/spec | SHA-256 |
|---|---|
| Local candidates.json, toàn bộ bytes | `aa27d62070326ef61b0a86426211214085c7037e16adf5dbfeb2615dba5c15d5` |
| Summary gốc theo lead ref; reviewer không đọc thêm file gốc | `3518e615cf2fa123c0c2017afcd26fdf22a4b4d873bc153f2e18f3183bf08e04` |
| Summary sạch v15 đã đọc | `5651bca4c65b47775f70c79dd393a918e033348c85829ae7b2d0552923b11500` |
| Product contract 1.0.0 | `5d11553e630f02758fa244463de42db6fffff9084d4875a5901e4d41c64252de` |
| Campaign coffee | `858e5464b6fa70ca58ca97044bb52803cb3bffeb2309ead2abb0709cf78e2e8b` |
| Rubric coffee-relevance-1.0.0 | `66f2dbbef684295043be9d0c8caeac2f51ef169f7d1cda66f0f9590d009ea2ae` |
| Relevance decision schema 1.0.0 | `056195bfe834665166bcd596258be22a4de3eae697ebb1dd690cfd46d93318af` |

Decision JSON đã kiểm bằng Ajv hiện có với `relevance_reason_codes.schema.json`. Các hash spec là snapshot audit, không khẳng định đã có benchmark manifest/run freeze. Artifact vẫn ở ngoài repository với TTL và manual cleanup theo summary gốc; audit không gia hạn thời gian lưu.

## Chuẩn bị review ADR-015

Chờ owner code-ready; chưa viết test dựa vào API chưa bàn giao. Các ca trọng yếu dự kiến:

1. Anchor chỉ từ successful current-post run trong đúng process/profile/owned view; không nhận artifact/URL tùy ý, không dùng anchor cũ sau restart hoặc sau route/owner đổi rồi quay lại.
2. Chỉ một navigation tới observed route đã kiểm; đọc sau generation mới và đúng route/IDs dạng string. Redirect/route swap/view replacement hoặc document generation đổi trong lúc đọc không được REOPEN_MATCH.
3. Same redacted body và đủ evidence mới có REOPEN_MATCH; changed/empty/multiple samples, thiếu public-group proof hoặc security barrier phải mismatch/inconclusive phù hợp. Match của nội dung đã redact vẫn không chứng minh full text hoặc canonical identity.
4. Stop/timeout/late navigation/read phải giữ native pending fence và shared 3-start budget; operation đang chạy không cho diagnostic khác chồng lên.
5. Summary chỉ enum/count/ref/hash; local artifact giữ hai run refs/provenance đúng, không sửa context hint/artifact UNVERIFIED ban đầu hoặc tự nâng relevance/source/valid/gate.

Audit kết thúc. Reviewer dừng chờ implementation/handoff; không thực hiện route verification LIVE.
