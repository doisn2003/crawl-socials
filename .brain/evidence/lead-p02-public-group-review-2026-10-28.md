# V13 — Nghiệm thu và hai snippet nguồn thật đầu tiên

Lead đọc exact vocabulary/control proof trước prune, bounded required-control negative audit, schema13/counters. Reviewer84/84 đóng R-G1/R-G2; lead fresh compile102/102 candidate tests (18owner+84reviewer),3native public-group PASS/external0. Shared build PASS,14/14owned và129/129frozen khớp trước nạp.

Fixed script `7d85f7915f7ed6838375e96e04d4231abce3a809b3d78723ca7f29a6da6769f6`; controller `6ae0c6911e191c7b88f177e273a790d0beb3c3f3ab9c29f85a621b4f23f6c858`. Đóng24084 bình thường, nạp25524/main2821588/source1052524 cùng profile; không đọc.env, không cần login lại. Query cafe Hà Nội/public filter đã kiểm trước1candidate action.

[LIVE v13](p02-live-public-group-v13-2026-10-28.json): run `candidate-219ac4e2-b28a-45ea-8f19-f662decec0b5`,20:17:46.053–.110Z,**SAMPLES_READY/2samples/1997steps/7boundaries/57ms**. Không hitcap/time, barrierCLEAR. Header public seen/accepted2, publicControlsPruned0, publicClusters2; group-label hỗ trợ đã có hiệu quả trong lượt này nhưng không gán mọi cải thiện cho control fix. Không fallback vì feed đã ra mẫu.

Lead đọc riêng hai snippet ngoài repo: một nội dung tuyển dụng của quán, một nội dung giới thiệu không gian quán. Không tự loại tuyển dụng theo contract exclusions rỗng. **Cả hai TRUNCATED, permalink/post_id null, source_type UNKNOWN; temporal missing/unreadable**, vẫn cần identity/source/context/độ đủ nội dung. Đây là2diagnostic snippets, chưa2bài hợp lệ hoặc2unique verified. Không sao chép body/author/rawURL vào.brain.

Summary SHA `0febcdb92ea0a0a25d65dd3d32f344d0c875a075aefa91fe2a2864da96d3339c`; payload SHA `a994403446b0b9bf9d669e23c79d14a7e7c5ca4be80014431199756cbd9ab7a4`, ở userData/public-candidate-diagnostics/run trên, expires2026-11-03T20:17:46.107Z/manualcleanup. Runtime25524/source1052524,1/3starts; không lặp v13.

## Khảo sát identity bằng UI có giới hạn

Lead quan sát AX của cùng ứng viên đầu: điều khiển timestamp có accessible date nhưng target hiện là search/top kèm fragment, không phải permalink. Không lấy tracking URL làm identity hoặc suy ID. Để tìm đường thao tác thật cho P02.02, cho phép lead **mở đúng một timestamp đã quan sát** và nếu cần **một Xem thêm của chính bài đó**, chỉ đọc context/route được UI trả về. Không mở menu tương tác/share/message, không like/comment, không autoscroll/thu batch mới. Đây là khảo sát read-only trong phạm vi tối đa5ứngviên đã cho phép, vẫn permission UNKNOWN/benchmark OFF/valid0. Auth/challenge/deny thì dừng ngay. Chưa bật hành vi navigation trong production collector.

**Kết quả UI:** đúng1click timestamp mở route `/groups/{groupId}/?multi_permalinks={onePostId}&hoisted_section_header_type=...` với dialog bài viết. Header vẫn có graphic exact public-group; phần body hiển thị thêm các đoạn vị trí/ca tuyển dụng tương ứng snippet ban đầu. Không cần bấm Xem thêm. Một outer dialog bọc dialog có heading bài viết; bên dưới có comments với timestamps riêng, không được nhập vào body/identity. ID và rawbody/author không chép vào.brain. Route chứa1postID là identity hint có nguồn gốc UI, **chưa phải permalink đã xác minh độc lập**; không tự dựng `/posts/` rồi báo verified. Current source đang ở group-post dialog, không còn search;1/3diagnostic starts,1UI navigation. Không chạy search diagnostic trên dialog này.

Bước tiếp theo [ADR-014](../decisions/ADR-014-single-post-context-diagnostic.md)/[dispatch v14](../handoffs/lead-p02-post-context-dispatch-2026-10-28.md): đọc riêng current public-group post dialog và route hint, không continuation. Chỉ mở source contact với exact context được người dùng/lead mở; bảo vệ challenge/deny vẫn ưu tiên.
