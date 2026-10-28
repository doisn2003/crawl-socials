# Giao P02.02 — chuẩn bị phép thử Facebook cụ thể

Ngày 2026-10-27. Owner: subagent `/root/csd_adapter`. P00.04 đã được lead nghiệm thu sau sửa R04/route binding. CSD agent (chat riêng) vẫn sở hữu P01.03, browser source và build chính. Đọc [review](../evidence/lead-p00-protocol-review-2026-10-27.md), [ADR-009](../decisions/ADR-009-source-probe-operational-limits.md) và protocol trước khi làm.

## Phân đoạn dependency

P02.02 có hai bước: chuẩn bị offline dựa trên P00.04 + P01.02 đã DONE; chạy live cần G00. Đợt này nhận **chuẩn bị**, không tự PASS G00 hoặc mở Facebook bằng account. Việc tách bước ghi trong master plan, không lách gate.

## Đầu ra cần ngay

1. `.brain/specs/facebook_source_probe_runbook.md`: hướng dẫn vận hành có lệnh cụ thể từ repo hiện tại, thiết lập phiên bằng thao tác người dùng, điểm Start/Stop, query posts, bằng chứng cần giữ, lỗi/dừng và đường dữ liệu ngoài repo. Tách phần hiện đã chạy được với phần host chưa tích hợp. Không suy sai chế độ posts của người dùng; không yêu cầu họ xuất cookie/token.
2. `.brain/evidence/facebook-browser-route-assessment-2026-10-27.md`: kiểm nguồn chính thức hiện hành về điều kiện browser/automated collection, liên kết và nêu phạm vi đúng. Tách khả năng kỹ thuật, quyền người dùng giao dùng phiên, điều kiện của nền tảng, quyền dữ liệu và fit sản phẩm. Nêu trở ngại cụ thể cùng lựa chọn thực thi, không trả lại câu chung chung 'cần Meta API' hoặc tạo chấp thuận giả; không tư vấn kết luận pháp lý vượt bằng chứng. Nếu không truy cập được nguồn thì ghi hạn chế.
3. Gói preflight cụ thể áp dụng ADR-009, map ref/đường lưu, danh sách version/hash cần pin và phần session/operator còn thiếu. Không ghi Start/deadline giả hoặc đóng băng hash của source đang thay đổi. Ưu tiên một script chuẩn bị nhỏ nếu cần để biến runbook thành thao tác tái hiện được; không xây thêm framework validator/evaluator/scheduler.
4. Đề xuất nối với observer/host của P01.03, chỉ rõ interface cần và file sẽ tích hợp sau khi owner trả build. Không tạo một Electron/browser host thứ hai hoặc một crawler riêng cạnh tranh. Có thể đọc source đang làm nhưng không sửa nó; phần chưa ổn định phải ghi rõ. Khi đủ gói chuẩn bị, báo lead ngay để lead giải quyết đúng đầu vào còn thiếu và giao tích hợp/chạy probe, không tự xây thêm offline cho hết việc.

## Ownership và kiểm

Được ghi các file mới `facebook_source_probe_*`, evidence/handoff riêng và nếu cần `scripts/prepare-facebook-probe.mjs`, fixture `tests/fixtures/source-probe/`. Không sửa `src/`, package/lock/tsconfig, observer/browser source, dist/.test-build, master plan/README hoặc file evidence cũ. Không dependency mới, không cloud/upload, không trả phí. Script không chạy live, không đọc credentials; nếu có output phải nằm ngoài data thật và ghi rõ DRAFT/preflight.

Lead đã chọn caps/data handling tại ADR-009 trong quyền điều phối; không hỏi lại người dùng các lựa chọn kỹ thuật đó. Không tự coi 7 ngày retention là đã có cleanup scheduler. Chỉ báo phần cần thao tác/đầu vào thật sau khi gói chuẩn bị hoàn chỉnh. Bàn giao lệnh kiểm, file hashes và giới hạn; lead sẽ kiểm độc lập.
