# Lead nghiệm thu P03.03 — query planner

2026-10-27, reviewer `/root`. Đã đọc module, tests, API/evidence và handoff. **Nhận P03.03 DONE** trong phạm vi planner ứng dụng thuần; chưa nối executor hoặc thu dữ liệu thật.

## Kiểm độc lập

~~~powershell
node node_modules/typescript/bin/tsc -p tsconfig.tests.json --outDir .test-build-lead-planner
node --test .test-build-lead-planner/tests/query-planner.test.js .test-build-lead-planner/tests/query-expansion.test.js .test-build-lead-planner/tests/adapter-contracts.test.js
~~~

Compile PASS, **57/57 tests PASS** gồm18planner+18expansion+21adapter. **4/4 hashes** khớp manifest owner. Source/tests không đổi sau compile; owner chỉ bổ sung ghi chú P02.02 độc lập với planner vào evidence trước chốt hash. Không build/restart Electron hoặc thay profile.

Planner giữ originals trước expansion, binding hash đầy đủ và catalog ancestry dù node chưa có job. Unsupported filter/source/mode có quyết định rõ; geography INCLUDE không thành adapter filter tưởng tượng; exact phrase chưa có syntax capability thì defer. Task/global/campaign dùng allocation chung, không refill khi nhân query/source; request unit và reservation basis khai báo rõ trong config, chi phí dùng integer units/scale. Runtime phải giữ cùng đơn vị đã pin, không đổi ADAPTER_CALLS thành HTTP_REQUESTS hoặc coi estimate là measurement.

Template chưa bind run_id, không Start/deadline, luôn execution_authorized=false. Fake wiring thực hiện2calls/3observations/2identities, giữ FIXTURE và nguyên allocation; đây không phải source/yield proof. Những declaration capability/permission của caller không tự thành grant hoặc G00. Planner không thực thi wall/operator/storage, các chiều này được ghi rõ để executor kiểm sau.

Không thấy blocker cụ thể còn lại trong scope. Các giới hạn giữ rõ: input model đã qua validator; ref/capability/pricing là khai báo của caller; không tự xác minh qua mạng; planner chưa nối UI/controller/runtime. **Probe P02.02 dùng preflight riêng, không cần LIVE_VERIFIED của planner trước khi thử capability lần đầu**; không tạo vòng dependency mới.

## Điều phối sau nghiệm thu

Hai worker đã kết thúc phần được giao: chat CSD agent idle, subagent csd_adapter đã bàn giao planner. Không còn agent triển khai đang chạy sau ACK. Không tạo agent mới hoặc nhận task trùng.

P02.02 vẫn BLOCKED bởi disposition automated route chưa xác lập theo assessment/gate hiện hành và driver/schema nguồn chưa có. User đã cung cấp đủ thông tin login/search/menu cho khảo sát UI; không tiếp tục hỏi lại các câu này hoặc Meta API. Không thêm bằng chứng permission giả, không tự PASS G00 từ tests hoặc ảnh.

P04.01 cần G01 nên chưa giao. P05.01 đủ dependency nhưng tiếp tục READY chưa nhận để không mở rộng hạ tầng khi chưa có source probe; P06.01 cần mẫu thật. Không mở thêm vòng framework/telemetry/readiness chỉ để giữ worker bận. Source blocker cần đầu vào/decision thực, không giải bằng thêm unit tests. Giữ phiên Facebook hiện tại, observer/crawler OFF và0posts. Các heartbeat không có trạng thái mới phải im lặng.
