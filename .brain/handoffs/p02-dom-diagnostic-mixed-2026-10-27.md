# P02 DOM diagnostic — exact Top mixed route

Ngày 2026-10-27, Asia/Bangkok. Follow-up hẹp theo bổ sung UI thật trong ADR-010/dispatch: lead báo search đang ở exact `/search/top/`, preflight trước trả `UNSUPPORTED_ROUTE` với actions0, chưa đọc DOM. Bản này thay giới hạn Posts-only của [handoff trước](p02-dom-diagnostic-2026-10-27.md) đúng ở route đã quan sát; mọi giới hạn metadata-only/lifecycle/provenance vẫn giữ.

## Code ready

- Main và script nhận **chỉ** exact `/search/posts` hoặc `/search/top`, có hoặc không dấu `/` cuối, cùng HTTPS Facebook và một query cố định `cafe Hà Nội`. Không nhận family `/search/*`, route con, People/Groups/Pages/Videos hoặc query khác.
- `SEARCH_POSTS` giữ nguyên; Top xuất enum **`SEARCH_TOP_MIXED`**. `SEARCH_OTHER` chỉ dùng cho kết quả bị từ chối/unsupported, không nhận làm successful metadata.
- Main kiểm route enum trả về khớp route đã lấy ownership trước read; payload Top gắn nhầm `SEARCH_POSTS` bị `INVALID_RESULT`, không lưu payload. Đổi giữa Posts/Top trong khi đọc cũng mất scope.
- Chưa phân loại thực thể Page/post/ad từ article heuristic. Hints/counts/link families chỉ là metadata; identity/text/source/publicity vẫn unverified, candidates collected0/valid count0. Không đọc body/ID vào output và không thay extractor.

Source sửa đúng bốn file: `src/main/facebook-dom-diagnostic.ts`, `src/main/facebook-dom-diagnostic-script.ts`, `src/main/facebook-dom-diagnostic-fixture.ts`, `tests/facebook-dom-diagnostic.test.ts`. Không cần sửa index/menu/BrowserHost/policy/session/API hoặc scripts. Build chỉ `.build-csd-dom` và `.test-build-csd-dom`; không ghi shared `dist` hoặc thao tác runtime/source view của lead.

## Kiểm chứng owner

```powershell
node scripts/facebook-dom-diagnostic-build.mjs
node --test .test-build-csd-dom/tests/facebook-dom-diagnostic.test.js
node scripts/facebook-dom-diagnostic-smoke.mjs --output .brain/evidence/p02-dom-diagnostic-mixed-fixture-2026-10-27.json
```

Build PASS; **11/11 unit tests PASS**; **3/3 native fixture cases PASS**, external network0, observer không attach, shutdown0 windows/0 WebContents. Không chạy hoặc sửa output reviewer/lead.

Unit regression kiểm exact Top acceptance, các route khác bị deny, metadata giữ mixed enum, main reject giả Posts, và Top `NO_MATCH` không thành source exhausted. Toàn bộ lifecycle/redaction/mode/timing tests cũ vẫn PASS.

Native fixture dùng cùng menu handler/owned adapter/isolated world: Posts có8 article roots giới hạn5 samples; Top giả có Page link +2 article structures gồm post-like/ad-like markup, chỉ trả2 structural samples và link family counts (`page=1`, `post=1`, `external=1`); auth input trên Top dừng `AUTH_REQUIRED`. Top không được claim Posts-only/PUBLIC hoặc loại ad chính xác. Synthetic tên/text/URL/token không lọt report. Ca NO_MATCH nay kiểm ở unit suite và regression script độc lập; native fixture ba lượt giữ nguyên process cap3 thay vì tăng cap để thêm lượt.

## Lead tiếp nhận

Điểm kích hoạt/cờ/menu và output userData giống handoff trước. Native menu còn nhãn lịch sử **Chẩn đoán Posts**, nhưng output phân biệt route rõ bằng `SEARCH_TOP_MIXED`; nhãn menu không xác nhận loại thực thể. Sau review và đối chiếu [manifest mới](../evidence/p02-dom-diagnostic-mixed-files-2026-10-27.json), lead duy nhất build/nạp rồi dùng profile/search hiện có để đọc một lượt. Agent này không restart runtime26864, không đọc source view4000438 hoặc chạy LIVE.

[Fixture summary](../evidence/p02-dom-diagnostic-mixed-fixture-2026-10-27.json) chỉ chứa metadata/hash, không chứa DOM thật. Old manifest/handoff giữ làm evidence bản trước; dùng manifest `mixed-files` cho snapshot follow-up này. Hash controller scope vẫn `DOM_CONTROLLER_MODULE`; hash script string riêng và toàn isolated build được liệt kê. Copied `probe-build.json` vẫn chỉ là bootstrap metadata từ shared build, không là freeze mới của diagnostic.

Giữ các caps 2.500 node/5 sample/1 giây cooperative/4 giây main timeout/5 phút run/1 action/32 KiB/3 run mỗi process; Stop/suspend/owner change/late-result discard và LIVE/FIXTURE separation không đổi. Permission UNKNOWN, diagnostic-only, benchmark ineligible; chưa nâng task/gate từ fixture.
