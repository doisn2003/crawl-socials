import type { Account, Platform, PlatformRun, ProductionApi, ProductionState, UserConfig } from '../shared/production-api.js';
import { allocatePlatformTargets } from '../shared/platform-targets.js';
import { createCampaignPlanner } from './campaign-planner.js';
import { bindGeminiKeySettings } from './gemini-key-settings.js';
import { modelPauseMessage } from '../shared/model-status.js';
import { FILTER_DEFAULT_PERCENT, filterModeAtPercent } from '../shared/filter-policy.js';
import { planAndStart } from './start-workflow.js';

declare global { interface Window { readonly csd: ProductionApi; } }

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error('UI_ELEMENT_MISSING: ' + id);
  return node as T;
}
const platforms: Platform[] = ['facebook', 'threads'];
const platformNames: Record<Platform, string> = { facebook: 'Facebook', threads: 'Threads' };
const keywords = element<HTMLTextAreaElement>('keywords');
const performanceMode = element<HTMLSelectElement>('performance-mode');
const minimumPosts = element<HTMLInputElement>('minimum-posts');
const intentEnabled = element<HTMLInputElement>('opportunity-enabled');
const campaignPrompt = element<HTMLTextAreaElement>('campaign-prompt');
const brandContext = element<HTMLTextAreaElement>('brand-context');
const suitableTarget = element<HTMLInputElement>('suitable-target');
const filterMode = element<HTMLInputElement>('filter-mode');
const languageScope = element<HTMLSelectElement>('content-language');
const spendTotal = element<HTMLInputElement>('spend-total'), spendDaily = element<HTMLInputElement>('spend-daily');
const currentFilter = () => filterModeAtPercent(Number(filterMode.value));
const rawCap = element<HTMLInputElement>('raw-cap');
const modelBudget = element<HTMLInputElement>('model-budget');
const collectComments = element<HTMLInputElement>('collect-comments');
const intentInputs = [intentEnabled, campaignPrompt, brandContext, suitableTarget, filterMode, languageScope, rawCap, modelBudget, spendTotal, spendDaily, collectComments];
let resultGroup: 'SUITABLE' | 'NOT_SUITABLE' = 'SUITABLE';
const startButton = element<HTMLButtonElement>('start');
const stopButton = element<HTMLButtonElement>('stop');
const selectedProfiles = new Map<Platform, string>();
const selectedSources = new Set<Platform>();
const loginPending = new Set<Platform>();
let state: ProductionState | null = null;
let connected = false;
let initialized = false;
let configDirty = false;
let editRevision = 0;
let savedConfig = '';
let savePending = 0;
let saveQueue: Promise<boolean> = Promise.resolve(true);
let commandPending = false;
let exportPending = false;
let refreshPending = false;
let stateEpoch = 0;
let lastRunKey = '';
let startPhase: 'IDLE' | 'SAVING' | 'PLANNING' | 'STARTING' = 'IDLE';
let pendingStart: string | null = null;

const number = (value: number) => value.toLocaleString('vi-VN');
const key = (value: UserConfig) => JSON.stringify(value);
const active = () => state?.run?.state === 'RUNNING' || state?.run?.state === 'STOPPING'
  || state?.run?.opportunity?.watchActive === true || state?.run?.opportunity?.assessmentActive === true;
function setText(id: string, text: string) { element(id).textContent = text; }
function revealNotice(node: HTMLElement) {
  requestAnimationFrame(() => {
    if (node.hidden || !node.isConnected || !node.textContent?.trim()) return;
    node.tabIndex = -1; node.focus({ preventScroll: true });
    node.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
}
function setError(id: string, text: string) {
  const node = element(id), changed = node.textContent !== text || node.hidden;
  node.textContent = text; node.hidden = !text;
  if (text && changed) revealNotice(node);
}
function operation(message: string, failed = false) {
  const node = element('operation-status');
  const changed = node.textContent !== message || node.dataset.state !== (failed ? 'error' : 'success');
  node.textContent = message; node.dataset.state = failed ? 'error' : 'success';
  node.setAttribute('role', failed ? 'alert' : 'status'); node.setAttribute('aria-live', failed ? 'assertive' : 'polite');
  if (failed && message && changed) revealNotice(node);
}
function setSaveStatus(message: string, kind: string) {
  const node = element('save-status'); node.textContent = message; node.dataset.state = kind;
}
function readConfig(): UserConfig {
  return {
    filterPercent: Number(filterMode.value),
    spendLimits: { totalUsd: Number(spendTotal.value), dailyUsd: Number(spendDaily.value) },
    performance: 'BALANCED',
    keywords: [...new Set(keywords.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean))],
    minimumPosts: minimumPosts.value.trim() ? Number(minimumPosts.value) : NaN,
    ...(intentEnabled.checked || state?.config.schemaVersion === 2 ? {
      schemaVersion: 2 as const, opportunity: {
        enabled: true, filterMode: currentFilter(), prompt: campaignPrompt.value, brandContext: brandContext.value,
        languageScope: 'VIETNAMESE',
        totalTarget: Number(suitableTarget.value),
        rawCap: Number(rawCap.value), budgetUsd: currentFilter() === 'OFF' ? 0 : 3, commentsEnabled: collectComments.checked,
      }
    } : {})
  };
}
function validateConfig(value: UserConfig): string {
  if (value.keywords.length > 100) return 'Tối đa 100 từ khóa cho mỗi lượt thu thập.';
  if (value.keywords.some(word => word.length > 200)) return 'Mỗi từ khóa cần có tối đa 200 ký tự.';
  if (!Number.isSafeInteger(value.minimumPosts) || value.minimumPosts < 1 || value.minimumPosts > 3000)
    return 'Mục tiêu phải là số nguyên từ 1 đến 3.000 bài cho mỗi mạng.';
  if (value.opportunity) {
    const o = value.opportunity;
    if (o.enabled && o.filterMode !== 'OFF' && !o.prompt.trim()) return 'Hãy mô tả cuộc thảo luận bạn muốn tìm.';
    if (!Number.isSafeInteger(o.totalTarget) || o.totalTarget < 1 || o.totalTarget > 3000) return 'Số bài muốn nhận phải từ 1 đến 3.000.';
    if (!Number.isSafeInteger(o.rawCap) || o.rawCap < o.totalTarget || o.rawCap > 10000) return 'Số bài tìm tối đa cần ít nhất bằng số bài muốn nhận và không quá 10.000.';
    if (!Number.isFinite(o.budgetUsd) || (o.filterMode === 'OFF' ? o.budgetUsd !== 0 : o.budgetUsd <= 0) || o.budgetUsd > 30) return 'Ngân sách AI cần lớn hơn 0 và không quá 30 USD.';
  }
  return '';
}
function selectedAccount(platform: Platform): Account | undefined {
  return state?.accounts.find(account => account.platform === platform && account.id === selectedProfiles.get(platform));
}
function selectableProfiles() {
  return platforms.flatMap(platform => {
    const account = selectedAccount(platform);
    return selectedSources.has(platform) && account?.authenticated && !account.persistenceError ? [{ platform, profileId: account.id }] : [];
  });
}
function friendlyError(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/CAMPAIGN_INTENT_UNRESOLVED|DRAFT_REQUIRED/.test(text)) return 'Hãy làm rõ nhu cầu và xem kế hoạch trước khi thu thập.';
  if (/CAMPAIGN_ANSWER_INVALID/.test(text)) return 'Hãy trả lời các câu hỏi bắt buộc hoặc nhập nội dung sửa mục tiêu trước khi gửi.';
  if (/CAMPAIGN_SEMANTIC_VALIDATION_FAILED/.test(text)) return 'AI chưa tạo được bộ từ khóa hợp lệ sau một lượt sửa. Chọn Thử lại kế hoạch; câu trả lời và chi phí vẫn được giữ.';
  if (/RETAINED_OPPORTUNITY_JOURNAL_REQUIRED/.test(text))
    return 'Lượt dữ liệu này chưa có lịch sử hội thoại để lọc lại. Hãy chọn một lượt thu theo nhu cầu khác.';
  if (/RETAINED_.*(?:CHANGED|MISMATCH|TRUNCATED|CORRUPT)/.test(text))
    return 'Dữ liệu nguồn đã thay đổi hoặc không còn khớp mốc đã lưu. Lượt lọc lại đã dừng; hãy lập lượt mới để đọc lại nguồn.';
  if (/RETAINED_.*LIMIT/.test(text))
    return 'Dữ liệu vượt giới hạn đọc an toàn của lượt lọc lại. Các file nguồn vẫn được giữ nguyên.';
  if (/RETAINED_/.test(text))
    return 'Chưa lọc lại được dữ liệu đã chọn. Kiểm tra nguồn còn trên máy và kế hoạch mới đã được lưu.';
  if (/DRAFT_PLAN_COMMITTED/.test(text))
    return 'Yêu cầu này đã được dùng cho một lượt thu. Bạn có thể tiếp tục lượt đó, hoặc sửa yêu cầu và chọn Xem tiêu chí trước khi thu để bắt đầu lượt mới.';
  if (/DRAFT_PREPARATION_INTERRUPTED/.test(text))
    return 'Lần chuẩn bị trước bị gián đoạn. Chọn Thử lại kế hoạch; nội dung và chi phí đã được lưu.';
  if (/DRAFT_PREPARATION_INCOMPLETE/.test(text))
    return 'Kế hoạch chưa lập xong. Chọn Thử lại kế hoạch để tiếp tục với chi phí đã ghi nhận.';
  if (/DRAFT_CONFIG_MISMATCH|DRAFT_CONFIG_CHANGED/.test(text))
    return 'Nhu cầu hoặc giới hạn đã thay đổi. Xem lại kế hoạch trước khi bắt đầu.';
  if (/DRAFT_REVISION|DRAFT_STATE|DRAFT_NOT_AVAILABLE|DRAFT_ALREADY_STARTED/.test(text))
    return 'Kế hoạch đã thay đổi. Tải lại trạng thái và kiểm tra tiêu chí trước khi tiếp tục.';
  if (/DRAFT_UNSUPPORTED|PRESET_UNSUPPORTED|CLASSIFIER_POLICY_UNSUPPORTED|PLANNER_POLICY_UNSUPPORTED|PLANNER_RECIPE_MISMATCH/.test(text))
    return 'Bộ lọc này cần được nâng cấp. Hãy lập kế hoạch mới từ nhu cầu của bạn.';
  if (/CRITERIA|CAMPAIGN_PLAN_INVALID|CAMPAIGN_INVALID|PRESET_.*INVALID/.test(text))
    return 'Tiêu chí chưa hợp lệ. Kiểm tra chủ đề và từ khóa; mỗi giá trị danh sách nằm trên một dòng.';
  if (/MODEL_INVALID|MODEL_SCHEMA|COMPILE|CAMPAIGN_COMPILATION/.test(text))
    return 'AI chưa trả về kế hoạch hợp lệ. Bạn có thể thử lại; chi phí đã phát sinh vẫn được ghi nhận.';
  if (/AUTHENTICATION_REQUIRED|LOGIN_REQUIRED|NOT_AUTHENTICATED|PROFILE_NOT_AUTHENTICATED/.test(text))
    return 'Phiên đăng nhập chưa sẵn sàng hoặc đã hết hiệu lực. Hãy đăng nhập lại rồi chọn nguồn.';
  if (/SESSION_RECOVERY_REQUIRED|SESSION_SAVE_FAILED|PERSISTENCE/.test(text))
    return 'Không thể lưu hoặc khôi phục phiên tài khoản. Hãy đóng phiên rồi mở lại ứng dụng.';
  if (/RUN_ACTIVE|RUN_IN_PROGRESS|COLLECTOR_BUSY|COLLECTION_BUSY/.test(text))
    return 'Một lượt thu thập đang chạy. Hãy dừng lượt hiện tại trước.';
  if (/CONFIG_INVALID|INVALID_CONFIG|SETTINGS_INVALID/.test(text))
    return 'Cấu hình chưa hợp lệ. Kiểm tra từ khóa và mục tiêu tối thiểu.';
  if (/NO_RESULTS|RESULTS_UNAVAILABLE/.test(text))
    return 'Chưa có dữ liệu để xuất. Hãy đợi lượt thu thập kết thúc.';
  if (/XLSX_CELL_TEXT_TOO_LONG/.test(text))
    return 'Một bài viết vượt giới hạn ký tự của ô Excel. Chọn Lưu dữ liệu gốc để giữ nguyên toàn bộ nội dung.';
  if (/GEMINI_API_KEY_MISSING|MODEL_AUTHENTICATION|MODEL_PERMISSION/.test(text))
    return 'Chưa kết nối được dịch vụ phân tích. Kiểm tra thiết lập kết nối trên máy rồi mở lại CSD.';
  const modelPause = modelPauseMessage(text);
  if (modelPause) return modelPause;
  if (/MODEL_NOT_AUTHORIZED/.test(text))
    return 'Lượt cũ chưa dùng được với bộ lọc hiện tại. Hãy tạo yêu cầu mới để lọc lại bài đã lưu.';
  if (/MODEL_NOT_AVAILABLE/.test(text))
    return 'Dịch vụ phân tích chưa khả dụng với tài khoản của bạn. Bạn vẫn có thể dùng Không lọc; bài đã tìm được vẫn được lưu.';
  if (/MODEL_BUDGET/.test(text))
    return 'Đã chạm ngân sách AI của lượt này. Dữ liệu đã thu vẫn được giữ để xem và xuất.';
  if (/MODEL_BILLING|MODEL_DAILY_QUOTA|MODEL_HTTP_429/.test(text))
    return 'Dịch vụ AI đang hết số dư hoặc giới hạn lượt gọi. Dữ liệu được giữ; có thể tiếp tục khi dịch vụ sẵn sàng.';
  if (/CAMPAIGN_FILTER_UPGRADE_REQUIRED|FILTER_RECIPE_MISMATCH/.test(text))
    return 'Bộ lọc đã lưu không khớp phiên bản hiện tại. Dữ liệu vẫn được giữ; hãy tạo lượt mới để dùng bộ lọc hiện tại.';
  return fallback;
}

function updateControls() {
  geminiKeyUi.refresh();
  const running = active();
  const percent = Number(filterMode.value), mode = currentFilter();
  element('filter-slider').style.setProperty('--filter-progress', percent + '%');
  element('filter-slider').style.setProperty('--filter-lightness', (79 - percent * .35) + '%');
  setText('comments-mode-note', !collectComments.checked ? 'Chỉ thu thập bài viết.' : mode === 'OFF' ? 'Lưu cả bình luận, không dùng AI ở chế độ Không lọc.' : 'Thu thập và phân tích cả bài viết lẫn bình luận.');
  element('comments-warning').hidden = !collectComments.checked;
  setText('filter-percent', percent + '%'); filterMode.setAttribute('aria-valuetext', percent + '% · ' + ({ OFF: 'Không lọc', STANDARD: 'Tiêu chuẩn', QUALITY: 'Chất lượng' }[mode]));
  startButton.setAttribute('aria-busy', String(startPhase !== 'IDLE'));
  setText('start-label', { IDLE: pendingStart ? 'Chờ bạn làm rõ yêu cầu' : 'Bắt đầu thu thập', SAVING: 'Đang lưu yêu cầu…', PLANNING: 'Đang phân tích yêu cầu…', STARTING: 'Đang bắt đầu thu thập…' }[startPhase]);
  keywords.disabled = !connected || running || commandPending;
  performanceMode.disabled = minimumPosts.disabled = !connected || running || commandPending;
  for (const input of intentInputs) input.disabled = !connected || running || commandPending;
  element('opportunity-config').hidden = !intentEnabled.checked;
  element('legacy-config').hidden = currentFilter() !== 'OFF';
  const reuse = element<HTMLSelectElement>('off-saved-queries');
  const plans = savedQueryPlans();
  const plansKey = JSON.stringify(plans);
  if (reuse.dataset.plans !== plansKey) {
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Chọn kế hoạch hoặc lượt trước';
    reuse.replaceChildren(placeholder, ...plans.map(plan => { const option = document.createElement('option'); option.value = plan.id; option.textContent = plan.name; return option; }));
    reuse.dataset.plans = plansKey;
  }
  reuse.disabled = !connected || running || commandPending || !plans.length;
  minimumPosts.closest<HTMLElement>('.field')!.hidden = true;
  modelBudget.disabled ||= currentFilter() === 'OFF';
  setText('filter-mode-help', currentFilter() === 'OFF' ? 'Không lọc — lấy tất cả bài tìm được, không tốn tiền lọc.' : currentFilter() === 'STANDARD' ? 'Tiêu chuẩn — tìm rộng hơn, có thể giữ cả bài chưa thể hiện nhu cầu rõ ràng.' : 'Chất lượng — chọn kỹ hơn, số bài nhận được có thể ít hơn.');
  const money = state?.spending;
  setText('spend-status', money ? 'Đã dùng $' + money.measuredUsd.toFixed(4) + ' · Đang dự phòng/chưa rõ $' + money.heldUsd.toFixed(4) + ' · Còn $' + money.remainingUsd.toFixed(4) + ' · ' + money.calls + ' lượt gọi. Chi phí ước tính CSD, không phải hóa đơn Google.' : '');
  const config = readConfig();
  const selected = selectableProfiles();
  setText('keyword-count', config.keywords.length ? number(config.keywords.length) + ' từ khóa' : '');
  setText('selected-count', selected.length ? selected.length + ' / 2 nguồn được chọn' : 'Chưa chọn nguồn');
  startButton.disabled = !connected || running || commandPending || savePending > 0 || exportPending ||
    !(config.opportunity?.enabled && config.opportunity.filterMode !== 'OFF' ? config.opportunity.prompt.trim() : config.keywords.length) || !!validateConfig(config) || !selected.length || loginPending.size > 0
    || (intentEnabled.checked && planner.hasUnsavedEdits()) || (!!pendingStart && state?.campaignDialogue?.plan.state === 'NEEDS_CLARIFICATION');
  startButton.hidden = running;
  stopButton.hidden = !running;
  stopButton.disabled = !connected || commandPending || state?.run?.state === 'STOPPING';
  element<HTMLButtonElement>('resume').hidden = running || !state?.run?.opportunity || state.run.state === 'COMPLETED';
  element<HTMLButtonElement>('resume').disabled = !connected || running || commandPending;
  for (const platform of platforms) {
    const account = selectedAccount(platform);
    const checkbox = element<HTMLInputElement>('select-' + platform);
    checkbox.disabled = !connected || running || commandPending || loginPending.has(platform) || !account?.authenticated || !!account.persistenceError;
    checkbox.checked = selectedSources.has(platform);
    element<HTMLSelectElement>('profile-' + platform).disabled = !connected || running || commandPending || loginPending.has(platform);
    element<HTMLButtonElement>('login-' + platform).disabled = !connected || running || commandPending || loginPending.has(platform);
    const card = document.querySelector<HTMLElement>('[data-platform="' + platform + '"]');
    if (card) card.dataset.selected = String(selectedSources.has(platform));
  }
  const hasResults = !!state?.run && state.run.platforms.some(platform => platform.count > 0);
  const exportBlocked = (running && !state?.run?.opportunity) || state?.run?.opportunity?.phase === 'EVALUATION_REFRESH_REQUIRED';
  element<HTMLButtonElement>('export-json').disabled = !connected || exportBlocked || commandPending || exportPending || !hasResults;
  element<HTMLButtonElement>('export-xlsx').disabled = !connected || exportBlocked || commandPending || exportPending || !hasResults;
  element<HTMLSelectElement>('export-scope').disabled = !connected || exportBlocked || commandPending || exportPending || !hasResults;
  element<HTMLButtonElement>('open-output').disabled = !connected || !state?.run?.outputDirectory;
  if (!running && !state?.run && config.opportunity?.enabled) setText('start-help', 'Mục tiêu ' + number(config.opportunity.totalTarget) + ' bài tổng cộng từ các nguồn đã chọn; không chia tỷ lệ mạng.');
  else if (!running && !state?.run) setText('start-help', !config.keywords.length
    ? 'Thêm từ khóa và chọn ít nhất một nguồn đã đăng nhập.'
    : !selected.length ? 'Đăng nhập rồi tick chọn nguồn để bắt đầu thu thập.'
      : 'Sẵn sàng thu tối thiểu ' + number(config.minimumPosts) + ' bài cho mỗi mạng được chọn.');
  planner.render();
}

function savedQueryPlans() {
  const plans = (state?.campaignPresets ?? []).map(p => ({ id: p.presetId, name: p.name, queries: p.criteria.queries.map(q => q.text) }));
  if (state?.campaignDraft) plans.unshift({ id: 'current-draft', name: 'Kế hoạch đã lập', queries: state.campaignDraft.criteria.queries.map(q => q.text) });
  if (state?.run?.keywords.length) plans.push({ id: 'previous-run', name: 'Từ khóa của lượt trước', queries: state.run.keywords });
  return plans.filter(plan => plan.queries.length);
}

function renderAccounts() {
  for (const platform of platforms) {
    const accounts = state?.accounts.filter(account => account.platform === platform) || [];
    let selected = accounts.find(account => account.id === selectedProfiles.get(platform));
    if (!selected) {
      selected = accounts.find(account => account.authenticated && !account.persistenceError) || accounts[0];
      if (selected) selectedProfiles.set(platform, selected.id); else selectedProfiles.delete(platform);
    }
    if (!selected?.authenticated || selected.persistenceError) selectedSources.delete(platform);
    const selector = element<HTMLSelectElement>('profile-' + platform);
    const optionsKey = JSON.stringify(accounts.map(account => [account.id, account.label]));
    if (selector.dataset.options !== optionsKey) {
      selector.replaceChildren(...accounts.map(account => {
        const option = document.createElement('option'); option.value = account.id; option.textContent = account.label; return option;
      }));
      selector.dataset.options = optionsKey;
    }
    selector.value = selected?.id || '';
    element('profile-field-' + platform).hidden = accounts.length < 2;
    const status = element('status-' + platform);
    status.dataset.ready = String(!!selected?.authenticated && !selected.persistenceError);
    status.dataset.error = String(!!selected?.persistenceError);
    status.textContent = loginPending.has(platform) ? 'Đang mở tài khoản…' : selected?.persistenceError
      ? 'Chưa lưu được đăng nhập' : selected?.authenticated ? '● Đã đăng nhập' : 'Chưa đăng nhập';
    setText('account-detail-' + platform, selected?.persistenceError
      ? 'Tài khoản chưa sẵn sàng. Hãy đăng nhập lại.'
      : selected?.authenticated ? selected.label + ' · Có thể chọn để thu thập'
        : selected?.open ? 'Hoàn tất đăng nhập trong cửa sổ tài khoản.' : 'Đăng nhập để chọn mạng này.');
    const label = element<HTMLButtonElement>('login-' + platform).querySelector('span');
    if (label) label.textContent = loginPending.has(platform) ? 'Đang mở cửa sổ…'
      : selected?.authenticated ? 'Mở tài khoản ' + platformNames[platform] : 'Đăng nhập ' + platformNames[platform];
  }
}

const reasonLabels: Record<string, string> = {
  TARGET_REACHED: 'Đã đạt mục tiêu tối thiểu.',
  QUERY_BUDGET_COMPLETE: 'Đã hết phạm vi tìm kiếm hiện tại; nguồn có thể chưa đạt mục tiêu.',
  REPLAY_BUDGET_REACHED: 'Đã chạm giới hạn quay lại vị trí tìm kiếm trước. Các bài đã thu và phần việc còn lại được giữ.',
  QUERIES_COMPLETE: 'Đã duyệt hết từ khóa.',
  RAW_BUDGET_REACHED: 'Đã tìm đủ số bài tối đa bạn đặt.',
  STORAGE_RUN_BYTES_REACHED: 'Đã chạm giới hạn dung lượng của lượt thu. Dữ liệu đã lưu được giữ lại.',
  STORAGE_DISK_RESERVE_REACHED: 'Ổ đĩa không còn đủ dung lượng dự phòng. Giải phóng dung lượng rồi chọn Tiếp tục.',
  STORAGE_BACKLOG_BYTES_REACHED: 'Đang chờ bộ lọc xử lý dữ liệu đã lưu trước khi thu thêm.',
  STORAGE_MEASUREMENT_FAILED: 'Chưa kiểm tra được dung lượng lưu trữ. Kiểm tra thư mục dữ liệu và ổ đĩa trước khi tiếp tục.',
  STORAGE_SCAN_UNSTABLE: 'Thư mục dữ liệu đang thay đổi liên tục nên chưa đo được dung lượng. Lượt thu đã dừng, dữ liệu đã lưu được giữ lại.',
  STORAGE_SCAN_LIMIT: 'Thư mục lượt thu vượt giới hạn kiểm tra dung lượng. Cần kiểm tra thư mục trước khi tiếp tục.',
  STORAGE_BACKLOG_SNAPSHOT_MISSING: 'Một phần dữ liệu chờ lọc chưa đọc được. Lượt thu đã dừng để kiểm tra dữ liệu đã lưu.',
  INTENT_TARGET_REACHED: 'Đã đạt mục tiêu bài phù hợp.',
  MODEL_PAUSED: 'Bộ lọc đang tạm dừng; dữ liệu và hàng chờ được giữ lại.',
  EVALUATION_REFRESH_REQUIRED: 'Cần đánh giá lại theo bộ lọc hiện tại. Chọn Tiếp tục để xử lý các bài đã lưu.',
  RETAINED_INPUT_COMPLETE: 'Đã xử lý hết phần dữ liệu đã chọn; số bài phù hợp có thể chưa đạt mục tiêu.',
  RESULTS_STALE_EVALUATION_CONTEXT: 'Kết quả cần được cập nhật theo bộ lọc hiện tại.',
  SOURCE_EXHAUSTED: 'Nguồn tìm kiếm không còn bài mới.',
  NO_PROGRESS: 'Không tìm thêm được bài mới.',
  NO_NEW_BATCHES: 'Không tìm thêm được bài mới.',
  USER_STOP: 'Đã dừng theo yêu cầu.',
  WINDOW_CLOSED: 'Cửa sổ tài khoản đã đóng.',
  TARGET_CLOSED: 'Cửa sổ tài khoản đã đóng.',
  ACCOUNT_BARRIER: 'Tài khoản cần thao tác hoặc đăng nhập lại.',
  RUN_DEADLINE: 'Đã hết thời gian thu thập.',
  DEADLINE: 'Đã hết thời gian thu thập.',
  NAVIGATION_TIMEOUT: 'Trang mạng xã hội tải quá lâu.',
  AUTHENTICATION_REQUIRED: 'Cần đăng nhập lại tài khoản.',
  LOGIN_REQUIRED: 'Cần đăng nhập lại tài khoản.',
  APP_SHUTDOWN: 'Ứng dụng đã đóng trong khi thu thập.',
  APP_INTERRUPTED: 'Ứng dụng đã đóng trong khi thu thập; dữ liệu đã lưu được giữ lại.',
  SESSION_SAVE_FAILED: 'Không lưu được phiên tài khoản. Bài viết đã thu vẫn được giữ.',
  INTERRUPTED: 'Lượt thu trước bị gián đoạn.'
};
function reasonText(reason: string | null) {
  if (!reason) return '';
  return modelPauseMessage(reason) || reasonLabels[reason] || (reason.startsWith('STORAGE_') ? 'Không đọc hoặc lưu được dữ liệu. Kiểm tra dung lượng còn trống trên máy.' : 'Lượt này gặp lỗi. Bài đã tìm được vẫn được lưu; bạn có thể thử tiếp tục.');
}
const coverageLabels: Record<string, string> = {
  NOT_ATTEMPTED: 'Chưa có lượt kiểm tra bình luận', PARTIAL: 'Đã đọc một phần bình luận',
  EXHAUSTED_VISIBLE: 'Đã đọc hết phần bình luận hiển thị', OBSERVED_EMPTY: 'Chưa thấy bình luận trong lượt đọc',
  INACCESSIBLE: 'Chưa truy cập được bình luận', RETRYABLE_ERROR: 'Chờ đọc lại bình luận'
};
function createProgress(platform: PlatformRun, target: number, refined = false, global = false): HTMLElement {
  const card = document.createElement('div'); card.className = 'progress-card';
  const top = document.createElement('div'); top.className = 'progress-top';
  const logo = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  logo.classList.add('platform-logo');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#icon-' + platform.platform); logo.append(use);
  const name = document.createElement('span'); name.className = 'progress-name'; name.textContent = platformNames[platform.platform];
  const badge = document.createElement('span'); badge.className = 'progress-state';
  badge.textContent = { QUEUED: 'ĐANG CHỜ', RUNNING: state?.run?.mode === 'RETAINED' ? 'ĐANG LỌC LẠI' : 'ĐANG THU', COMPLETED: 'KẾT THÚC', STOPPED: 'ĐÃ DỪNG', FAILED: 'CÓ LỖI' }[platform.state];
  top.append(logo, name, badge);
  const count = document.createElement('p'); count.className = 'progress-count'; count.append(document.createTextNode(number(platform.count) + ' '));
  const denominator = document.createElement('small'); denominator.textContent = (global ? '' : '/ ' + number(target)) + (refined ? ' bài phù hợp' : ' bài đã tìm'); count.append(denominator);
  const bar = document.createElement('progress'); bar.className = 'progress-bar'; bar.max = Math.max(1, target); bar.value = platform.count; bar.hidden = global || target === 0;
  bar.setAttribute('aria-label', 'Tiến độ ' + platformNames[platform.platform]);
  card.append(top, count, bar);
  const reason = reasonText(platform.reason);
  if (reason) { const note = document.createElement('p'); note.className = 'progress-reason'; note.textContent = reason; card.append(note); }
  return card;
}
function renderRun() {
  const run = state?.run;
  if (!run) { setError('run-error', ''); return; }
  const failures = run.platforms.filter(platform => platform.state === 'FAILED').map(platform => platformNames[platform.platform] + ': ' + reasonText(platform.reason));
  const runError = run.opportunity?.lastError ? reasonText(run.opportunity.lastError)
    : failures.length ? failures.join(' · ') : run.state === 'FAILED' || run.state === 'INTERRUPTED'
      ? 'Lượt thu đã gặp lỗi hoặc bị gián đoạn. Dữ liệu đã lưu vẫn được giữ; bạn có thể tiếp tục lượt này.' : '';
  setError('run-error', runError);
  const badge = element('run-badge'); badge.dataset.state = run.state;
  badge.textContent = { RUNNING: run.mode === 'RETAINED' ? 'ĐANG LỌC LẠI' : 'ĐANG THU THẬP', STOPPING: 'ĐANG DỪNG', COMPLETED: 'ĐÃ KẾT THÚC', STOPPED: 'ĐÃ DỪNG', FAILED: 'CÓ LỖI', INTERRUPTED: 'BỊ GIÁN ĐOẠN' }[run.state];
  const total = run.platforms.reduce((sum, platform) => sum + platform.count, 0);
  const met = run.platforms.every(platform => platform.count >= run.minimumPosts);
  const runMessages = {
    RUNNING: 'Đang thu thập bài viết theo từ khóa. Mục tiêu ' + number(run.minimumPosts) + ' bài / mạng.',
    STOPPING: 'Đang dừng thu thập và lưu các bài đã thu được…',
    COMPLETED: met ? 'Đã đạt mục tiêu trên tất cả nguồn được chọn. Dữ liệu đã sẵn sàng để xuất.' : 'Lượt thu đã kết thúc; một số nguồn chưa đạt mục tiêu. Bạn vẫn có thể xuất các bài đã thu.',
    STOPPED: 'Đã dừng thu thập. Các bài đã lưu vẫn sẵn sàng để xuất.',
    FAILED: 'Lượt thu gặp lỗi. Xem trạng thái từng nguồn; các bài đã lưu vẫn được giữ.',
    INTERRUPTED: 'Lượt thu trước đã gián đoạn. Dữ liệu đã lưu vẫn được giữ; bạn có thể bắt đầu lượt mới.'
  };
  setText('start-help', runMessages[run.state]);
  const time = new Date(run.startedAt);
  setText('run-time', Number.isNaN(time.getTime()) ? '' : 'Bắt đầu ' + time.toLocaleString('vi-VN'));
  const progress = element('run-progress'); progress.hidden = false;
  const runKey = JSON.stringify([run.id, run.state, run.minimumPosts, run.platforms, run.preview,
  run.opportunity?.byPlatform, run.opportunity?.totalTarget, run.opportunity?.threadsShare]);
  if (runKey !== lastRunKey) {
    const targets = run.opportunity?.resultPolicy === 'GLOBAL_FIRST_QUALIFIED' ? { facebook: run.opportunity.totalTarget, threads: run.opportunity.totalTarget } : run.opportunity ? allocatePlatformTargets(run.opportunity.totalTarget,
      { threads: run.opportunity.threadsShare, facebook: 1 - run.opportunity.threadsShare }, run.platforms.map(item => item.platform)) : null;
    progress.replaceChildren(...run.platforms.map(platform => run.opportunity ? createProgress({ ...platform, count: run.opportunity.filterMode === 'OFF' ? run.opportunity.byPlatform[platform.platform].raw : run.opportunity.byPlatform[platform.platform].suitable },
      targets![platform.platform], run.opportunity.filterMode !== 'OFF', run.opportunity.resultPolicy === 'GLOBAL_FIRST_QUALIFIED') : createProgress(platform, run.minimumPosts)));
    setText('json-preview', run.preview.map(post => platformNames[post.platform] + '\n' + post.text).join('\n\n──────────\n\n'));
    lastRunKey = runKey;
  }
  setText('result-count', number(total) + ' BÀI');
  element('empty-result').hidden = run.preview.length > 0;
  element('preview-wrapper').hidden = !run.preview.length;
  setText('preview-note', 'Xem trước ' + number(run.preview.length) + ' bài · File xuất chứa toàn bộ dữ liệu đã lưu.');
  setText('output-name', run.outputDirectory); element('output-name').title = run.outputDirectory;
  renderOpportunities();
}
function renderOpportunities() {
  const opportunity = state?.run?.opportunity;
  element('opportunity-results').hidden = !opportunity;
  element('export-scope-field').hidden = !opportunity || opportunity.filterMode === 'OFF';
  const all = opportunity?.filterMode === 'OFF' || element<HTMLSelectElement>('export-scope').value === 'ALL';
  const groupNames = { SUITABLE: 'Phù hợp', NOT_SUITABLE: 'Không phù hợp' };
  setText('export-description', opportunity ? (all ? 'Tất cả bài đã thu, gồm cả bài đang chờ lọc.' : 'Nhóm ' + groupNames[resultGroup] + ' đang xem.')
    + ' Bản tải về có cả bình luận đã thu của những bài này.' : 'Tải bài viết từ Facebook và Threads về một file Excel.');
  if (!opportunity) return;
  element('preview-wrapper').hidden = true; element('empty-result').hidden = true;
  const counts = opportunity.counts;
  setText('result-count', number(opportunity.targetCount ?? counts.suitable) + ' / ' + number(opportunity.totalTarget) + (opportunity.filterMode === 'OFF' ? ' BÀI CHƯA ĐÁNH GIÁ' : ' BÀI ĐƯỢC NHẬN'));
  setText('opportunity-summary', number(counts.raw) + ' bài đã tìm · ' + number(counts.comments) + ' bình luận · ' + number(counts.pending) + (opportunity.filterMode === 'OFF' ? ' bài chưa đánh giá' : ' bài chưa kiểm tra') + ' · Chi phí $' + opportunity.costUsd.toFixed(4) + (opportunity.usageUnknown ? '–$' + opportunity.costUpperUsd.toFixed(4) : '') + ' / $' + opportunity.budgetUsd.toFixed(2)
    + (opportunity.resultPolicy === 'GLOBAL_FIRST_QUALIFIED' || opportunity.evaluationPolicy === 'GOAL_EVIDENCE' ? '' : ' · Kết quả cũ: cần lọc lại để áp dụng cách đánh giá mới.'));
  if (opportunity.shortfallWarning) element('opportunity-summary').textContent += ' · Có thể chưa tìm đủ số bài phù hợp bạn muốn nhận.';
  if (opportunity.extraCount) element('opportunity-summary').textContent += ' · ' + number(opportunity.extraCount) + ' bài bổ sung ngoài chỉ tiêu (được giữ trong bản xuất)';
  if (opportunity.phase === 'MODEL_PAUSED') element('opportunity-summary').append(document.createTextNode(' · Đã tạm dừng lọc. ' + reasonText(opportunity.lastError)));
  const retained = state?.run?.mode === 'RETAINED' ? state.run.retained : undefined;
  const importProgress = retained && retained.status !== 'IMPORTED'
    ? 'Đã đọc ' + number(retained.importedObservations) + '/' + number(retained.totalObservations) + ' nội dung. ' : '';
  const action = active() ? retained ? (retained.status === 'IMPORTED' ? 'Đang lọc lại · ' : 'Đang đọc bài đã lưu · ') : 'Đang thu và lọc · ' : '';
  const completedInput = retained?.status === 'IMPORTED' && state?.run?.platforms.some(platform => platform.reason === 'RETAINED_INPUT_COMPLETE')
    ? ' ' + reasonLabels.RETAINED_INPUT_COMPLETE : '';
  const asOf = retained?.assessmentAsOf ? ' Đánh giá theo dữ liệu tại ' + new Date(retained.assessmentAsOf).toLocaleString('vi-VN')
    + '; kết quả đã hết hạn không được tính là phù hợp hiện tại.' : '';
  setText('start-help', opportunity.phase === 'EVALUATION_REFRESH_REQUIRED' ? reasonLabels.EVALUATION_REFRESH_REQUIRED! : action + importProgress
    + number(opportunity.targetCount ?? counts.suitable) + '/' + number(opportunity.totalTarget) + (opportunity.filterMode === 'OFF' ? ' bài chưa đánh giá. Threads ' : ' bài được nhận. Threads ')
    + number(opportunity.filterMode === 'OFF' ? opportunity.byPlatform.threads.raw : opportunity.byPlatform.threads.suitable)
    + ' · Facebook ' + number(opportunity.filterMode === 'OFF' ? opportunity.byPlatform.facebook.raw : opportunity.byPlatform.facebook.suitable)
    + (opportunity.lastError ? ' · ' + reasonText(opportunity.lastError) : '') + completedInput + asOf);
  if (opportunity.watchActive || opportunity.assessmentActive) {
    const monitoring: string[] = [];
    if (opportunity.watchActive) monitoring.push(number(opportunity.watchPending ?? 0) + ' lượt kiểm tra bình luận'
      + (opportunity.watchNextAt ? ' (kế tiếp ' + new Date(opportunity.watchNextAt).toLocaleString('vi-VN') + ')' : ''));
    if (opportunity.assessmentActive) monitoring.push('thời hạn phù hợp của các cuộc thảo luận'
      + (opportunity.assessmentNextAt ? ' (kế tiếp ' + new Date(opportunity.assessmentNextAt).toLocaleString('vi-VN') + ')' : ''));
    setText('start-help', 'Đang theo dõi ' + monitoring.join(' và ') + '. Dừng để kết thúc theo dõi.');
  }
  const labels = { SUITABLE: 'Phù hợp', NOT_SUITABLE: 'Không phù hợp' };
  const totals = { SUITABLE: counts.suitable, NOT_SUITABLE: counts.notSuitable ?? counts.notYet + counts.unrelated };
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-result-group]')) {
    button.hidden = opportunity.filterMode === 'OFF';
    const group = button.dataset.resultGroup as keyof typeof labels;
    button.textContent = labels[group] + ' · ' + number(totals[group]); button.setAttribute('aria-pressed', String(resultGroup === group));
  }
  const cards = opportunity.preview.filter(result => opportunity.filterMode === 'OFF' ? result.classification === 'UNASSESSED'
    : result.classification !== 'UNASSESSED' && (result.classification === 'SUITABLE' ? 'SUITABLE' : 'NOT_SUITABLE') === resultGroup).slice(0, 20).map(result => {
    const card = document.createElement('article'); card.className = 'opportunity-card';
    const meta = document.createElement('small'); meta.textContent = [platformNames[result.platform], result.reason, coverageLabels[result.coverage]].filter(Boolean).join(' · ');
    const text = document.createElement('p'); text.textContent = result.text;
    card.append(meta, text);
    if (result.conditions?.length) {
      const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Vì sao có kết quả này?'; details.append(summary);
      const statusNames = { PASS: 'Đạt', FAIL: 'Không đạt', UNKNOWN: 'Chưa rõ' };
      for (const condition of result.conditions) { const line = document.createElement('p'); line.textContent = statusNames[condition.status] + ' · ' + condition.label; details.append(line);
        for (const evidence of condition.evidence) { const quote = document.createElement('blockquote'); quote.textContent = evidence; details.append(quote); }
      }
      card.append(details);
    } else for (const evidence of result.evidence) { const quote = document.createElement('blockquote'); quote.textContent = evidence; card.append(quote); }
    if (result.link) { const open = document.createElement('button'); open.type = 'button'; open.textContent = 'Mở bài viết ↗'; open.addEventListener('click', () => { void window.csd.openPost({ url: result.link }).catch(() => operation('Không mở được liên kết của bài viết.', true)); }); card.append(open); }
    return card;
  });
  if (!cards.length) { const empty = document.createElement('p'); empty.className = 'helper'; empty.textContent = 'Chưa có kết quả trong nhóm này.'; element('opportunity-cards').replaceChildren(empty); }
  else element('opportunity-cards').replaceChildren(...cards);
}
function applyState(next: ProductionState, replaceConfig = false) {
  state = next; connected = true; element('connection-error').hidden = true;
  setText('version', 'v' + next.version);
  if (!initialized || replaceConfig) {
    performanceMode.value = 'BALANCED';
    keywords.value = next.config.keywords.join('\n'); minimumPosts.value = String(next.config.minimumPosts);
    const o = next.config.opportunity;
    intentEnabled.checked = !!o?.enabled; campaignPrompt.value = o?.prompt || ''; brandContext.value = o?.brandContext || '';
    suitableTarget.value = String(o?.totalTarget || 1000);
    const mode = o?.filterMode ?? 'OFF', savedPercent = next.config.filterPercent;
    filterMode.value = String(savedPercent !== undefined && filterModeAtPercent(savedPercent) === mode ? savedPercent : FILTER_DEFAULT_PERCENT[mode]);
    languageScope.value = 'VIETNAMESE';
    intentEnabled.checked = true; spendTotal.value = String(next.config.spendLimits?.totalUsd ?? 3); spendDaily.value = String(next.config.spendLimits?.dailyUsd ?? 3);
    rawCap.value = String(o?.rawCap || 3000); modelBudget.value = '3';
    collectComments.checked = o?.commentsEnabled ?? true;
    savedConfig = key(next.config); initialized = true; configDirty = false; setSaveStatus('Đã lưu trên máy', 'saved');
    if (active() && next.run) for (const platform of next.run.platforms) {
      if (platform.profileId) { selectedProfiles.set(platform.platform, platform.profileId); selectedSources.add(platform.platform); }
    }
  }
  renderAccounts(); renderRun(); updateControls();
  if (next.campaignDraftError && !commandPending) operation(friendlyError(next.campaignDraftError.code, 'Chưa lập được kế hoạch. Hãy thử lại.'), true);
}
async function refresh() {
  if (refreshPending || commandPending) return;
  refreshPending = true;
  const epoch = ++stateEpoch;
  try { const next = await window.csd.getState(); if (epoch === stateEpoch) applyState(next); }
  catch {
    if (epoch === stateEpoch) { connected = false; const notice = element('connection-error'), wasHidden = notice.hidden; notice.hidden = false; if (wasHidden) revealNotice(notice); updateControls(); }
  } finally { refreshPending = false; }
}

function saveConfiguration(): Promise<boolean> {
  savePending++; updateControls();
  const work = saveQueue.then(async () => {
    if (!initialized) return false;
    const snapshot = readConfig(), error = validateConfig(snapshot);
    if (error) { setError('config-error', error); setSaveStatus('Chưa lưu', 'error'); return false; }
    if (key(snapshot) === savedConfig) {
      configDirty = false; setError('config-error', ''); setSaveStatus('Đã lưu trên máy', 'saved'); return true;
    }
    const revision = editRevision; setSaveStatus('Đang lưu…', 'saving'); setError('config-error', '');
    try {
      const saved = await window.csd.saveConfig(snapshot); savedConfig = key(saved);
      if (state) state.config = saved;
      if (revision === editRevision) {
        keywords.value = saved.keywords.join('\n'); minimumPosts.value = String(saved.minimumPosts);
        configDirty = false; setSaveStatus('Đã lưu trên máy', 'saved');
      } else { configDirty = true; setSaveStatus('Chưa lưu thay đổi mới', 'dirty'); }
      return true;
    } catch (error) {
      configDirty = true; setSaveStatus('Lưu chưa thành công', 'error');
      setError('config-error', friendlyError(error, 'Không thể lưu cấu hình. Nội dung vẫn ở đây; hãy rời ô nhập lần nữa để lưu lại.'));
      return false;
    }
  });
  const result = work.finally(() => { savePending--; updateControls(); });
  saveQueue = result.catch(() => false);
  return result;
}
function configChanged() {
  if (pendingStart) { pendingStart = null; operation(''); }
  editRevision++; configDirty = true; setSaveStatus('Rời ô để lưu', 'dirty');
  setError('config-error', ''); updateControls();
}
const geminiKeyUi = bindGeminiKeySettings(window.csd.geminiKey, () => commandPending || active() || !!state?.campaignDraftPreparing);
function startSignature() { return JSON.stringify([readConfig(), selectableProfiles()]); }
async function collectFromCurrentPlan() {
  const config = readConfig(), selected = selectableProfiles();
  if (!(config.opportunity?.enabled && config.opportunity.filterMode !== 'OFF' ? config.opportunity.prompt.trim() : config.keywords.length) || !selected.length) throw Error('START_INPUT_REQUIRED');
  const result = await planAndStart({ api: window.csd, profiles: selected,
    useAi: !!config.opportunity?.enabled && config.opportunity.filterMode !== 'OFF',
    draftReference: () => planner.draftReference(), prepared: next => { stateEpoch++; applyState(next, true); },
    phase: phase => { startPhase = phase; updateControls(); },
  });
  if (result.kind === 'CLARIFICATION') {
    pendingStart = startSignature(); operation('Cần làm rõ yêu cầu. Gửi câu trả lời bên dưới để CSD tự tiếp tục thu thập.');
    revealNotice(element('campaign-dialogue'));
  } else { pendingStart = null; stateEpoch++; applyState(result.state); }
}
const planner = createCampaignPlanner({
  api: window.csd, state: () => state, config: readConfig,
  busy: () => !connected || active() || commandPending || savePending > 0 || loginPending.size > 0,
  changed: updateControls,
  reportError: message => operation(message, true),
  execute: async (action, message) => {
    if (commandPending || active() || !connected) return;
    commandPending = true; stateEpoch++; operation(''); if (pendingStart) startPhase = 'PLANNING'; updateControls();
    try {
      if (!await saveConfiguration()) return;
      const next = await action(); applyState(next, true);
      if (next.campaignDraftError) { pendingStart = null; operation(friendlyError(next.campaignDraftError.code, 'Chưa lập được kế hoạch. Hãy thử lại; chi phí đã ghi nhận vẫn được giữ.'), true); }
      else if (pendingStart && next.campaignDraft && planner.draftReference()) {
        if (pendingStart === startSignature()) await collectFromCurrentPlan();
        else { pendingStart = null; operation('Yêu cầu hoặc nguồn đã thay đổi. Bấm Bắt đầu thu thập để dùng lựa chọn hiện tại.'); }
      } else operation(message);
    } catch (error) {
      pendingStart = null;
      operation(friendlyError(error, 'Chưa lưu được kế hoạch. Nội dung đang sửa vẫn được giữ; hãy kiểm tra và thử lại.'), true);
      try { applyState(await window.csd.getState()); } catch { /* Keep edits and the original operation error. */ }
    } finally { startPhase = 'IDLE'; commandPending = false; updateControls(); }
  },
});
for (const input of [keywords, minimumPosts, performanceMode, ...intentInputs]) {
  input.addEventListener('input', configChanged);
  input.addEventListener('blur', () => { if (configDirty) void saveConfiguration(); });
}
collectComments.addEventListener('change', () => { if (configDirty) void saveConfiguration(); });
element<HTMLSelectElement>('off-saved-queries').addEventListener('change', event => {
  const select = event.target as HTMLSelectElement, plan = savedQueryPlans().find(p => p.id === select.value);
  if (plan) { keywords.value = [...new Set(plan.queries)].join('\n'); configChanged(); void saveConfiguration(); }
  select.value = '';
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-result-group]')) button.addEventListener('click', () => {
  resultGroup = button.dataset.resultGroup as typeof resultGroup; renderOpportunities();
});
for (const platform of platforms) {
  element<HTMLInputElement>('select-' + platform).addEventListener('change', event => {
    pendingStart = null;
    const checked = (event.target as HTMLInputElement).checked;
    if (checked && selectedAccount(platform)?.authenticated) selectedSources.add(platform); else selectedSources.delete(platform);
    updateControls();
  });
  element<HTMLSelectElement>('profile-' + platform).addEventListener('change', event => {
    pendingStart = null;
    selectedProfiles.set(platform, (event.target as HTMLSelectElement).value); selectedSources.delete(platform);
    renderAccounts(); updateControls();
  });
  element<HTMLButtonElement>('login-' + platform).addEventListener('click', () => {
    void (async () => {
      if (loginPending.has(platform) || active()) return;
      loginPending.add(platform); setError('account-error', ''); renderAccounts(); updateControls();
      try {
        const id = selectedProfiles.get(platform);
        await window.csd.login({ platform, ...(id ? { profileId: id } : {}) });
        await refresh();
      } catch (error) { setError('account-error', friendlyError(error, 'Chưa mở được cửa sổ đăng nhập. Hãy thử lại.')); }
      finally { loginPending.delete(platform); renderAccounts(); updateControls(); }
    })();
  });
}
// Keep focus until click so saving on blur cannot swallow the user's Start click.
startButton.addEventListener('mousedown', event => {
  if (event.button === 0 && [keywords, minimumPosts, performanceMode, ...intentInputs].some(input => document.activeElement === input)) event.preventDefault();
});
startButton.addEventListener('click', () => {
  void (async () => {
    if (commandPending || active()) return;
    if (intentEnabled.checked && planner.hasUnsavedEdits()) { operation('Lưu hoặc hoàn tác thay đổi tiêu chí trước khi bắt đầu.', true); return; }
    commandPending = true; pendingStart = null; startPhase = 'SAVING'; operation(''); updateControls();
    try {
      if (!await saveConfiguration()) return;
      await collectFromCurrentPlan();
    } catch (error) { pendingStart = null; operation(friendlyError(error, 'Chưa bắt đầu được lượt thu thập. Hãy kiểm tra tài khoản và thử lại.'), true); }
    finally { startPhase = 'IDLE'; commandPending = false; updateControls(); }
  })();
});
element('prepare-campaign').addEventListener('click', () => { pendingStart = null; });
stopButton.addEventListener('click', () => {
  void (async () => {
    if (commandPending) return;
    commandPending = true; updateControls();
    try { stateEpoch++; applyState(await window.csd.stop()); operation('Yêu cầu dừng đã được gửi. Đang lưu dữ liệu còn lại.'); }
    catch (error) { operation(friendlyError(error, 'Chưa gửi được yêu cầu dừng. Hãy thử lại.'), true); }
    finally { commandPending = false; updateControls(); }
  })();
});
element<HTMLButtonElement>('resume').addEventListener('click', () => {
  void (async () => {
    if (commandPending || active()) return;
    commandPending = true; updateControls();
    try { stateEpoch++; applyState(await window.csd.resume()); operation('Đã tiếp tục từ dữ liệu và công việc đã lưu.'); }
    catch (error) { operation(friendlyError(error, 'Chưa tiếp tục được lượt thu. Dữ liệu đã lưu vẫn được giữ.'), true); }
    finally { commandPending = false; updateControls(); }
  })();
});
for (const format of ['json', 'xlsx'] as const) {
  element<HTMLButtonElement>('export-' + format).addEventListener('click', () => {
    void (async () => {
      if (exportPending || (active() && !state?.run?.opportunity)) return;
      exportPending = true; operation('Đang chuẩn bị file ' + (format === 'xlsx' ? 'Excel…' : 'dữ liệu…')); updateControls();
      try {
        const result = await window.csd.exportResults({ format, ...(state?.run?.opportunity && state.run.opportunity.filterMode !== 'OFF' && element<HTMLSelectElement>('export-scope').value !== 'ALL' ? { group: resultGroup } : {}) });
        operation(result.canceled ? 'Đã hủy xuất file.' : 'Đã lưu file: ' + (result.path || ''));
      } catch (error) { operation(friendlyError(error, 'Không thể xuất file. Dữ liệu gốc vẫn được giữ; hãy thử lại.'), true); }
      finally { exportPending = false; updateControls(); }
    })();
  });
}
element<HTMLSelectElement>('export-scope').addEventListener('change', renderOpportunities);
element<HTMLButtonElement>('open-output').addEventListener('click', () => {
  void window.csd.openOutput().catch(error => operation(friendlyError(error, 'Không mở được thư mục kết quả.'), true));
});
element<HTMLButtonElement>('reload-state').addEventListener('click', () => { void refresh(); });
window.addEventListener('focus', () => { void refresh(); });
void refresh();
window.setInterval(() => { void refresh(); }, 2000);
