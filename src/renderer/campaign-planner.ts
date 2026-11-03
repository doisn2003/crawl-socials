import type { ProductionApi, ProductionState, RetainedSourceCatalog, RetainedSourceSummary, UserConfig } from '../shared/production-api.js';
import type { CampaignCriteriaPatch, CampaignDraftReference, CampaignDraftView } from '../shared/campaign-drafts.js';
import { createIntentDialogue } from './intent-dialogue.js';

interface PlannerHost {
  api: ProductionApi;
  state(): ProductionState | null;
  config(): UserConfig;
  busy(): boolean;
  changed(): void;
  execute(action: () => Promise<ProductionState>, message: string): Promise<void>;
}
const node = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const lines = (value: string) => [...new Set(value.split(/\r?\n/u).map(text => text.trim()).filter(Boolean))];
const listFields = ['audience', 'needs', 'participation_intents', 'research_intents', 'inclusions', 'exclusions', 'required_geographies', 'preferred_geographies', 'languages'] as const;
const inputId = (key: string) => 'criteria-' + key.replaceAll('_', '-');
const sourceKey = (source: RetainedSourceSummary) => source.sourceRootId ? source.sourceRootId + '|' + source.runId : source.runId;

/** Review and clarification precede collection; historical ready drafts remain reusable. */
export function createCampaignPlanner(host: PlannerHost) {
  let displayedRevision = '', editedRevision = '', dirty = false, presetKey = '';
  let sources: RetainedSourceSummary[] = [], loadingSources = false;
  const dialogue = createIntentDialogue({ ...host, submit: request => host.execute(async () => {
    const next = await host.api.continueCampaign(request);
    if (!next.campaignDraftError) { dirty = false; displayedRevision = ''; }
    return next;
  }, 'Đã cập nhật cách hiểu nhu cầu. Kiểm tra câu hỏi hoặc từ khóa bên dưới.') });
  const controls = [node<HTMLInputElement>('criteria-topic'), ...listFields.map(key => node<HTMLTextAreaElement>(inputId(key))),
    node<HTMLTextAreaElement>('criteria-queries'), node<HTMLInputElement>('criteria-max-age-days'),
    node<HTMLInputElement>('criteria-watch-enabled'), node<HTMLInputElement>('criteria-watch-hours'), node<HTMLInputElement>('criteria-watch-ttl'),
    node<HTMLInputElement>('criteria-watch-attempts')];
  const matches = (draft: CampaignDraftView) => {
    const config = host.config().opportunity;
    return !!config && config.languageScope === draft.config.languageScope
      && Object.keys(draft.config).every(key => config[key as keyof typeof config] === draft.config[key as keyof typeof draft.config]);
  };
  function draftReference(): CampaignDraftReference | undefined {
    const draft = host.state()?.campaignDraft;
    return draft?.supported && draft.status === 'DRAFT' && matches(draft) && !dirty && !dialogue.hasUnsavedEdits()
      ? { runId: draft.runId, revision: draft.revision, configHash: draft.configHash } : undefined;
  }
  function fill(draft: CampaignDraftView) {
    node<HTMLInputElement>('criteria-topic').value = draft.criteria.topic;
    for (const key of listFields) node<HTMLTextAreaElement>(inputId(key)).value = draft.criteria[key].join('\n');
    node<HTMLTextAreaElement>('criteria-queries').value = draft.criteria.queries.map(query => query.text).join('\n');
    node<HTMLInputElement>('criteria-max-age-days').value = draft.criteria.max_age_days === null ? '' : String(draft.criteria.max_age_days);
    node<HTMLInputElement>('criteria-watch-enabled').checked = draft.criteria.watch.enabled;
    node<HTMLInputElement>('criteria-watch-hours').value = draft.criteria.watch.revisit_hours.join(', ');
    node<HTMLInputElement>('criteria-watch-ttl').value = String(draft.criteria.watch.ttl_hours);
    node<HTMLInputElement>('criteria-watch-attempts').value = String(draft.criteria.watch.max_attempts);
    node('criteria-assumptions').textContent = draft.criteria.assumptions.length ? draft.criteria.assumptions.join(' · ') : 'Không có giả định bổ sung.';
    displayedRevision = draft.revision; editedRevision = draft.revision;
  }
  function render() {
    dialogue.render();
    const state = host.state(), draft = state?.campaignDraft, config = host.config().opportunity;
    node('campaign-planning').hidden = !config?.enabled || config.filterMode === 'OFF';
    const busy = host.busy(), staleEdits = dirty && draft?.revision !== editedRevision;
    const editable = !!draft && draft.status === 'DRAFT' && draft.supported && matches(draft) && !busy && !staleEdits;
    node<HTMLButtonElement>('prepare-campaign').disabled = busy || !config?.prompt.trim();
    node<HTMLButtonElement>('prepare-campaign').textContent = state?.campaignDraftError ? 'Thử lại kế hoạch' : 'Xem tiêu chí trước khi thu';
    node<HTMLDetailsElement>('campaign-plan-editor').hidden = !draft && !dirty;
    if (draft && draft.revision !== displayedRevision && !dirty) fill(draft);
    for (const control of controls) control.disabled = !editable;
    const extendedCriteria = draft?.criteriaCapabilities.extendedClassificationCriteria === true;
    node('criteria-context-note').hidden = !draft || extendedCriteria;
    for (const field of ['audience', 'languages', 'research_intents']) node<HTMLTextAreaElement>(inputId(field)).disabled = !editable || !extendedCriteria;
    node<HTMLButtonElement>('save-campaign-criteria').disabled = !editable || !dirty;
    node<HTMLButtonElement>('reset-campaign-criteria').disabled = busy || !dirty;
    node('campaign-plan-status').textContent = staleEdits ? 'Thay đổi chưa lưu thuộc kế hoạch trước. Hoàn tác thay đổi để dùng kế hoạch hiện tại, hoặc thử lập lại kế hoạch.'
      : !draft ? '' : !draft.supported ? 'Bộ lọc lưu trước đây cần được nâng cấp trước khi sử dụng.'
      : !matches(draft) ? 'Nhu cầu hoặc giới hạn đã thay đổi. Xem kế hoạch mới để cập nhật tiêu chí.'
        : dirty ? 'Tiêu chí đang có thay đổi chưa lưu.' : draft.status === 'STARTED' ? 'Tiêu chí của lượt đã bắt đầu; giữ nguyên để đối chiếu kết quả.'
          : 'Kế hoạch sẵn sàng. Bạn có thể sửa tiêu chí hoặc bắt đầu thu thập.';
    const cost = state?.campaignDraftPreparing?.cost ?? state?.campaignDraftError?.cost ?? draft?.cost ?? state?.campaignDialogue?.cost;
    node('campaign-plan-cost').textContent = cost ? `Chi phí lập kế hoạch: $${cost.measuredUsd.toFixed(4)}`
      + (cost.unknownUpperUsd + cost.reservedUsd > 0 ? `–$${(cost.measuredUsd + cost.unknownUpperUsd + cost.reservedUsd).toFixed(4)}` : '')
      + ' · Được tính trong ngân sách của lượt thu.' : 'CSD sẽ làm rõ yêu cầu trước khi tìm bài. Chi phí nằm trong giới hạn $3 của lượt này.';
    const presets = state?.campaignPresets ?? [], nextKey = JSON.stringify(presets.map(p => [p.presetId, p.version, p.name, p.supported]));
    const select = node<HTMLSelectElement>('campaign-preset');
    if (nextKey !== presetKey) {
      const previous = select.value, placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Chọn bộ lọc đã lưu';
      select.replaceChildren(placeholder, ...presets.map(preset => { const option = document.createElement('option');
        option.value = preset.presetId + ':' + preset.version; option.textContent = preset.name + (preset.supported ? '' : ' (cần nâng cấp)'); option.disabled = !preset.supported; return option; }));
      if ([...select.options].some(option => option.value === previous)) select.value = previous;
      presetKey = nextKey;
    }
    select.disabled = busy || !presets.length;
    node<HTMLButtonElement>('apply-campaign-preset').disabled = busy || !select.value || !config;
    const canSave = (draft?.supported && !dirty && matches(draft)) || (!draft && !!state?.run?.opportunity);
    node<HTMLInputElement>('campaign-preset-name').disabled = busy || !canSave;
    node<HTMLButtonElement>('save-campaign-preset').disabled = busy || !canSave || !node<HTMLInputElement>('campaign-preset-name').value.trim();
    node<HTMLButtonElement>('refresh-retained-sources').disabled = busy || loadingSources;
    node<HTMLButtonElement>('choose-retained-source-root').disabled = busy || loadingSources;
    node<HTMLSelectElement>('retained-source').disabled = busy || loadingSources || !sources.length;
    const selectedSource = sources.find(source => sourceKey(source) === node<HTMLSelectElement>('retained-source').value);
    node<HTMLButtonElement>('start-retained').disabled = busy || loadingSources || !draftReference() || !selectedSource
      || (!selectedSource.sourceRootId && selectedSource.runId === draft?.runId);
  }
  for (const control of controls) control.addEventListener('input', () => { dirty = true; host.changed(); render(); });
  node('campaign-preset-name').addEventListener('input', render);
  node('campaign-preset').addEventListener('change', render);
  node('retained-source').addEventListener('change', render);
  function showSources(catalog: RetainedSourceCatalog) {
    sources = catalog.sources;
    const select = node<HTMLSelectElement>('retained-source'), previous = select.value;
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Chọn lượt dữ liệu đã lưu';
    select.replaceChildren(placeholder, ...sources.map(source => {
      const option = document.createElement('option'); option.value = sourceKey(source);
      option.textContent = new Date(source.updatedAt).toLocaleDateString('vi-VN') + ' · ' + (source.prompt || 'Lượt dữ liệu')
        + (source.format === 'LEGACY_JSONL' ? ' · Bài viết' : ' · Có bình luận')
        + (source.sourceLabel ? ' · ' + source.sourceLabel : ' · Máy này');
      return option;
    }));
    if (sources.some(source => sourceKey(source) === previous)) select.value = previous;
    node('retained-source-note').textContent = (sources.length ? 'Dùng tiêu chí đã xem/lưu ở trên. Chi phí được tính cho lượt mới; bài và bình luận nguồn được giữ nguyên.'
      : 'Chưa có lượt dữ liệu hỗ trợ lọc lại trong các thư mục đã chọn.')
      + (catalog.issues.length ? ' Chưa đọc được: ' + catalog.issues.map(issue => issue.label).join(', ') + '. Kiểm tra thư mục còn trên máy hoặc chọn lại nguồn.' : '');
  }
  async function loadSources(choose: boolean) {
    if (host.busy() || loadingSources) return;
    loadingSources = true; render();
    try {
      const catalog = await (choose ? host.api.chooseRetainedSourceRoot() : host.api.listRetainedSources());
      if (catalog) showSources(catalog);
    } catch {
      if (!choose) { sources = []; node<HTMLSelectElement>('retained-source').value = ''; }
      node('retained-source-note').textContent = choose ? 'Chưa thêm được nguồn. Chọn thư mục CSD đã dùng để lưu bài viết.'
        : 'Chưa đọc được danh sách dữ liệu đã lưu. Hãy thử lại.';
    }
    finally { loadingSources = false; render(); }
  }
  node('refresh-retained-sources').addEventListener('click', () => { void loadSources(false); });
  node('choose-retained-source-root').addEventListener('click', () => { void loadSources(true); });
  node('start-retained').addEventListener('click', () => { void host.execute(async () => {
    const draft = draftReference(), source = sources.find(item => sourceKey(item) === node<HTMLSelectElement>('retained-source').value);
    if (!draft || !source) throw Error('RETAINED_INPUT_INVALID');
    return host.api.startRetained({ sourceRunId: source.runId, ...(source.sourceRootId ? { sourceRootId: source.sourceRootId } : {}), draft });
  }, 'Đã tạo lượt lọc lại bằng tiêu chí mới. Xem tiến độ và kết quả ở bên dưới.'); });
  node('prepare-campaign').addEventListener('click', () => { void host.execute(async () => {
    const next = await host.api.prepareCampaign();
    if (!next.campaignDraftError) { dirty = false; displayedRevision = ''; node<HTMLDetailsElement>('campaign-plan-editor').open = true; }
    return next;
  }, 'Đã phân tích nhu cầu. Xem câu hỏi làm rõ hoặc tiêu chí và từ khóa bên dưới.'); });
  node('save-campaign-criteria').addEventListener('click', () => { void host.execute(async () => {
    const draft = host.state()?.campaignDraft; if (!draft || !matches(draft)) throw Error('DRAFT_CONFIG_MISMATCH');
    const queries = lines(node<HTMLTextAreaElement>('criteria-queries').value).flatMap(text => {
      // The same text can have distinct platform scopes/families in a saved plan.
      const existing = draft.criteria.queries.filter(query => query.text === text);
      return existing.length ? existing : [{ text, family: 'BROAD' as const, platforms: ['threads' as const, 'facebook' as const] }];
    });
    const hours = node<HTMLInputElement>('criteria-watch-hours').value.trim();
    const revisit = hours ? hours.split(',').map(value => Number(value.trim())) : [];
    const age = node<HTMLInputElement>('criteria-max-age-days').value.trim();
    const patch: CampaignCriteriaPatch = { topic: node<HTMLInputElement>('criteria-topic').value.trim(), queries,
      ...Object.fromEntries(listFields.filter(key => draft.criteriaCapabilities.extendedClassificationCriteria
        || !['audience', 'languages', 'research_intents'].includes(key)).map(key => [key, lines(node<HTMLTextAreaElement>(inputId(key)).value)])),
      max_age_days: age ? Number(age) : null,
      watch: { enabled: node<HTMLInputElement>('criteria-watch-enabled').checked, revisit_hours: revisit,
        ttl_hours: Number(node<HTMLInputElement>('criteria-watch-ttl').value), max_attempts: Number(node<HTMLInputElement>('criteria-watch-attempts').value) } };
    const next = await host.api.updateCampaign({ runId: draft.runId, expectedRevision: editedRevision, criteriaPatch: patch });
    dirty = false; displayedRevision = ''; return next;
  }, 'Đã lưu tiêu chí. Lượt thu sẽ dùng đúng phiên bản này.'); });
  node('reset-campaign-criteria').addEventListener('click', () => {
    const draft = host.state()?.campaignDraft; dirty = false; displayedRevision = ''; editedRevision = '';
    if (draft) fill(draft); host.changed(); render();
  });
  node('save-campaign-preset').addEventListener('click', () => { void host.execute(async () => {
    const draft = host.state()?.campaignDraft, run = host.state()?.run;
    const source = draft ? { kind: 'DRAFT' as const, runId: draft.runId, revision: draft.revision }
      : run ? { kind: 'RUN' as const, runId: run.id } : null;
    if (!source) throw Error('DRAFT_NOT_AVAILABLE');
    return host.api.saveCampaignPreset({ name: node<HTMLInputElement>('campaign-preset-name').value.trim(), source });
  }, 'Đã lưu bộ lọc để dùng lại với lượt thu khác.'); });
  node('apply-campaign-preset').addEventListener('click', () => { void host.execute(async () => {
    const [presetId, presetVersion] = node<HTMLSelectElement>('campaign-preset').value.split(':'), config = host.config().opportunity;
    if (!presetId || !presetVersion || !config) throw Error('PRESET_ID_INVALID');
    const next = await host.api.applyCampaignPreset({ presetId, presetVersion, runtime: { totalTarget: config.totalTarget,
      ...(config.languageScope ? { languageScope: config.languageScope } : {}),
      ...(config.filterMode ? { filterMode: config.filterMode } : { threadsShare: config.threadsShare! }), rawCap: config.rawCap, budgetUsd: config.budgetUsd, commentsEnabled: config.commentsEnabled } });
    dirty = false; displayedRevision = ''; node<HTMLDetailsElement>('campaign-plan-editor').open = true; return next;
  }, 'Đã dùng lại bộ lọc, không gọi AI để lập lại kế hoạch.'); });
  // A config blur starts autosave. Preserve focus until click so autosave cannot
  // disable the requested action between mousedown and mouseup; execute awaits it.
  for (const id of ['prepare-campaign', 'save-campaign-criteria', 'save-campaign-preset', 'apply-campaign-preset', 'start-retained', 'refresh-retained-sources', 'choose-retained-source-root']) {
    node(id).addEventListener('mousedown', event => {
      if (event.button === 0 && document.activeElement?.matches('input, textarea, select')) event.preventDefault();
    });
  }
  return { render, draftReference, hasUnsavedEdits: () => dirty || dialogue.hasUnsavedEdits() };
}
