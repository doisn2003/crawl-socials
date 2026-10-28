# P06.01 — Evidence chuẩn bị rubric offline

Ngày 2026-10-27. Owner `/root/csd_adapter`; [dispatch](../handoffs/p06-rubric-preparation-dispatch-2026-10-27.md). **Bàn giao phần chuẩn bị để lead review; không kết luận DONE toàn P06.01 hoặc PASS gate.**

## Phạm vi và kết quả

- [Rubric](../specs/relevance_rubric.md): `coffee-relevance-1.0.0`, dựa trên contract 1.0.0 / policy coffee-intent-v1. Relevance độc lập với overall validity, nguồn, identity/permalink, provenance và cutoff.
- [Schema](../specs/relevance_reason_codes.schema.json): 13 reason codes, result–code tương thích, evidence refs/version/hash, rationale và yêu cầu ghi phần thiếu. Chưa nối vào `ValidationDecision` runtime.
- [Fixture](../../tests/fixtures/relevance/rubric-examples.json): đúng 24 ví dụ tự viết; SYNTHETIC/FIXTURE/benchmark_eligible=false ở dataset và từng ví dụ. Không URL/ID người thật. Context xác minh thương hiệu là giả định của tình huống, không là xác minh ngoài đời.
- Giữ Hà Nội là ưu tiên; không thêm exclusions quảng cáo, tuyển dụng, sang nhượng hoặc ngôn ngữ. Có ca private/unknown source relevance ACCEPT nhưng ghi vấn đề validity riêng. Có chỉ thị trong bài cả trường hợp nội dung đúng và sai chủ đề.

## Kiểm tra đã chạy

Node `v24.19.0`, Ajv `8.20.0` có sẵn. Không dependency mới, không build/source/runtime/UI/network/LLM hoặc thu nguồn thật. Kiểm thủ công rubric và các expected labels theo contract; chưa có reviewer thứ hai xác nhận ngữ nghĩa trên mẫu thật.

Kết quả lượt cuối:

```json
{
  "status": "PASS",
  "syntheticExamples": 24,
  "coverageTags": 29,
  "reasonCodes": 13,
  "evidenceHashesAndBindings": 26,
  "negativeSchemaCases": 23,
  "noEvidenceUnverifiedAllowed": true,
  "noRuntimeClassifierTested": true
}
```

23 ca sai kiểm runtime JSON/type, không chỉ TypeScript: thiếu result; enum array/object; reasons scalar/array lồng; code lạ hoặc lặp; code trái result; ACCEPT/REJECT thiếu evidence hoặc khai báo evidence còn thiếu; UNVERIFIED không nêu phần thiếu; field lạ ở root/evidence; role array/ref object; hash hỏng; rationale trắng; version/campaign sai. Unknown fields bị schema từ chối, **không phải** tuyên bố đã có sanitizer dữ liệu runtime.

Hash UTF-8 của 26 mẩu evidence khớp refs/version trong expected decisions; observation/record bindings khớp. Coverage gồm 29 tags, đủ toàn bộ nhóm case dispatch, cả 13 codes và 3 results. Các assertions về nhãn chỉ bảo vệ ví dụ đã viết, không chạy hoặc đo chất lượng classifier. Lượt strict Ajv ban đầu bắt thiếu `type: array` trong conditional schema; đã bổ sung đúng type và chạy lại toàn bộ, không hạ strict mode.

## Lệnh tái kiểm độc lập

Chạy từ root project trong PowerShell. Chỉ đọc file, không tạo output/build:

```powershell
@'
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
const schema=JSON.parse(readFileSync('.brain/specs/relevance_reason_codes.schema.json','utf8'));
const dataset=JSON.parse(readFileSync('tests/fixtures/relevance/rubric-examples.json','utf8'));
const validate=new Ajv({strict:true,allErrors:true,coerceTypes:false}).compile(schema);
assert.equal(dataset.examples.length,24);
const requiredTags=['recommendation_question','review','negative_review','no_exact_keyword','dating','event','brand_context','brand_homonym','outside_hanoi','unknown_location','incidental_keyword','advertisement','recruitment','bean_sale_only','home_brewing_only','image_only','missing_content','snippet','truncated_content','sufficient_snippet','private_source','unknown_source','embedded_instruction','instruction_without_relevance','instruction_with_relevance','conflicting_evidence','cafe_transfer','other_language','unknown_publication_date'];
const tags=new Set(), ids=new Set(), codes=new Set();
let evidenceCount=0;
for(const value of [dataset,...dataset.examples]) {
  assert.equal(value.provenance,'SYNTHETIC'); assert.equal(value.capture_mode,'FIXTURE'); assert.equal(value.benchmark_eligible,false);
}
for(const example of dataset.examples) {
  assert(!ids.has(example.example_id)); ids.add(example.example_id);
  for(const tag of example.coverage_tags) tags.add(tag);
  const decision=example.expected_relevance;
  assert(validate(decision), example.example_id+': '+JSON.stringify(validate.errors));
  assert.equal(decision.observation_ref,example.input.observation_ref);
  assert.equal(decision.record_version,example.input.record_version);
  for(const code of decision.reasons) codes.add(code);
  assert.equal(decision.evidence_refs.length,example.input.evidence.length);
  for(const evidence of example.input.evidence) {
    evidenceCount++;
    assert.equal(evidence.sha256,createHash('sha256').update(evidence.value,'utf8').digest('hex'));
    const refs=decision.evidence_refs.filter(ref=>ref.ref===evidence.ref);
    assert.equal(refs.length,1);
    assert.deepEqual(refs[0],{ref:evidence.ref,version:evidence.version,sha256:evidence.sha256,role:evidence.role});
    assert(evidence.ref.startsWith('synthetic:'));
  }
  assert(example.overall_validity_note.includes('FIXTURE'));
}
assert(!/https?:\/\/|facebook\.com|fb\.com/i.test(JSON.stringify(dataset)));
for(const tag of requiredTags) assert(tags.has(tag),'Missing coverage '+tag);
assert.deepEqual([...codes].sort(),[...schema.properties.reasons.items.enum].sort());
assert.deepEqual([...new Set(dataset.examples.map(e=>e.expected_relevance.result))].sort(),['ACCEPT','REJECT','UNVERIFIED']);
const byId=(id)=>dataset.examples.find(e=>e.example_id===`synthetic-relevance-${id}`).expected_relevance;
for(const id of ['08','09','10','11','19','20','22','24']) assert.equal(byId(id).result,'ACCEPT');
for(const id of ['07','12','16','17','23']) assert.equal(byId(id).result,'UNVERIFIED');
assert.equal(byId('21').result,'REJECT');
const base=byId('01'), reject=byId('06'), unknown=byId('07');
const cases=[
  ['missing result',base,x=>delete x.result],
  ['array result',base,x=>x.result=['ACCEPT']],
  ['object result',base,x=>x.result={value:'ACCEPT'}],
  ['scalar reasons',base,x=>x.reasons='CAFE_DISCOVERY_REQUEST'],
  ['array reason',base,x=>x.reasons=[['CAFE_DISCOVERY_REQUEST']]],
  ['unknown reason',base,x=>x.reasons=['SOURCE_UNVERIFIED']],
  ['duplicate reason',base,x=>x.reasons.push(x.reasons[0])],
  ['ACCEPT with REJECT code',base,x=>x.reasons=['UNRELATED_SUBJECT']],
  ['REJECT with ACCEPT code',reject,x=>x.reasons=['CAFE_EVENT']],
  ['UNVERIFIED with ACCEPT code',unknown,x=>x.reasons=['CAFE_EVENT']],
  ['ACCEPT no evidence',base,x=>x.evidence_refs=[]],
  ['REJECT no evidence',reject,x=>x.evidence_refs=[]],
  ['ACCEPT missing evidence',base,x=>x.missing_evidence=['USABLE_CONTENT']],
  ['REJECT missing evidence',reject,x=>x.missing_evidence=['USABLE_CONTENT']],
  ['UNVERIFIED no missing evidence',unknown,x=>x.missing_evidence=[]],
  ['unknown top field',base,x=>x.cookie='synthetic-secret-marker'],
  ['unknown evidence field',base,x=>x.evidence_refs[0].token='synthetic-secret-marker'],
  ['array evidence role',base,x=>x.evidence_refs[0].role=['CONTENT']],
  ['object evidence ref',base,x=>x.evidence_refs[0].ref={value:'synthetic:ref'}],
  ['bad evidence digest',base,x=>x.evidence_refs[0].sha256='placeholder'],
  ['blank rationale',base,x=>x.rationale='   '],
  ['wrong rubric version',base,x=>x.rubric_version='coffee-relevance-2.0.0'],
  ['wrong campaign',base,x=>x.campaign_id='unrelated-campaign']
];
for(const [name,original,mutate] of cases) {
  const changed=structuredClone(original); mutate(changed); assert.equal(validate(changed),false,name);
}
const noEvidence=structuredClone(unknown);
noEvidence.reasons=['CONTENT_MISSING']; noEvidence.missing_evidence=['USABLE_CONTENT']; noEvidence.evidence_refs=[];
assert.equal(validate(noEvidence),true);
console.log(JSON.stringify({status:'PASS',node:process.version,ajv:JSON.parse(readFileSync('node_modules/ajv/package.json','utf8')).version,syntheticExamples:dataset.examples.length,coverageTags:requiredTags.length,reasonCodes:codes.size,evidenceHashesAndBindings:evidenceCount,negativeSchemaCases:cases.length,noEvidenceUnverifiedAllowed:true,noRuntimeClassifierTested:true},null,2));
'@ | node --input-type=module
```

## Giới hạn và phần còn thiếu

Schema xác nhận hình dạng, không chứng minh evidence đáng tin hoặc reviewer hiểu đúng nội dung. Fixture không đánh giá bot, search yield, public visibility hoặc benchmark. P06.01 đầy đủ vẫn cần bộ mẫu thật được thu phù hợp data policy, làm sạch và gán nhãn/review dựa trên record/evidence thật. Những nhãn sau này phải giữ versions và bất đồng rõ ràng; thiếu bằng chứng vẫn UNVERIFIED.

Không chạy P06.02, không mở classifier/model/query expansion. Không sửa master/README, campaign, package/tsconfig, source, dist hoặc .test-build. Lead quyết định nghiệm thu phần chuẩn bị và bước tiếp theo.

[Manifest SHA-256](p06-rubric-manifest-2026-10-27.json) · [Handoff](../handoffs/p06-rubric-preparation-2026-10-27.md).

