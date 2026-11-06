// Offline reconciliation only. Never constructs a gateway or browser.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const dir=resolve('artifacts/cafe-social-e2e-20261106');
const read=n=>JSON.parse(readFileSync(join(dir,n),'utf8'));
const status=read('status.json'),task=read('task.json'),closed=read('closed-spending.json');
assert.ok(['COMPLETE','STOPPED'].includes(status.phase));
const events=readFileSync(join(dir,'model/model-ledger.jsonl'),'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const starts=new Map(events.filter(e=>e.type==='START').map(e=>[e.invocation_id,e]));
const finishes=new Map(events.filter(e=>e.type==='FINISH').map(e=>[e.invocation_id,e]));
let measured=0,held=0;const purposes={};
for(const [id,s]of starts){const f=finishes.get(id),usd=f?.cost_usd??0,unknown=f?f.unmetered_cost_upper_usd??0:s.reserved_usd;
 measured+=usd;held+=unknown;const p=purposes[s.purpose]??={calls:0,usd:0,held:0};p.calls++;p.usd+=usd;p.held+=unknown;}
assert.ok(measured+held<=5+1e-8);assert.ok(Math.abs(measured-closed.taskUsd)<1e-8);assert.equal(starts.size,closed.taskCalls);
const expected=task.stages.map(([topic,mode])=>topic+'-'+mode);
assert.deepEqual(status.results.map(r=>r.topic+'-'+r.mode),expected.slice(0,status.results.length));
const datasets={},checks=[],rows=[];
for(const r of status.results){
 const data=read('results-'+r.topic+'-'+r.mode+'.json');assert.equal(data.run.id,r.runId);
 const o=data.opportunity,snapshots=o.snapshots.filter(s=>s.post),keys=snapshots.map(s=>s.platform+':'+s.root_post_id);
 assert.equal(new Set(keys).size,keys.length);assert.equal(keys.length,r.raw);assert.ok(r.raw<=r.rawCap);
 assert.equal(snapshots.reduce((n,s)=>n+s.comments.length,0),0);
 const accepted=o.conversations.filter(x=>!x.stale&&x.decision.snapshot_id===x.snapshot.id&&x.decision.classification==='SUITABLE'&&x.decision.assessment_status==='ASSESSED');
 assert.equal(accepted.length,r.accepted);assert.equal(o.selection.target.length,r.targetCount);
 assert.ok(accepted.every(x=>x.decision.evidence_ids.length&&x.decision.evidence_ids.every(id=>x.snapshot.spans.some(s=>s.id===id&&s.entity_type==='POST'))));
 const reasons={};for(const x of o.conversations)if(x.decision.classification===null){const k=x.decision.reason_code;reasons[k]=(reasons[k]??0)+1;}
 const health={missingDate:snapshots.filter(s=>!s.post.published_at).length,missingUrl:snapshots.filter(s=>!s.post.permalink).length,
   duplicateExactTextBeyondFirst:snapshots.length-new Set(snapshots.map(s=>s.post.text.normalize('NFC').trim())).size,uniqueRootGrain:true,postOnly:true,evidenceReferencesValid:true};
 datasets[r.topic+'-'+r.mode]=data;
 rows.push({...r,durationMinutes:(Date.parse(r.finishedAt)-Date.parse(r.startedAt))/60000,health,pendingReasons:reasons});
 checks.push({case:r.topic+'-'+r.mode,roots:r.raw,accepted:r.accepted,exported:r.targetCount,withinRawCap:true});
}
for(const [topic,a,b]of [['A','STANDARD','QUALITY'],['B','CONSISTENT','QUALITY']]){
 const x=rows.find(r=>r.topic===topic&&r.mode===a),y=rows.find(r=>r.topic===topic&&r.mode===b);
 if(x&&y)assert.equal(x.rootsHash,y.rootsHash,'paired modes must share the same frozen raw root IDs');
}
const criteriaKeys=['prompt','topic','audience','needs','brand_context','participation_intents','research_intents','inclusions','exclusions','required_geographies','preferred_geographies','languages','max_age_days'];
const criteria=Object.fromEntries(Object.entries(datasets).map(([key,d])=>[key,Object.fromEntries(criteriaKeys.map(k=>[k,d.opportunity.campaign[k]??null]))]));
const criteriaHashes=Object.fromEntries(Object.entries(criteria).map(([key,value])=>[key,createHash('sha256').update(JSON.stringify(value)).digest('hex')]));
const sameCriteria={A:new Set(Object.entries(criteriaHashes).filter(([k])=>k.startsWith('A-')).map(([,h])=>h)).size<=1,
 B:new Set(Object.entries(criteriaHashes).filter(([k])=>k.startsWith('B-')).map(([,h])=>h)).size<=1};
const commonUsd=measured-rows.reduce((n,r)=>n+r.usd,0);
const qa={at:new Date().toISOString(),phase:status.phase,taskError:status.taskError,rows,checks,cost:{usd:measured,held,calls:starts.size,cap:5,remaining:5-measured-held,commonFailedTrialAndRepairUsd:commonUsd,purposes,cumulative:closed.cumulative},sameCriteria,criteriaHashes,
 caveats:['Acceptance rate is not independently measured usefulness precision.','A target may fail; bounded source stops do not prove exhaustive social network coverage.','Earlier failed/paused trials remain charged and archived.','Comparison uses frozen raw roots; model/cached evidence cost is shared, so per-mode marginal cost is not a standalone run quote.']};
writeFileSync(join(dir,'verified-report.json'),JSON.stringify(qa,null,2));
const n=v=>v.toLocaleString('vi-VN'),usd=v=>'$'+v.toFixed(6);
const table=rows.map(r=>`| ${r.topic} | ${r.mode} | ${n(r.raw)} | ${n(r.accepted)} | ${n(r.rejected??0)} | ${n(r.pending)} | ${r.raw?(100*r.accepted/r.raw).toFixed(1)+'%':'—'} | ${usd(r.usd)} | ${r.durationMinutes.toFixed(1)} |`).join('\n');
const lines=[`# E2E cafe chill và gặp gỡ/giao lưu — 06/11/2026`,'',`Trạng thái: ${status.phase}; lỗi cuối: ${status.taskError??'không'}. Model: ${task.model}. Tổng chi phí API ${usd(measured)} / $5; held ${usd(held)}; ${starts.size} calls.`,
 '', '## Prompt cuối dùng để thu', '', `A: ${task.prompts.A}`, '', `B: ${task.prompts.B}`, '', 'Tiếng Việt, POST_ONLY; địa bàn không bắt buộc; tuổi bài không giới hạn.',
 '', '## Kết quả', '', '| Chủ đề | Mode | Raw duy nhất | Được nhận | Bị loại | Pending | Tỷ lệ nhận/raw | USD tăng thêm | Phút lượt cuối |','|---|---|---:|---:|---:|---:|---:|---:|---:|',table,
 '',`Chi phí chung cho lỗi chuẩn bị, các lượt dừng/sửa và thử lại: ${usd(commonUsd)}; đã nằm trong tổng. Thời gian toàn nhiệm vụ tính từ ${task.startedAt}; bảng phút chỉ tính lượt cuối của từng case.`,
 '', '## Đối chiếu', '',`- Các root được khử trùng theo platform+root_id. Kiểm tra raw cap, POST_ONLY và tham chiếu evidence đều đạt.`,
 `- Cùng tập raw cho A STANDARD/QUALITY và B CONSISTENT/QUALITY. Hash tiêu chí tương đồng: A=${sameCriteria.A}; B=${sameCriteria.B}. Nếu false, phép so còn chịu ảnh hưởng của diễn giải planner giữa các lượt.`,
 '- Ba mode A dùng cùng470root và hai mode B dùng cùng331root. Cả hai lượt thu đều dừng NO_PROGRESS trong các query đã lập; không chạm raw cap hoặc trần tiền. A dùng9query, B dùng11query. Đây không phải số bài tối đa trong lĩnh vực.',
 '- A CONSISTENT của lượt cuối đã nạp lại462root thu trước rồi tìm thêm8root; số phút lượt cuối không phải thời gian thu470root từ đầu. Tổng nhiệm vụ gồm chuẩn bị, sửa lỗi và các lượt bị dừng.',
 '- Tỷ lệ nhận là kết quả model, không phải độ hữu ích được gán nhãn độc lập. Chưa đủ căn cứ xác nhận CONSISTENT >50% hay STANDARD 60–80% hữu ích.',
 '- Chi phí tăng thêm có hưởng cache; không dùng nó để báo giá một lượt độc lập không có cache.',
 '', '## Lỗi E2E và bản sửa trong nhiệm vụ', '',
 '- Phân rã câu địa bàn ưu tiên và danh sách loại trừ thành query dương; thiếu đủ bảy trường intent: đã bổ sung kiểm tra/hướng dẫn và hồi quy. Prompt dài đầu tiên vẫn cho thấy planner nhạy với ràng buộc; các phản hồi lỗi được giữ.',
 '- Thiếu query chủ đề trần: đã giữ các anchor có từ gốc. Cần đo thêm mức đa dạng và số root mới theo nhóm; có24 nhóm trong taxonomy không đảm bảo mỗi plan có24 nhóm.',
 '- Nhường cửa sổ do CPU trong lúc replay checkpoint: đã bảo vệ lượt tải lại tới một trang mới, giữ dừng khẩn cấp khi RAM thấp.',
 '- Tầng điều phối từng requeue cả frontier đã STALLED: đã nhận đúng tín hiệu dừng không tiến triển, giữ checkpoint để resume rõ ràng; không gọi STALLED là nguồn đã cạn.',
 '- Bộ đếm no-progress bị reset giữa các slice3trang trong khi ngưỡng4trang: đã lưu qua checkpoint, replay không tự xóa hay cộng bộ đếm. NO_PROGRESS là dừng vận hành có thể resume, không phải chứng minh hết dữ liệu.',
 '- Runner từng đặt output trong workspace và sai cờ truy cập BrowserHost: đã sửa, giữ các lần thử0raw trong artifact và tính toàn bộ chi phí.',
 '', '## Nguồn và dữ liệu', '', '- Sổ model, task/status, trial-before-fix-*, kết quảJSON/XLSX nằm trong artifacts/cafe-social-e2e-20261106; dữ liệu thu thực tế nằm ngoài workspace, xem live-data-path.json.',
 '- verified-report.json lưu số liệu, hash và đối soát. Không sửa ledger lịch sử, không đưa raw/key/cookie vào commit.',
 '- Chi phí là token usage nhân bảng giá Standard, chưa phải hóa đơn Google. [Giá Gemini](https://ai.google.dev/gemini-api/docs/pricing?frmapp=yes).',
 '', '## Kết luận nghiệm thu', '', rows.find(r=>r.topic==='A'&&r.mode==='CONSISTENT')?.targetCount>=1000?'A CONSISTENT đạt target1000 được nhận; độ hữu ích vẫn cần đánh giá độc lập.':'A CONSISTENT chưa đạt target1000 được nhận. Không thể xác nhận cam kết500–5000 bằng kết quả này. Cần ưu tiên mở rộng truy xuất, giảm replay và đo số root mới thực sự tăng thêm trước khi phát hành.',
 'Nếu các mode dùng dưới1000raw, chỉ kết luận trên tập đã thu; không nội suy thành kết quả1000raw. Chưa nghiệm thu100bài/tháng.'];
writeFileSync(join(dir,'report.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({phase:qa.phase,cases:rows.map(r=>({case:r.topic+'-'+r.mode,raw:r.raw,accepted:r.accepted,pending:r.pending,usd:r.usd})),cost:qa.cost,sameCriteria},null,2));
