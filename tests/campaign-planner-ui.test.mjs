import test from 'node:test';
import assert from 'node:assert/strict';
const { createCampaignPlanner } = await import(process.env.CSD_PLANNER_UI_TEST_MODULE ?? new URL('../dist/renderer/campaign-planner.js', import.meta.url).href);

// DOM contract tests for the built renderer module. They never open Electron,
// user profiles or network transports; native focus/layout is a separate smoke.
class Element {
  value = ''; checked = false; hidden = false; disabled = false; open = false; textContent = ''; options = [];
  listeners = new Map();
  addEventListener(type, listener) { const listeners = this.listeners.get(type) ?? []; listeners.push(listener); this.listeners.set(type, listeners); }
  replaceChildren(...children) { this.options = children; this.value = children[0]?.value ?? ''; }
  emit(type, event = {}) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  matches(selector) { return selector === 'input, textarea, select'; }
}
const config = () => ({ enabled: true, prompt: 'Tìm lớp học piano', brandContext: '', totalTarget: 1000, threadsShare: 0.8, rawCap: 3000, budgetUsd: 3, commentsEnabled: true });
function draft(extended = false) {
  return { runId: 'synthetic-run', revision: 'revision-1', status: 'DRAFT', supported: true, config: config(), configHash: 'synthetic-config-hash',
    criteriaCapabilities: { extendedClassificationCriteria: extended },
    criteria: { topic: 'Lớp học piano', audience: ['Người mới'], needs: ['Tìm lớp học'], participation_intents: ['Hỏi kinh nghiệm'],
      research_intents: ['Nhu cầu học'], inclusions: [], exclusions: [], required_geographies: [], preferred_geographies: [], languages: ['vi'],
      queries: [{ text: 'lớp piano', family: 'REQUEST', platforms: ['facebook', 'threads'] }], assumptions: [], max_age_days: null,
      watch: { enabled: true, revisit_hours: [2, 8, 24], ttl_hours: 72, max_attempts: 1 } } };
}
function fixture(initial = draft(), overrides = {}) {
  const originalDocument = globalThis.document, elements = new Map(), calls = { prepare: 0, updates: [], applied: [], saved: [], catalogs: 0, choices: 0, retained: [], profiles: 0 };
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  globalThis.document = { getElementById: get, createElement: () => new Element(), activeElement: null };
  let state = { config: { opportunity: initial.config }, campaignDraft: initial, campaignPresets: [] }, currentConfig = state.config;
  let busy = false, pending = Promise.resolve(), lastError = null, planner;
  const api = {
    async prepareCampaign() { calls.prepare++; return state; },
    async updateCampaign(request) {
      calls.updates.push(request);
      return { ...state, campaignDraft: { ...state.campaignDraft, revision: 'saved-' + calls.updates.length,
        criteria: { ...state.campaignDraft.criteria, ...request.criteriaPatch } } };
    },
    async applyCampaignPreset(request) { calls.applied.push(request); return state; },
    async saveCampaignPreset(request) { calls.saved.push(request); return state; },
    async listRetainedSources() { calls.catalogs++; return { sources: [], issues: [] }; },
    async chooseRetainedSourceRoot() { calls.choices++; return null; },
    async startRetained(request) { calls.retained.push(request); return state; },
    async start() { calls.profiles++; throw Error('LIVE_START_MUST_NOT_RUN'); },
    async login() { calls.profiles++; throw Error('LOGIN_MUST_NOT_RUN'); },
    ...overrides,
  };
  planner = createCampaignPlanner({ api, state: () => state, config: () => currentConfig, busy: () => busy,
    changed: () => planner?.render(),
    execute(action) {
      busy = true; planner.render();
      pending = Promise.resolve().then(action).then(next => { state = next; currentConfig = next.config ?? currentConfig; })
        .catch(error => { lastError = error; }).finally(() => { busy = false; planner.render(); });
      return pending;
    } });
  planner.render();
  return { planner, get, calls, api,
    get state() { return state; }, get error() { return lastError; },
    setConfig(next) { currentConfig = { opportunity: next }; planner.render(); },
    poll(next = state) { state = next; planner.render(); },
    setBusy(value) { busy = value; planner.render(); },
    edit(id, value) { const control = get(id); assert.equal(control.disabled, false, id + ' must be editable');
      if (typeof value === 'boolean') control.checked = value; else control.value = value; control.emit('input'); },
    async click(id) { assert.equal(get(id).disabled, false, id + ' must be enabled'); get(id).emit('click'); await pending; },
    async flush() { await new Promise(setImmediate); await pending; },
    close() { globalThis.document = originalDocument; },
  };
}

test('polling preserves dirty edits and a newer server revision requires explicit reset before save', async () => {
  const f = fixture(); try {
    f.edit('criteria-topic', 'Nội dung đang sửa'); f.poll();
    assert.equal(f.get('criteria-topic').value, 'Nội dung đang sửa'); assert.equal(f.planner.hasUnsavedEdits(), true);
    assert.equal(f.planner.draftReference(), undefined);
    const next = { ...f.state, campaignDraft: { ...f.state.campaignDraft, revision: 'revision-2', criteria: { ...f.state.campaignDraft.criteria, topic: 'Bản mới từ server' } } };
    f.poll(next); assert.equal(f.get('criteria-topic').value, 'Nội dung đang sửa'); assert.equal(f.get('save-campaign-criteria').disabled, true);
    await f.click('reset-campaign-criteria');
    assert.equal(f.get('criteria-topic').value, 'Bản mới từ server'); assert.equal(f.planner.hasUnsavedEdits(), false);
    assert.equal(f.planner.draftReference().revision, 'revision-2');
  } finally { f.close(); }
});

test('failed prompt switch keeps local edits visible and discardable even without a server draft', async () => {
  const f = fixture(); try {
    f.edit('criteria-topic', 'Giữ nội dung chưa lưu'); f.setConfig({ ...config(), prompt: 'Một nhu cầu khác' });
    f.api.prepareCampaign = async () => ({ config: { opportunity: { ...config(), prompt: 'Một nhu cầu khác' } }, campaignDraftError: { code: 'MODEL_BUDGET_EXHAUSTED' }, campaignPresets: [] });
    await f.click('prepare-campaign'); f.poll();
    assert.equal(f.planner.hasUnsavedEdits(), true); assert.equal(f.get('campaign-plan-editor').hidden, false);
    assert.equal(f.get('criteria-topic').value, 'Giữ nội dung chưa lưu'); assert.equal(f.get('reset-campaign-criteria').disabled, false);
    assert.equal(f.get('save-campaign-criteria').disabled, true);
    await f.click('reset-campaign-criteria'); assert.equal(f.planner.hasUnsavedEdits(), false); assert.equal(f.get('campaign-plan-editor').hidden, true);
  } finally { f.close(); }
});

test('unrelated criteria edit preserves the configured watch attempt cap; changing that cap is explicit', async () => {
  const f = fixture(); try {
    f.edit('criteria-topic', 'Chỉ đổi chủ đề'); await f.click('save-campaign-criteria');
    assert.equal(f.calls.updates[0].criteriaPatch.watch.max_attempts, 1);
    assert.deepEqual(f.calls.updates[0].criteriaPatch.watch.revisit_hours, [2, 8, 24]);
    f.edit('criteria-watch-attempts', '2'); await f.click('save-campaign-criteria');
    assert.equal(f.calls.updates[1].criteriaPatch.watch.max_attempts, 2);
  } finally { f.close(); }
});

test('disabled watch with a blank schedule submits an empty list rather than a zero-hour visit', async () => {
  const f = fixture(); try {
    f.edit('criteria-watch-enabled', false); f.edit('criteria-watch-hours', '  '); f.edit('criteria-watch-attempts', '0');
    await f.click('save-campaign-criteria');
    assert.deepEqual(f.calls.updates[0].criteriaPatch.watch, { enabled: false, revisit_hours: [], ttl_hours: 72, max_attempts: 0 });
  } finally { f.close(); }
});

test('an unrelated edit preserves all same-text query entries with their individual platform and family metadata', async () => {
  const plan = draft();
  plan.criteria.queries = [{ text: 'lớp piano', family: 'REQUEST', platforms: ['facebook'] },
    { text: 'lớp piano', family: 'EXPERIENCE', platforms: ['threads'] }];
  const f = fixture(plan); try {
    f.edit('criteria-topic', 'Chỉ sửa tên chủ đề'); await f.click('save-campaign-criteria');
    assert.deepEqual(f.calls.updates[0].criteriaPatch.queries, plan.criteria.queries);
  } finally { f.close(); }
});

test('polling keeps preset selection and typed name; applying a preset uses current runtime without planning', async () => {
  const f = fixture(); try {
    const next = { ...f.state, campaignPresets: [{ presetId: 'preset', version: 'version', name: 'Bộ lọc mẫu', supported: true }] };
    f.poll(next); f.get('campaign-preset').value = 'preset:version'; f.get('campaign-preset').emit('change');
    f.get('campaign-preset-name').value = 'Tên đang nhập'; f.get('campaign-preset-name').emit('input');
    f.poll(structuredClone(next)); assert.equal(f.get('campaign-preset').value, 'preset:version'); assert.equal(f.get('campaign-preset-name').value, 'Tên đang nhập');
    f.setConfig({ ...config(), totalTarget: 1001, threadsShare: 0.7, rawCap: 4000 });
    await f.click('apply-campaign-preset');
    assert.equal(f.calls.prepare, 0); assert.deepEqual(f.calls.applied, [{ presetId: 'preset', presetVersion: 'version',
      runtime: { totalTarget: 1001, threadsShare: 0.7, rawCap: 4000, budgetUsd: 3, commentsEnabled: true } }]);
  } finally { f.close(); }
});

test('legacy extended criteria are read-only and omitted from updates; enabled policy propagates deliberate edits', async () => {
  for (const extended of [false, true]) {
    const f = fixture(draft(extended)); try {
      for (const field of ['audience', 'languages', 'research-intents']) assert.equal(f.get('criteria-' + field).disabled, !extended);
      assert.equal(f.get('criteria-context-note').hidden, extended);
      if (extended) f.edit('criteria-languages', 'vi\nen'); else f.edit('criteria-topic', 'Chủ đề mới');
      await f.click('save-campaign-criteria'); const patch = f.calls.updates[0].criteriaPatch;
      if (extended) assert.deepEqual(patch.languages, ['vi', 'en']);
      else for (const field of ['audience', 'languages', 'research_intents']) assert.equal(Object.hasOwn(patch, field), false);
    } finally { f.close(); }
  }
});

test('failed save preserves edits and revision while busy/started states cannot edit criteria', async () => {
  const f = fixture(); try {
    f.edit('criteria-topic', 'Giữ khi lưu lỗi'); f.api.updateCampaign = async () => { throw Error('DRAFT_REVISION_CONFLICT'); };
    await f.click('save-campaign-criteria'); assert.equal(f.error.message, 'DRAFT_REVISION_CONFLICT');
    assert.equal(f.planner.hasUnsavedEdits(), true); assert.equal(f.get('criteria-topic').value, 'Giữ khi lưu lỗi');
    f.setBusy(true); assert.equal(f.get('criteria-topic').disabled, true); assert.equal(f.get('save-campaign-criteria').disabled, true);
    f.setBusy(false); await f.click('reset-campaign-criteria');
    f.poll({ ...f.state, campaignDraft: { ...f.state.campaignDraft, status: 'STARTED' } });
    assert.equal(f.get('criteria-topic').disabled, true); assert.equal(f.planner.draftReference(), undefined);
  } finally { f.close(); }
});

test('planner action mousedown retains input focus until its click to avoid blur disabling the action', () => {
  const f = fixture(); try {
    globalThis.document.activeElement = new Element();
    for (const id of ['prepare-campaign', 'save-campaign-criteria', 'save-campaign-preset', 'apply-campaign-preset', 'start-retained', 'refresh-retained-sources', 'choose-retained-source-root']) {
      let prevented = false; f.get(id).emit('mousedown', { button: 0, preventDefault() { prevented = true; } }); assert.equal(prevented, true);
      prevented = false; f.get(id).emit('mousedown', { button: 2, preventDefault() { prevented = true; } }); assert.equal(prevented, false);
    }
  } finally { f.close(); }
});

const retainedSource = (id = 'source-one') => ({ runId: id, prompt: 'Dữ liệu từ lượt trước', updatedAt: '2026-10-30T12:00:00.000Z', bytes: 1234, format: 'OBSERVATION_JOURNAL' });
const sourceCatalog = (sources = [], issues = []) => ({ sources, issues });
function chooseSource(f, id) { f.get('retained-source').value = id; f.get('retained-source').emit('change'); }

test('retained source catalog loads only on explicit refresh and polling preserves its selection', async () => {
  const f = fixture(); let sources = [retainedSource(), retainedSource('source-two')];
  f.api.listRetainedSources = async () => { f.calls.catalogs++; return sourceCatalog(sources); };
  try {
    for (let i = 0; i < 8; i++) f.poll(structuredClone(f.state));
    assert.equal(f.calls.catalogs, 0); assert.equal(f.get('retained-source').disabled, true); assert.equal(f.get('start-retained').disabled, true);
    await f.click('refresh-retained-sources'); await f.flush(); assert.equal(f.calls.catalogs, 1);
    chooseSource(f, 'source-two');
    for (let i = 0; i < 8; i++) f.poll(structuredClone(f.state));
    assert.equal(f.calls.catalogs, 1); assert.equal(f.get('retained-source').value, 'source-two');
    await f.click('refresh-retained-sources'); await f.flush(); assert.equal(f.get('retained-source').value, 'source-two');
    sources = [retainedSource()]; await f.click('refresh-retained-sources'); await f.flush();
    assert.equal(f.get('retained-source').value, ''); assert.equal(f.get('start-retained').disabled, true);
    assert.equal(f.calls.retained.length, 0); assert.equal(f.calls.profiles, 0);
  } finally { f.close(); }
});

test('retained action passes the fresh prepared reference and source without login, profile selection or replanning', async () => {
  const f = fixture(); f.api.listRetainedSources = async () => sourceCatalog([retainedSource()]);
  try {
    f.poll({ ...f.state, accounts: [] });
    await f.click('refresh-retained-sources'); await f.flush(); chooseSource(f, 'source-one');
    assert.equal(f.get('start-retained').disabled, false);
    await f.click('start-retained');
    assert.deepEqual(f.calls.retained, [{ sourceRunId: 'source-one', draft: { runId: 'synthetic-run', revision: 'revision-1', configHash: 'synthetic-config-hash' } }]);
    assert.equal(f.calls.prepare, 0); assert.equal(f.calls.profiles, 0);
    f.api.startRetained = async () => { throw Error('RETAINED_SOURCE_PREFIX_CHANGED'); };
    await f.click('start-retained'); assert.equal(f.error.message, 'RETAINED_SOURCE_PREFIX_CHANGED');
    assert.equal(f.get('retained-source').value, 'source-one'); assert.equal(f.get('start-retained').disabled, false);
    assert.equal(f.planner.draftReference().revision, 'revision-1');
  } finally { f.close(); }
});

test('retained controls block absent, self, consumed, unsupported, dirty, changed-config and busy plans', async () => {
  const f = fixture(), original = f.state;
  f.api.listRetainedSources = async () => sourceCatalog([retainedSource(), retainedSource('synthetic-run')]);
  try {
    await f.click('refresh-retained-sources'); await f.flush();
    assert.equal(f.get('start-retained').disabled, true);
    chooseSource(f, 'synthetic-run'); assert.equal(f.get('start-retained').disabled, true);
    chooseSource(f, 'source-one'); assert.equal(f.get('start-retained').disabled, false);
    for (const nextDraft of [undefined, { ...draft(), status: 'STARTED' }, { ...draft(), supported: false }]) {
      f.poll({ ...original, campaignDraft: nextDraft }); assert.equal(f.get('start-retained').disabled, true);
    }
    f.poll(original); f.edit('criteria-topic', 'Chưa lưu'); assert.equal(f.get('start-retained').disabled, true);
    await f.click('reset-campaign-criteria'); assert.equal(f.get('start-retained').disabled, false);
    f.setConfig({ ...config(), prompt: 'Nhu cầu mới' }); assert.equal(f.get('start-retained').disabled, true);
    f.setConfig(config()); f.setBusy(true);
    for (const id of ['start-retained', 'retained-source', 'refresh-retained-sources']) assert.equal(f.get(id).disabled, true);
    f.setBusy(false); assert.equal(f.get('start-retained').disabled, false); assert.equal(f.calls.retained.length, 0);
  } finally { f.close(); }
});

test('retained catalog loading and failures remain explicit and never trigger automatic retries or starts', async () => {
  const f = fixture(); let resolveSources;
  f.api.listRetainedSources = () => { f.calls.catalogs++; return new Promise(resolve => { resolveSources = resolve; }); };
  try {
    await f.click('refresh-retained-sources');
    for (const id of ['refresh-retained-sources', 'retained-source', 'start-retained']) assert.equal(f.get(id).disabled, true);
    f.poll(); f.get('refresh-retained-sources').emit('click'); assert.equal(f.calls.catalogs, 1);
    resolveSources(sourceCatalog()); await f.flush();
    assert.equal(f.get('refresh-retained-sources').disabled, false); assert.equal(f.get('retained-source').disabled, true);
    assert.match(f.get('retained-source-note').textContent, /Chưa có/);
    f.api.listRetainedSources = async () => { f.calls.catalogs++; throw Error('CATALOG_SYNTHETIC_READ_FAILURE'); };
    await f.click('refresh-retained-sources'); await f.flush();
    assert.match(f.get('retained-source-note').textContent, /Chưa đọc được/); assert.equal(f.get('start-retained').disabled, true);
    for (let i = 0; i < 8; i++) f.poll();
    assert.equal(f.calls.catalogs, 2); assert.equal(f.calls.retained.length, 0); assert.equal(f.calls.profiles, 0);
  } finally { resolveSources?.(sourceCatalog()); await f.flush(); f.close(); }
});

test('external source IDs distinguish colliding run IDs and only opaque IDs cross the retained Start request', async () => {
  const f = fixture(), rootId = 'source-root-00000000-0000-4000-8000-000000000001';
  const local = retainedSource('synthetic-run'), external = { ...local, sourceRootId: rootId, sourceLabel: 'Bản dữ liệu đã chọn' };
  f.api.listRetainedSources = async () => sourceCatalog([local, external]);
  try {
    await f.click('refresh-retained-sources'); await f.flush();
    assert.deepEqual(f.get('retained-source').options.map(option => option.value), ['', 'synthetic-run', rootId + '|synthetic-run']);
    chooseSource(f, 'synthetic-run'); assert.equal(f.get('start-retained').disabled, true, 'the local draft cannot import itself');
    chooseSource(f, rootId + '|synthetic-run'); assert.equal(f.get('start-retained').disabled, false, 'same run ID in an external root is a distinct source');
    await f.click('start-retained');
    assert.deepEqual(f.calls.retained, [{ sourceRunId: 'synthetic-run', sourceRootId: rootId,
      draft: { runId: 'synthetic-run', revision: 'revision-1', configHash: 'synthetic-config-hash' } }]);
    assert.equal(Object.hasOwn(f.calls.retained[0], 'directory'), false); assert.equal(Object.hasOwn(f.calls.retained[0], 'selectedPath'), false);
    assert.equal(f.calls.profiles, 0);
  } finally { f.close(); }
});

test('native folder-picker cancel and failure preserve an existing selection without automatic catalog or Start calls', async () => {
  const f = fixture(); f.api.listRetainedSources = async () => sourceCatalog([retainedSource()]);
  try {
    await f.click('refresh-retained-sources'); await f.flush(); chooseSource(f, 'source-one');
    const note = f.get('retained-source-note').textContent;
    f.api.chooseRetainedSourceRoot = async (...args) => { f.calls.choices++; assert.equal(args.length, 0); return null; };
    await f.click('choose-retained-source-root'); await f.flush();
    assert.equal(f.get('retained-source').value, 'source-one'); assert.equal(f.get('retained-source-note').textContent, note);
    f.api.chooseRetainedSourceRoot = async () => { f.calls.choices++; throw Error('RETAINED_SOURCE_ROOT_COLLECTIONS_REQUIRED'); };
    await f.click('choose-retained-source-root'); await f.flush();
    assert.equal(f.get('retained-source').value, 'source-one'); assert.match(f.get('retained-source-note').textContent, /Chưa thêm được/);
    for (let i = 0; i < 5; i++) f.poll();
    assert.equal(f.calls.choices, 2); assert.equal(f.calls.retained.length, 0); assert.equal(f.calls.profiles, 0);
  } finally { f.close(); }
});

test('partial external catalog failure is visible while readable local sources remain usable', async () => {
  const f = fixture();
  f.api.chooseRetainedSourceRoot = async () => sourceCatalog([retainedSource()], [{ sourceRootId: 'source-root-unavailable', label: 'Ổ dữ liệu rời', code: 'RETAINED_SOURCE_ROOT_MISSING' }]);
  try {
    await f.click('choose-retained-source-root'); await f.flush();
    assert.match(f.get('retained-source-note').textContent, /Chưa đọc được: Ổ dữ liệu rời/);
    chooseSource(f, 'source-one'); assert.equal(f.get('start-retained').disabled, false);
    await f.click('start-retained'); assert.equal(f.calls.retained[0].sourceRunId, 'source-one'); assert.equal(f.calls.retained[0].sourceRootId, undefined);
    f.setBusy(true); assert.equal(f.get('choose-retained-source-root').disabled, true);
  } finally { f.close(); }
});
