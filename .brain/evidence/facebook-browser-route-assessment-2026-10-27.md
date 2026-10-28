# Đánh giá điều kiện browser route Facebook — 2026-10-27

Phạm vi: chuẩn bị offline P02.02 cho `FB_BROWSER_PUBLIC_SEARCH`, bài quán cà phê công khai. Không gọi nguồn Facebook bằng session người dùng, không đăng nhập, không chạy Actor. Assessment này không tự mở G00.

## Kết quả kiểm nguồn chính thức

| Nguồn | Kết quả đọc trong lượt này | Điều có thể dùng |
| --- | --- | --- |
| [Facebook robots.txt](https://www.facebook.com/robots.txt) | Đọc được text; công cụ ghi crawl tháng trước | Notice đầu file yêu cầu permission bằng văn bản cho automated collection và giới hạn theo mục đích của permission; dẫn đến Automated Data Collection Terms. Đây không phải permission dành cho CSD hoặc kết luận pháp lý |
| [Meta: How We Combat Scraping](https://about.fb.com/news/2021/04/how-we-combat-scraping/) | Đọc được bài chính thức, xuất bản 15/04/2021 | Meta phân biệt dữ liệu người dùng xem được với việc tự động thu có permission; việc dữ liệu công khai không tự giải quyết điều kiện automation. Bài giải thích cũ, không thay toàn văn terms hiện hành |
| [Automated Data Collection Terms](https://www.facebook.com/legal/automated_data_collection_terms) | Redirect đến login/temporary-block trong công cụ đọc | Chưa xác minh toàn văn hoặc ngày hiệu lực hiện hành; không dùng màn hình lỗi để kết luận account của người dùng bị chặn |
| [Facebook Terms](https://www.facebook.com/legal/terms), [terms.php](https://www.facebook.com/terms.php) | Redirect đến login/temporary-block | Chưa xác minh toàn văn hiện hành qua công cụ này |
| [Facebook Help: scraping](https://www.facebook.com/help/463983701520800) | Search trên domain chính thức có excerpt; open lại redirect login | Excerpt mô tả scraping gồm phần mềm thu dữ liệu và phân biệt authorized/unauthorized. Không dùng excerpt thay toàn văn terms |
| [Transparency URL được kiểm](https://transparency.meta.com/policies/other-policies/automated-data-collection-terms/) | Công cụ không truy cập được | Không xác nhận nội dung từ URL này |

Các kết quả trên là nội dung do công cụ web trả về ngày 27/10/2026; trang có cache/crawl age không được quảng cáo là một bản terms mới vừa tải trực tiếp. Không dùng bản sao archive, blog vendor, điều khoản VR/Avatar hoặc tin Meta thu website khác làm căn cứ cấp quyền cho CSD.

## Năm điều cần tách riêng

| Trục | Kết luận hiện có |
| --- | --- |
| Khả năng kỹ thuật | Host CSD đã có login affordance và isolation theo P01.02; chưa có source probe thật. Meta notice không chứng minh browser không đọc được posts |
| Quyền dùng phiên do người dùng giao | Người dùng đã chọn hướng Electron và có account thường. Phiên CSD chưa được thiết lập; cần thao tác đăng nhập trực tiếp trong CSD, không gửi cookie/token/mật khẩu cho agent |
| Điều kiện nền tảng | Chưa có bằng chứng CSD được permission cho automated collection. Notice chính thức đọc được không tạo ngoại lệ cho Electron, số lượng nhỏ hoặc dữ liệu công khai. Không ghi `DOCUMENTED` với nghĩa “được phép chạy” chỉ vì đã đọc policy |
| Quyền xử lý dữ liệu | ADR-009 giới hạn mục đích/lưu/xuất nội bộ cho probe; không tự cấp quyền của tác giả hoặc quyết định mọi nghĩa vụ pháp lý. Chỉ giữ trường/evidence cần thiết cho bài công khai đã xác minh, không thu người dùng/nhóm riêng tư ngoài scope |
| Fit sản phẩm | Search posts, continuation, nguồn và yield còn UNPROBED/UNPROVEN. Đây là điều phép thử cần đo, không phải điều kiện yêu cầu có trước phép thử |

**Disposition đề xuất: chưa xác lập đủ điều kiện cho automated browser capture.** Thiếu cụ thể là căn cứ áp dụng cho cách thu dự kiến và quyết định route có thể thực thi dựa trên căn cứ đó; không phải thiếu một tên Meta app. Biết người dùng chưa có grant rồi nên không hỏi lại câu cũ. Lead budget approval và quyền dùng account không được đổi tên thành permission của Meta. Đây là đánh giá điều kiện nguồn theo bằng chứng, không kết luận người dùng phạm pháp.

## Lựa chọn thực thi để lead quyết định

1. Hoàn tất tích hợp offline vào host hiện có, giữ capture tắt; kiểm counters/redaction/output với fixture. Bước này tiến hành được ngay khi P01.03 trả ownership, không cần source thật.
2. Tách một phiên khảo sát **do người vận hành tự thao tác**, observer/crawler tắt, nếu lead chọn bước này: xác minh login và UI có mục tìm **Bài viết/Posts**, ghi summary thao tác/giới hạn. Đây là khám phá thủ công, không thay automated probe hoặc benchmark. Việc thêm phần mềm tự thu response sau cú click tay vẫn phải được đánh giá là automated collection; không dùng thao tác tay để đổi nhãn.
3. Với automatic capture, cần căn cứ thực tế đáp ứng điều kiện route và phạm vi mục đích hoặc route dữ liệu khác được xác nhận phù hợp. Chưa tìm được bằng chứng như vậy trong lượt này. Đọc được terms hiện hành có thể làm rõ chi tiết, nhưng tự đọc/chấp nhận terms không phải bằng chứng permission đã được cấp.
4. API/nguồn được quản lý chỉ được xét khi có quyền và phạm vi cụ thể; không mặc định giải quyết public group/personal. Provider chỉ là phương án đối chiếu có điều kiện, không tự tích hợp/mua dưới cap 0 VND. Apify chạy thành công không tự chứng minh permission cho browser CSD.

Khuyến nghị bước tiếp cụ thể: lead nhận gói runbook/preflight, giao nối controller mỏng vào host sau P01.03, đồng thời chọn disposition route/session thực. Chưa có căn cứ thì chưa gắn `G00 PASS`; không tiếp tục xây tầng scale/UI để che khoảng trống nguồn.

Reference nội bộ: `evidence://facebook-browser-assessment-2026-10-27` trỏ tới file này; reference này là **assessment**, không phải permission grant. [Runbook](../specs/facebook_source_probe_runbook.md) và [ADR-009](../decisions/ADR-009-source-probe-operational-limits.md) quy định phần vận hành đã chốt.
