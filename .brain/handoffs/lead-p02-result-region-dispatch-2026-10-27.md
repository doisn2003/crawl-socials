# P02.02 — Chọn vùng kết quả và nhận dạng cấu trúc card

Ngày 2026-10-27. Tiếp nối ADR-010 và [DOM thật đầu tiên](../evidence/p02-live-dom-structure-2026-10-27.md). Bản mixed đã nghiệm thu và script đã chạy thật; không quay lại Meta grant/login/source route blocker cũ.

## Vấn đề cụ thể

NO_MATCH sau2500 nodes (cap), article/main/feed0, post-link2/group5, không time-limit. UI có results. Chưa phân biệt được card không dùng role article hay chưa quét tới vùng đúng. Không lấy heuristic failure làm kết luận nguồn không có bài.

## CSD agent — code tiếp trong đúng module

Sở hữu các module/tests/scripts facebook-dom-diagnostic đã có và handoff/evidence prefix p02-result-region. Không sửa master/README/ADR hoặc reviewer test. Build riêng giữ `.build-csd-dom`/`.test-build-csd-dom`; không shared dist, không restart/source thật. Lead giữ runtime21432/main3084806/source3278844.

1. Bổ sung lựa chọn root semantic có giới hạn: kiểm `main` và `[role=main]` (giả thuyết dựa trên AX observed main Kết quả tìm kiếm), role feed nếu cần; ghi loại root đã chọn, số root candidate/cap và fallback-body rõ. Không persist tên/aria-label/data-pagelet value/classes/HTML. Không tự tuyên bố selected main đúng results chỉ từ selector.
2. Quét vùng root đã chọn với cap node/time/output hiện có; report phân biệt không tìm root, hết cap và không khớp cấu trúc. Không đơn thuần tăng 2500 thành cực lớn.
3. Với tối đa5 post-like links đã gặp trong phạm vi: metadata về ancestor chain bounded (ví dụ tối đa8 mức) bằng tag/role enums và presence/buckets; tìm khác biệt giúp định vị card khi không có article. Không trả raw href/post ID/text/name/attributes. Các hint text/public/ad nếu cần chỉ là fixed label booleans và phải cùng bounded walk, không full innerText scan vô hạn. Không gọi link count là unique posts hoặc public evidence đã đủ.
4. Nếu không thể xác định khung từ dữ liệu giới hạn, report nêu chính xác thiếu quan sát nào để lead quyết định bước tiếp; không tạo framework mới hoặc đoán GraphQL endpoints. Chưa extractor nội dung trước evidence cấu trúc/publicity đủ.

Kiểm có ý nghĩa: fixture body có >2500 nodes chrome trước vùng kết quả; kết quả div không có role=article nhưng có post-like link; root thiếu/đa root/partial; mixed Page/ad/post và redaction; provenance/limits/lifecycle cũ vẫn đạt. Output schema version phải phân biệt thay đổi; validator và fixture theo cùng version. Native fixture dùng đúng main/script path. Báo code ready sớm, handoff ngắn+manifest; giữ old live report immutable.

## Subagent reviewer

Sở hữu `tests/facebook-dom-diagnostic-review.test.ts` và review evidence của mình, output `.test-build-adapter-dom`. Review code mới: root scope không lẫn nav/dialog/sidebar; ancestor output không lộ values/content; bounds không reset mỗi link/card, không giả PUBLIC/entity/unique; constructor/validator/script version cùng nhau. Báo lỗi có repro, không sửa implementation owner. Chỉ chạy tests độc lập khi code mới có; giữ max2 workers.

## Lead

Review/compile/native fixture/hash rồi nạp khi cần; chỉ một lượt đọc cấu trúc mới trên cùng query. Khi xác định đủ card/publicity/permalink shape mới giao extraction <=5 public candidates. Không gate PASS từ diagnostic, không benchmark hoặc scale/UI/framework thêm.
