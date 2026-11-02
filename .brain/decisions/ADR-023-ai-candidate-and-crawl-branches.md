# ADR-023 — Chốt ứng viên AI và phát triển crawl độc lập

- Ngày: 02/11/2026, Asia/Bangkok.
- Trạng thái: ACCEPTED FOR DEVELOPMENT — người dùng giao agent quyết định cách quản lý Git.
- Mốc trước tổ chức: `9f579b0` trên `codex/csd-production`; source là CSD 0.3.0-rc.4.
- RC6 được chấp nhận tạm để phát triển tiếp. Các lỗi ngữ nghĩa đã báo vẫn mở.

## Quyết định

Chốt chung hai thành tựu hiện có — phủ ngữ nghĩa/hỏi ngược và bộ lọc hai nhãn — thành một commit ứng viên đã kiểm thử. Hai cơ chế hiện cùng sửa luồng campaign, pipeline và giao diện; không dựng lại một mốc RC5 giả định bằng cách tách hunk chưa được kiểm chứng.

Giữ hai nhánh tính năng độc lập từ cùng nền RC4, có một nhánh tích hợp để thử chung. Nhánh crawl không xuất phát từ commit RC6: như vậy có thể nhận riêng cải tiến crawl khi AI chưa được chấp nhận.

| Nhánh | Vai trò | Nền và hướng đi |
|---|---|---|
| `codex/csd-production` | Mốc sản phẩm hiện có | Lượt tổ chức này chỉ thêm quy ước Git; chưa nhận source RC6. `main` là mốc cũ, không phải đích merge của quy trình này. |
| `codex/ai-foundation` | Hai cơ chế AI và các cải tiến tiếp theo | Từ nền chung RC4; chứa ứng viên RC6 và các commit sửa ngữ nghĩa riêng sau này. |
| `codex/crawl-throughput` | Crawl nhiều cửa sổ và điều phối băng thông AI | Từ cùng nền RC4, không kế thừa RC6; commit riêng cho pool cửa sổ và scheduler/quota. |
| `codex/csd-next` | Thử bản kết hợp | Nhận merge từ hai nhánh tính năng; ban đầu bằng ứng viên RC6. Thay đổi nghiệp vụ làm trên nhánh tính năng, không viết trực tiếp ở đây. |

Đây là quy tắc phát triển và tích hợp, không chứng nhận chất lượng mô hình. Việc sửa, kiểm thử, commit trên các nhánh phát triển trong phạm vi được giao không cần xin lại DUYỆT.

## Các mốc cố định

- Annotated tag `csd-pre-ai-rc4-20261102`: nền chung trước hai cơ chế AI, kèm tài liệu quản lý nhánh.
- Annotated tag `csd-ai-candidate-rc6-20261102`: source của ứng viên RC6 hiện tại.
- Giữ nguyên các tag đã tạo. Mốc thử mới dùng tag mới, chẳng hạn `csd-ai-candidate-rc6.1-YYYYMMDD`.
- Một commit nền tài liệu được thêm trước khi tách nhánh; runtime của nền chung không đổi so với `9f579b0`.

Ứng viên RC6 đã có 950 unit tests, typecheck và kiểm tra giao diện đạt; replay 5.778 hội thoại trong bốn bộ AppData không còn lỗi kỹ thuật. Các ca sai ngữ nghĩa và xếp hạng vẫn được giữ trong evidence của nhánh AI. Đây không phải kết luận accuracy hoặc nghiệm thu production.

## Worktree

| Thư mục | Nhánh |
|---|---|
| `C:/OwnProject/crawl-socials` | `codex/csd-next` — xem/thử bản kết hợp |
| `C:/OwnProject/crawl-socials-ai` | `codex/ai-foundation` — sửa prompt, mục tiêu, điều kiện, bằng chứng, phân loại, ranking |
| `C:/OwnProject/crawl-socials-crawl` | `codex/crawl-throughput` — phát triển phần crawl và điều phối công suất |

Worktree chia sẻ lịch sử Git nhưng có thư mục làm việc/index riêng. Thay đổi ở thư mục crawl không tự xuất hiện ở thư mục AI. Mỗi worktree tự cài dependencies khi cần chạy; không chia sẻ thư mục build hoặc node_modules bằng junction.

Không mở nhiều bản CSD trên cùng AppData để kiểm thử đồng thời. Khi cần chạy song song các bản ứng dụng, cấu hình thư mục dữ liệu kiểm thử riêng; không đổi hoặc ghi đè bộ AppData gốc chỉ để đổi nhánh. Các cửa sổ collector trong một lượt CSD là công việc phát triển khác với worktree Git.

## Quy tắc phát triển

1. Nhánh AI giữ prompt/recipe, hợp đồng mục tiêu, đối chiếu bằng chứng, logic nhãn và ranking. Mỗi cải tiến có commit, ca kiểm thử và kết quả riêng.
2. Nhánh crawl giữ quản lý cửa sổ/webContents, hàng đợi, dedup, Stop/Resume, admission/backpressure và scheduler gọi model. Giữ ý nghĩa đầu vào/đầu ra hiện có; không nới tiêu chí lọc để tăng số bài.
3. Nếu phải đổi interface dùng chung, dùng commit riêng, ưu tiên tương thích ngược; kiểm tra cả nhánh tính năng và bản tích hợp. Không mặc định Tier 1 có một giới hạn cố định cho mọi model/project; lấy hạn mức thực khi triển khai scheduler.
4. Không merge `codex/csd-next` hoặc nhánh AI vào nhánh crawl khi còn cần khả năng phát hành crawl độc lập. Phần kết nối riêng với RC6, nếu cần, phải được tách khỏi cải tiến crawler dùng chung.
5. Merge có lịch sử rõ ràng bằng `--no-ff` cho các nhánh dài hạn; không squash rồi tiếp tục merge cùng nhánh nhiều vòng. Chạy kiểm tra phù hợp sau khi giải quyết xung đột. Worktree không loại bỏ xung đột ở file dùng chung.
6. Không reset cứng nhánh tích hợp để quay lại AI. Sửa trên nhánh AI, rồi merge commit mới sang bản tích hợp; các commit crawl tiếp tục được giữ.

## Khi muốn thử bản kết hợp

Sau khi commit thay đổi ở từng worktree, thực hiện tại worktree tích hợp đang sạch:

```powershell
git -C C:/OwnProject/crawl-socials merge --no-ff codex/ai-foundation -m "merge: update AI candidate in next"
git -C C:/OwnProject/crawl-socials merge --no-ff codex/crawl-throughput -m "merge: integrate crawl throughput in next"
```

Đây là ví dụ quy trình cho những lượt tiếp theo, không tự chạy tính năng mới hoặc gọi API. Khi Git báo xung đột, giải quyết đúng thay đổi và kiểm thử trước khi coi bản kết hợp sử dụng được.

## Khi chốt phát hành hoặc muốn quay lại cải tiến

- **Ưng AI, crawl chưa xong:** nhận riêng `codex/ai-foundation` vào `codex/csd-production`.
- **Ưng crawl, AI chưa ưng:** nhận riêng `codex/crawl-throughput` vào `codex/csd-production`; không nhận `codex/csd-next` vì nhánh đó có cả AI.
- **Ưng cả hai:** sau kiểm thử bản kết hợp, nhận `codex/csd-next` vào `codex/csd-production`, tạo tag phát hành mới.
- **Muốn cải tiến AI:** tiếp tục tại `crawl-socials-ai`, rồi cập nhật `csd-next`. Không phải quay lùi lịch sử chứa các tính năng mới.
- **Muốn dựng lại bản dùng nền cũ + crawl để đối chiếu:** tạo nhánh thử mới từ tag nền RC4, rồi merge nhánh crawl vào đó. Giữ nguyên nhánh tích hợp và các tag để so sánh.

Không dùng số phiên bản, tên nhánh hoặc tag để suy ra model đã đạt chất lượng. AppData, key và quota provider có vòng đời riêng; Git chỉ quản lý source/tài liệu/kiểm thử được chọn.

## Bảo toàn và kiểm chứng việc tổ chức Git

Lượt này lưu snapshot hash của 46 file thay đổi trước khi tổ chức, kiểm tra source được giữ nguyên sau commit, kiểm tra ancestry và diff giữa hai nhánh tính năng. Các file trong artifacts/release/AppData/key không được đưa vào commit. Receipt và Git bundle ở `artifacts/git-organization-20261102/`; bundle chứa lịch sử Git, không chứa AppData, binary phát hành hoặc file bị ignore.

Các nhánh/tag được tạo cục bộ trong lượt tổ chức này. Fetch dùng để kiểm tra origin; chưa push các mốc mới lên GitHub.

## Tài liệu kỹ thuật

[Git worktree](https://git-scm.com/docs/git-worktree), [Git merge](https://git-scm.com/docs/git-merge), [Git tag](https://git-scm.com/docs/git-tag).
