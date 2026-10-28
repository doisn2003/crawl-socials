# P02.02 — Review unique observed header link

28/10/2026, Asia/Bangkok. [Dispatch](../handoffs/lead-p02-observed-header-link-dispatch-2026-10-28.md). **R-OH1/R-OH2 CLOSED; fix00:29:48Z đã nạp thành v23**, PID22288/main2490572/source5114108, profile đăng nhập được giữ nguyên. Các mục failed freeze bên dưới là lịch sử trước sửa.

Lead đọc classifier, proof schema4, ambiguity và raw binding. UNIQUE_HEADER_POST_LINK chỉ ghép OBSERVED_POST; một observed target duy nhất và một choice, các guard body/header/public/owner/budget không bị bỏ. Preflight tái dùng subtype đã đo, không ghi candidate/clip cache. Source facts vẫn chưa xác định subtype thật trên Facebook.

- Compile output riêng,22owner tests PASS.
- Native độc lập SVG positive, stale subtree và ambiguity PASS; external requests0. Báo cáo prefix lead-p02-observed-header-.
-39owned hashes khớp freeze trước kiểm; chưa build/nạp shared runtime.

## R-OH1 — Fill trong suốt vẫn được coi là chữ hiển thị

Lead phát hiện `visibleInk` chỉ loại fill none/empty và opacity0, chưa kiểm alpha của computed fill. Reviewer tái hiện complete fixed DISCOVER→CLICK: text/tspan có computed rgba(0,0,0,0), rect dương, mọi proof khác giữ nguyên; kết quả1target/click thay vì0. Test tên `review observed SVG ink: fully transparent computed fill cannot prove visible text`, frozen output `.test-build-adapter-candidate/observed-header-final`. Reviewer đang bổ sung native CSS proof.

Đã giao owner sửa hẹp: chỉ chứng minh ink khi computed fill thuộc kiểu được hỗ trợ và alpha dương; alpha0/transparent/unknown không cấp proof. Giữ positive native SVG, guards/caps và stale binding. Chờ freeze mới và reviewer kiểm trước LIVE. Không nâng gate/valid count.

Lead chạy độc lập frozen full-script repro:1FAIL, expected0/actual1. Reviewer cũng xác nhận [native CSS](adapter-p02-observed-header-transparent-native-2026-10-28.json): computed fill alpha0 thực, glyph rect dương,1click/1read. Trường PASS trong report chỉ nói harness tái hiện hành vi; `reviewerIssue` là failure của contract. Failed snapshot `.test-build-adapter-candidate/observed-header-ink-failed` giữ modules/manifest/test/native fixture,39owned/68build hashes khớp trước copy.

## R-OH2 — Target quá dài bị hiểu nhầm là absent

Reviewer tái hiện trong observed group-post + SVG text mới: named target160ký tự bị chặn,161ký tự lại cấp target/click vì helper `attr` trả chuỗi rỗng khi quá giới hạn. Frozen repro `.test-build-adapter-candidate/observed-header-target-failed`, test `review observed target policy: oversized named target never becomes absent through bounded attr helper`. Đã giao owner sửa action guard kiểm raw null/empty/_self đúng policy, không coi oversized thành absent, không xuất raw value. Giữ no-BLANK/popup và stale fence. Gộp R-OH1+R-OH2 trước activation.

## Kiểm fix freeze00:29:48Z

Lead đọc parser computed fill: chỉ rgb/rgba dạng số đã giới hạn, alpha dương; unknown/transparent/alpha0 không cấp ink. Raw target guard chỉ nhận null/empty/exact _self, không qua helper fallback. [Freeze sửa](p02-observed-header-link-guards-files-2026-10-28.json).

- Compile riêng +24owner tests và2reviewer repro PASS; cả hai repro trước đó lead đã thấy FAIL.
- Native lead chạy độc lập transparent, named target161 và alpha dương PASS; đúng0click cho negatives/1click1read cho positive, network0.
-28owned/68isolated build hashes khớp; build chung PASS và28owned không đổi. Chờ reviewer final rồi activation v23; không diễn giải fixture thành LIVE.

[Reviewer final](adapter-p02-observed-header-link-review-2026-10-28.md) và [receipt](adapter-p02-observed-header-final-files-2026-10-28.json):51focused checks/4native PASS, hai findings CLOSED,28owned/68copied build khớp. Lead kiểm thêm135frozen hashes của shared build khớp, nạp v23 sau khi đóng v22 bình thường; không reset bản cũ để tăng lượt. Source tự dùng lại phiên đăng nhập, không đọc .env.

## LIVE v23

[Hai lượt](p02-live-observed-header-v23-2026-10-28.json):81ms trước tương tác,55ms sau right-click timestamp/Escape, đều0click/read. UI AX trước có0group-post links, sau có1; diagnostic xác nhận một SEARCH_PLACEHOLDER/BLANK đổi sang OBSERVED_POST/ABSENT trong viewport. Chưa cô lập event nào gây đổi, không kết luận tự hover đã đủ. Header/visibility/viewport đạt nhưng subtree UNSUPPORTED còn loại. Không auth/challenge/deny, không scroll ở lượt này.

Giao [subtree rejection facts](../handoffs/lead-p02-subtree-rejection-dispatch-2026-10-28.md) để biết tag/attribute nào chưa hỗ trợ mà không nới guard theo giả thuyết. Runtime22288/source5114108,2/3starts; chưa automatic search→post→read, permission UNKNOWN/benchmark OFF/valid0/gates.
