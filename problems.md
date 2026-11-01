## Một số vấn đề từ nhỏ tới lớn cần giải quyết được nếu muốn hoàn thành công cụ này.

1. Công cụ còn đuối khi đi thu thập bình luận.
2. Công cụ còn bỏ sót từ khóa -----hiệu ứng cánh bướm------> Bỏ sót bài viết
   * **Bản chất của sự bỏ sót:**
     * **Bệnh "văn bản hành chính" (Literal Overfitting):** Công cụ sinh từ khóa quá máy móc và sách vở, chỉ bốc các cụm từ trang trọng như `bất động sản`, `hỏi mua bất động sản`, `chào bán bất động sản`. Trong khi đó, ngôn ngữ thực tế người dùng mạng xã hội (Facebook, Threads) sử dụng để trao đổi lại là những từ ngắn gọn, dân dã như `đất`, `nhà`, `mua đất`, `bán đất`.
     * **Lỗi logic trong cơ chế lập kế hoạch:** Dù trong prompt người dùng có đưa ra các từ như *"đất đai, nhà ở"*, công cụ vẫn bỏ qua và chỉ bám vào từ khóa trừu tượng *"bất động sản"*. Thậm chí hệ thống còn có cơ chế tự động hủy bỏ các từ khóa mở rộng vì đánh giá nhầm là "nằm ngoài ngữ cảnh trực tiếp".

   * **Diễn tiến của "Hiệu ứng cánh bướm" làm sai lệch toàn bộ kết quả:**
     * **Tầng 1 - Thiếu từ khóa hạt giống (Root Query Bias):** Chỉ cần sót một từ khóa đơn giản nhưng cốt lõi (như chữ `"đất"` hoặc `"nhà"`).
     * **Tầng 2 - Sụp đổ phễu thu thập (Crawler Miss):** Trên mạng xã hội, rất hiếm một người dùng cá nhân nào đăng bài dạng: *"Tôi hỏi mua bất động sản"* hay *"Tôi chào bán bất động sản"*. 90–95% bài viết thực tế sẽ là: *"cần mua mảnh đất"*, *"chính chủ bán đất"*, *"tài chính 1 tỷ tìm đất..."*. Vì crawler tìm kiếm bằng những từ ngữ "trên trời", toàn bộ lượng bài viết tự nhiên (organic leads) của người có nhu cầu thật bị bỏ sót ngay tại cửa ngõ tìm kiếm.
     * **Tầng 3 - Dữ liệu đầu vào bị méo mó (Distorted Input):** Tập bài viết cào về không phản ánh đúng nhu cầu thực tế của thị trường, mà bị lệch hẳn sang bài viết PR của các sàn môi giới, trang tin báo chí hoặc các bài phân tích vĩ mô của chuyên gia.
     * **Tầng 4 - Vô hiệu hóa tầng AI đánh giá (Wasted AI Processing):** Bộ lọc AI (Gemini) dù có thông minh đến đâu cũng chỉ có thể chấm điểm dựa trên những gì crawler mang về. Dữ liệu đầu vào đã bị lọc sai thì việc AI phân loại cũng trở nên vô nghĩa, gây lãng phí chi phí token và thời gian chạy.
     * **Tầng 5 - Thất bại toàn bộ mục tiêu (Final Outcome Failure):** Kết thúc chiến dịch, hệ thống không thu thập được đúng đối tượng "người có nhu cầu mua/bán thực sự" như kỳ vọng ban đầu, biến toàn bộ quy trình cào dữ liệu thành vô ích.

   * **Dẫn chứng thực tế từ tệp `bds.json`:**
     * *Prompt yêu cầu:* Tìm người quan tâm đến *"bất động sản, đất đai, quy hoạch, phân lô bán nền, bất động sản vùng ven, bất động sản khu công nghiệp, đất đai nhà ở"*.
     * *Truy vấn công cụ tự tạo:* Chỉ có 5 cụm: `bàn luận bất động sản`, `hỏi mua bất động sản`, `chào bán bất động sản`, `phân lô bán nền`, `bất động sản vùng ven`.
     * *Hậu quả thực tế:* Toàn bộ các từ khóa phản ánh đúng hành vi người dùng như `mua đất`, `bán đất`, `tìm đất`, `mua nhà`, `bán nhà` đều bị bỏ sót 100%. Nhật ký hệ thống xác nhận đã tự động xóa 3 truy vấn mở rộng vì cơ chế kiểm duyệt từ khóa quá cứng nhắc (`exact supplied seeds`).

   * **Hậu quả của việc dừng sớm khi "vừa đủ chỉ tiêu" (Early Stop Omission):**
     * Giả sử hệ thống có phân rã ra được đầy đủ 10 từ khóa quan trọng và tinh đọng nhất, nhưng cơ chế thực thi tìm kiếm lại mang tính tuần tự và thô sơ: chỉ mới search qua 5 từ khóa đầu tiên thì tổng lượng bài thu về đã chạm ngưỡng "chỉ tiêu" (target quota).
     * Hệ quả: 5 từ khóa quan trọng phía sau hoàn toàn chưa được chạm tới. Công cụ vội vã dừng lại vì thỏa mãn điều kiện số lượng, trực tiếp dẫn đến việc bỏ sót toàn bộ các mảng thảo luận thuộc về các từ khóa chưa kịp quét.

3. Bỏ sót bài viết chất lượng hơn (Bẫy "đủ số lượng" & Thiếu chiến lược xếp hạng)
   * **Bản chất vấn đề:**
     * Công cụ đang bị rơi vào bẫy **"Ưu tiên số lượng hơn chất lượng" (Quantity over Quality)** và cơ chế thu nạp kiểu đến trước - lấy trước (*First-Come, First-Served*).
     * Khi 5 từ khóa đầu tiên đã tìm đủ chỉ tiêu số lượng, công cụ lập tức hài lòng và dừng lại. Nhưng những bài viết này có thể chỉ dừng ở mức đại trà, chung chung hoặc chưa thực sự tinh đọng.
   * **Nghịch lý "Đủ chỉ tiêu nhưng bỏ lỡ bài viết tốt nhất":**
     * Nếu các từ khóa đằng sau (vốn chưa bao giờ được đem đi search) lại là những từ khóa phản ánh bài viết chính xác hơn, ngữ cảnh sâu hơn và phù hợp hơn thì sao?
     * Việc dừng tìm kiếm sớm chỉ vì đủ số lượng khiến hệ thống tước đi cơ hội tiếp cận những bài viết "vàng" (chất lượng cao nhất, đúng tệp nhất). Kết quả mang về cho người dùng tuy "đạt KPI về số lượng bài" nhưng thực chất lại bị loãng về chất lượng nội dung.
   * **Vấn đề cốt lõi cần giải quyết:**
     * Công cụ đang thiếu hụt một **kế hoạch thu thập thông minh hơn** (biết phân bổ ngân sách, chia đều hoặc cân đối quota tìm kiếm cho toàn bộ các nhóm từ khóa thay vì vét cạn từng từ một cách mù quáng).
     * Đồng thời, thiếu một **chiến lược xếp hạng bài viết tốt hơn** (cần đánh giá và xếp hạng độ phù hợp trên toàn bộ tập dữ liệu tiềm năng của tất cả các từ khóa, thay vì vơ vét bài viết đầu tiên tìm thấy để lấp đầy chỉ tiêu).