# Mốc tích hợp phương án được duyệt — CSD 0.3.0-rc.5

Người dùng đã gửi **DUYỆT** cho phủ ngữ nghĩa có kiểm soát và hỏi ngược bằng LLM. Thay đổi này tích hợp vào app CSD trên `codex/csd-production`, sau mốc web thử nghiệm v0.2.1. Website thử nghiệm vẫn là nơi thử các phương án tiếp theo.

## Phiên bản

- Nguồn cơ chế: Keyword Lab v0.2.1, commit `91dd777a3cd5df32c6402d252f6bbf810743d1a5`.
- `src/domain/semantic-keywords.mjs` sao chép nguyên engine đã duyệt; SHA-256 `bd2b9154d47ec3516e002915fff7564fab54a7cffb5b635426999bce6adcc354`.
- Policy CSD mới: `controlled-semantic-dialogue-v1`; planner `campaign-planner-v2.0.0-semantic-dialogue`.
- Bộ phân loại theo mục tiêu hiện tại: `conversation-opportunity-v2.0.4-intent`. Bộ kiểm định tùy chọn có phiên bản `conversation-opportunity-verifier-v1.1-intent`.
- Các recipe cũ được giữ nguyên, không tự đổi campaign đã lưu. Bản portable: `release/CSD-Portable-0.3.0-rc.5.exe`.

## Hành vi tích hợp

Prompt rõ được lập kế hoạch ngay. Điểm mơ hồ quan trọng sinh 1–3 câu hỏi theo schema, hỗ trợ chọn một, chọn nhiều và nhập tự do. Không chọn sẵn câu trả lời. Mục tiêu có bảy trường và trạng thái xác nhận riêng; mở rộng tùy chọn không được tự bật.

NEEDS_CLARIFICATION là bản nháp hội thoại thực, không phải campaign giả có từ khóa dự phòng. CSD chặn chạy khi chưa rõ ý định, khi còn lượt cập nhật chưa hoàn tất hoặc khi không có kế hoạch đã xem. Người dùng sửa câu trả lời/mục tiêu sẽ tạo revision mới; lịch sử không bị ghi đè. Bản nháp sẵn sàng được chốt nguyên phiên bản khi khởi tạo pipeline.

Adapter đưa mục tiêu đã xác nhận vào audience, needs, inclusions và exclusions. Các giới hạn bằng ngôn ngữ tự nhiên được giữ cho classifier; không tự đoán ngày hoặc tách tên địa phương để tạo giới hạn máy. Điều kiện ưu tiên vẫn là ưu tiên, không biến thành điều kiện loại bài. Người dùng có thể chỉnh các trường máy trong bảng tiêu chí. Classifier và verifier áp dụng đúng phía người mua/người bán đã chọn, thay vì mặc định chỉ nhận người tiêu dùng.

Sổ chi phí/gateway/model/key dùng cơ chế hiện có của CSD. Mỗi lượt model tối đa một lần sửa định dạng/bằng chứng/phủ nhánh; lỗi mạng/key/ngân sách không được coi là lỗi ngữ nghĩa để gọi thêm. Không sinh từ khóa giả. Câu trả lời được lưu trước khi gọi AI, nên restart/thử lại không làm mất chúng. Cache giữ khả năng phục hồi yêu cầu bị gián đoạn; thử lại sau hai kết quả model không hợp lệ tạo generation mới để tránh lặp cache lỗi.

Các file `intent-revisions`, `intent-attempts`, `intent-generation.json` trong thư mục opportunity lưu phiên bản và dấu vết kiểm chứng. Campaign chứa snapshot `intent_resolution`; preset và phiên bản chốt giữ snapshot này. Đây là vòng phản hồi có lịch sử và chỉnh sửa, không phải huấn luyện lại trọng số model tự động.

## Kiểm chứng

Các lệnh kiểm tra: `npm run check`, `npm test`, `node scripts/semantic-dialogue-ui-smoke.mjs`, `node scripts/benchmark/semantic-dialogue-smoke.mjs <thư mục bằng chứng riêng>`.

Kết quả bản tích hợp: kiểm tra TypeScript đạt; **900/900 kiểm thử hồi quy đạt**; smoke giao diện Electron đạt. Không chạy thu thập Facebook/Threads thật trong phiên tích hợp này.

Probe Gemini thật ngày 02/11/2026 dùng `gemini-3.5-flash-lite`, bốn yêu cầu cho hai chủ đề:

| Lượt | Kết quả |
| --- | --- |
| `tìm người muốn thuê luật sư` | READY; 3 từ khóa, không lỗi neo; không thiếu nhánh CORE |
| Piano, chưa chọn người mua hay người bán | NEEDS_CLARIFICATION; 1 câu hỏi; 0 từ khóa |
| Trả lời chỉ tìm người hỏi mua piano | READY; 4 từ khóa; audience là người hỏi mua |
| Sửa câu trả lời thành chỉ tìm người rao bán | READY; 4 từ khóa; audience chuyển sang người rao bán |

Tổng chi phí đo theo sổ token của probe khoảng **0,0158 USD**, không phải hóa đơn. Bằng chứng riêng ở `artifacts/semantic-dialogue-approved-20261102/smoke-summary.json`; không lưu key trong mã nguồn/bằng chứng.

Smoke Electron dùng renderer CSD đã build với bridge dữ liệu giả, cửa sổ ẩn và dữ liệu ứng dụng tách riêng. Kiểm tra không chọn sẵn đáp án, báo thiếu câu trả lời bắt buộc, gửi tự do qua bridge, hiển thị từ khóa khi READY và không có lỗi renderer. Không dùng tài khoản mạng xã hội thật.

Kiểm thử hồi quy bao gồm lỗi neo luật sư, phủ thiếu nhánh, giới hạn ưu tiên, sửa đáp án, revision cũ, restart/lỗi mạng, thử lại cache lỗi, preset, chốt/resume pipeline, cùng việc truyền mục tiêu sang classifier/verifier. Probe này kiểm chứng tích hợp và vòng hội thoại; chưa phải benchmark precision/recall của kết quả thu thập mạng xã hội.
