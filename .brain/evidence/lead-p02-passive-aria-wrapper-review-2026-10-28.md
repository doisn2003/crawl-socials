# P02.02 — Lead review passive ARIA wrapper v25

28/10/2026, Asia/Bangkok. Owner freeze 01:17:01.433Z tại p02-passive-aria-wrapper-files-2026-10-28.json.

Lead đã đọc thay đổi classifier: chỉ cho qua aria-labelledby trên HTML SPAN ngoài SVG, sau type/length/count/namespace guards; không lookup IDREF, không dùng value làm proof, không bỏ các attributes hoặc descendants còn lại. Thay đổi index/fixture chỉ thêm các ca synthetic tương ứng, không đổi action scope/schema/controller. Giá trị không được đưa vào metadata.

Kiểm độc lập: 4 focused owner tests PASS (passive positives/negatives/bounds/binding và first-failure/schema); 2 native PASS (observed-passive-svg, observed-passive-limit). Native positive mở 1 link quan sát và đọc 1 bài fixture; >160 vẫn dừng. Evidence lead-p02-passive-aria-{svg,limit}-2026-10-28.json. Không chạy lại suite rộng không đổi.

27 owned + 69 isolated hashes khớp, shared build PASS, 135 frozen hashes khớp. Reviewer đang kiểm riêng; chưa nạp LIVE trước core-ready. Permission UNKNOWN/benchmark OFF/valid 0/gates giữ nguyên.

## Nghiệm thu và LIVE

Reviewer PASS, không finding: 5 focused checks + native stale-attribute, 27 owned/69 copied hashes ổn định. Report/receipt adapter-p02-passive-aria-wrapper-review-2026-10-28.md và adapter-p02-passive-aria-final-files-2026-10-28.json. Nghiệm thu thay đổi ARIA v25.

Lead đóng v24 bình thường, kiểm PID cũ đã mất rồi nạp v25 PID19440/main591142/source2098306, bảo toàn profile. Query/public filter khôi phục; một right-click timestamp/Escape, không scroll hoặc click điều hướng. UI link bài0→1, placeholder5→4. Chưa cô lập event gây đổi.

LIVE 01:27:28.856Z,59ms/2020steps,2qualified headers,0click/read. ARIA ở D1 không còn là failpoint; observed href/targetABSENT/headerCOLOCATED/viewportPASS/visibilityPASS bị ATTR_NOT_ALLOWED/SPAN/STYLE/D2. Placeholder offscreen khác bị SVG/STYLE/D2, targetBLANK. Không auth/challenge/deny. Evidence p02-live-passive-aria-v25-2026-10-28.json.

UI AX xác nhận link bài có dạng GROUP_QUERY, keys multi_permalinks/hoisted_section_header_type/__cft__[0]/__tn__, không fragment. Không xuất URL/ID. Runtime1/3starts đã dùng. Hạn chế hiện tại là classifier gắn proof của permalink đã quan sát vào cách trang trí timestamp; lead quyết định nhánh mở exact observed URL có binding riêng theo ADR-017, thay vì tiếp tục thêm từng thuộc tính CSS. Các gate/benchmark/valid chưa đổi.
