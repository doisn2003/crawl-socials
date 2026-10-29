import type { Account, Platform, PlatformRun, ProductionApi, ProductionState, UserConfig } from '../shared/production-api.js';

declare global { interface Window { readonly csd: ProductionApi; } }

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error('UI_ELEMENT_MISSING: ' + id);
  return node as T;
}
const platforms: Platform[] = ['facebook', 'threads'];
const platformNames: Record<Platform, string> = { facebook: 'Facebook', threads: 'Thread' };
const keywords = element<HTMLTextAreaElement>('keywords');
const minimumPosts = element<HTMLInputElement>('minimum-posts');
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

const number = (value: number) => value.toLocaleString('vi-VN');
const key = (value: UserConfig) => JSON.stringify(value);
const active = () => state?.run?.state === 'RUNNING' || state?.run?.state === 'STOPPING';
function setText(id: string, text: string) { element(id).textContent = text; }
function setError(id: string, text: string) {
  const node = element(id); node.textContent = text; node.hidden = !text;
}
function operation(message: string, failed = false) {
  const node = element('operation-status');
  node.textContent = message; node.dataset.state = failed ? 'error' : 'success';
}
function setSaveStatus(message: string, kind: string) {
  const node = element('save-status'); node.textContent = message; node.dataset.state = kind;
}
function readConfig(): UserConfig {
  return { keywords: [...new Set(keywords.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean))],
    minimumPosts: minimumPosts.value.trim() ? Number(minimumPosts.value) : NaN };
}
function validateConfig(value: UserConfig): string {
  if (value.keywords.length > 100) return 'Tối đa 100 từ khóa cho mỗi lượt thu thập.';
  if (value.keywords.some(word => word.length > 200)) return 'Mỗi từ khóa cần có tối đa 200 ký tự.';
  if (!Number.isSafeInteger(value.minimumPosts) || value.minimumPosts < 1 || value.minimumPosts > 3000)
    return 'Mục tiêu phải là số nguyên từ 1 đến 3.000 bài cho mỗi mạng.';
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
    return 'Một bài viết vượt giới hạn ký tự của ô Excel. Hãy xuất JSON để giữ nguyên toàn bộ nội dung.';
  return fallback;
}

function updateControls() {
  const running = active();
  keywords.disabled = !connected || running || commandPending;
  minimumPosts.disabled = !connected || running || commandPending;
  const config = readConfig();
  const selected = selectableProfiles();
  setText('keyword-count', config.keywords.length ? number(config.keywords.length) + ' từ khóa' : '');
  setText('selected-count', selected.length ? selected.length + ' / 2 nguồn được chọn' : 'Chưa chọn nguồn');
  startButton.disabled = !connected || running || commandPending || savePending > 0 || exportPending ||
    !config.keywords.length || !!validateConfig(config) || !selected.length || loginPending.size > 0;
  startButton.hidden = running;
  stopButton.hidden = !running;
  stopButton.disabled = !connected || commandPending || state?.run?.state === 'STOPPING';
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
  element<HTMLButtonElement>('export-json').disabled = !connected || running || commandPending || exportPending || !hasResults;
  element<HTMLButtonElement>('export-xlsx').disabled = !connected || running || commandPending || exportPending || !hasResults;
  element<HTMLButtonElement>('open-output').disabled = !connected || !state?.run?.outputDirectory;
  if (!running && !state?.run) setText('start-help', !config.keywords.length
    ? 'Thêm từ khóa và chọn ít nhất một nguồn đã đăng nhập.'
    : !selected.length ? 'Đăng nhập rồi tick chọn nguồn để bắt đầu thu thập.'
      : 'Sẵn sàng thu tối thiểu ' + number(config.minimumPosts) + ' bài cho mỗi mạng được chọn.');
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
    status.textContent = loginPending.has(platform) ? 'Đang mở phiên…' : selected?.persistenceError
      ? 'Lỗi lưu phiên' : selected?.authenticated ? '● Đã đăng nhập' : 'Chưa đăng nhập';
    setText('account-detail-' + platform, selected?.persistenceError
      ? 'Phiên chưa thể sử dụng. Cần khôi phục phiên tài khoản.'
      : selected?.authenticated ? selected.label + ' · Có thể chọn để thu thập'
        : selected?.open ? 'Hoàn tất đăng nhập trong cửa sổ tài khoản.' : 'Đăng nhập để mở quyền chọn nguồn.');
    const label = element<HTMLButtonElement>('login-' + platform).querySelector('span');
    if (label) label.textContent = loginPending.has(platform) ? 'Đang mở cửa sổ…'
      : selected?.authenticated ? 'Mở phiên ' + platformNames[platform] : 'Đăng nhập ' + platformNames[platform];
  }
}

const reasonLabels: Record<string, string> = {
  TARGET_REACHED: 'Đã đạt mục tiêu tối thiểu.',
  QUERY_BUDGET_COMPLETE: 'Đã hết phạm vi tìm kiếm hiện tại; nguồn có thể chưa đạt mục tiêu.',
  QUERIES_COMPLETE: 'Đã duyệt hết từ khóa.',
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
  return reasonLabels[reason] || 'Mã trạng thái: ' + reason;
}
function createProgress(platform: PlatformRun, target: number): HTMLElement {
  const card = document.createElement('div'); card.className = 'progress-card';
  const top = document.createElement('div'); top.className = 'progress-top';
  const logo = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  logo.classList.add('platform-logo');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#icon-' + platform.platform); logo.append(use);
  const name = document.createElement('span'); name.className = 'progress-name'; name.textContent = platformNames[platform.platform];
  const badge = document.createElement('span'); badge.className = 'progress-state';
  badge.textContent = { QUEUED: 'ĐANG CHỜ', RUNNING: 'ĐANG THU', COMPLETED: 'KẾT THÚC', STOPPED: 'ĐÃ DỪNG', FAILED: 'CÓ LỖI' }[platform.state];
  top.append(logo, name, badge);
  const count = document.createElement('p'); count.className = 'progress-count'; count.append(document.createTextNode(number(platform.count) + ' '));
  const denominator = document.createElement('small'); denominator.textContent = '/ ' + number(target) + ' bài'; count.append(denominator);
  const bar = document.createElement('progress'); bar.className = 'progress-bar'; bar.max = target; bar.value = platform.count;
  bar.setAttribute('aria-label', 'Tiến độ ' + platformNames[platform.platform]);
  card.append(top, count, bar);
  const reason = reasonText(platform.reason);
  if (reason) { const note = document.createElement('p'); note.className = 'progress-reason'; note.textContent = reason; card.append(note); }
  return card;
}
function renderRun() {
  const run = state?.run;
  if (!run) return;
  const badge = element('run-badge'); badge.dataset.state = run.state;
  badge.textContent = { RUNNING: 'ĐANG THU THẬP', STOPPING: 'ĐANG DỪNG', COMPLETED: 'ĐÃ KẾT THÚC', STOPPED: 'ĐÃ DỪNG', FAILED: 'CÓ LỖI', INTERRUPTED: 'BỊ GIÁN ĐOẠN' }[run.state];
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
  const runKey = JSON.stringify([run.id, run.state, run.minimumPosts, run.platforms, run.preview]);
  if (runKey !== lastRunKey) {
    progress.replaceChildren(...run.platforms.map(platform => createProgress(platform, run.minimumPosts)));
    setText('json-preview', JSON.stringify(run.preview, null, 2));
    lastRunKey = runKey;
  }
  setText('result-count', number(total) + ' BÀI');
  element('empty-result').hidden = run.preview.length > 0;
  element('preview-wrapper').hidden = !run.preview.length;
  setText('preview-note', 'Xem trước ' + number(run.preview.length) + ' bài · File xuất chứa toàn bộ dữ liệu đã lưu.');
  setText('output-name', run.outputDirectory); element('output-name').title = run.outputDirectory;
}
function applyState(next: ProductionState) {
  state = next; connected = true; element('connection-error').hidden = true;
  setText('version', 'v' + next.version);
  if (!initialized) {
    keywords.value = next.config.keywords.join('\n'); minimumPosts.value = String(next.config.minimumPosts);
    savedConfig = key(next.config); initialized = true; setSaveStatus('Đã lưu trên máy', 'saved');
    if (active() && next.run) for (const platform of next.run.platforms) {
      selectedProfiles.set(platform.platform, platform.profileId); selectedSources.add(platform.platform);
    }
  }
  renderAccounts(); renderRun(); updateControls();
}
async function refresh() {
  if (refreshPending || commandPending) return;
  refreshPending = true;
  const epoch = ++stateEpoch;
  try { const next = await window.csd.getState(); if (epoch === stateEpoch) applyState(next); }
  catch {
    if (epoch === stateEpoch) { connected = false; element('connection-error').hidden = false; updateControls(); }
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
  editRevision++; configDirty = true; setSaveStatus('Rời ô để lưu', 'dirty');
  setError('config-error', ''); updateControls();
}
for (const input of [keywords, minimumPosts]) {
  input.addEventListener('input', configChanged);
  input.addEventListener('blur', () => { if (configDirty) void saveConfiguration(); });
}
for (const platform of platforms) {
  element<HTMLInputElement>('select-' + platform).addEventListener('change', event => {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked && selectedAccount(platform)?.authenticated) selectedSources.add(platform); else selectedSources.delete(platform);
    updateControls();
  });
  element<HTMLSelectElement>('profile-' + platform).addEventListener('change', event => {
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
  if (event.button === 0 && (document.activeElement === keywords || document.activeElement === minimumPosts)) event.preventDefault();
});
startButton.addEventListener('click', () => {
  void (async () => {
    if (commandPending || active()) return;
    commandPending = true; operation(''); updateControls();
    try {
      if (!await saveConfiguration()) return;
      const config = readConfig(), selected = selectableProfiles();
      if (!config.keywords.length || !selected.length) { operation('Nhập từ khóa và chọn ít nhất một nguồn đã đăng nhập.', true); return; }
      stateEpoch++; const next = await window.csd.start({ profiles: selected }); applyState(next);
    } catch (error) { operation(friendlyError(error, 'Chưa bắt đầu được lượt thu thập. Hãy kiểm tra tài khoản và thử lại.'), true); }
    finally { commandPending = false; updateControls(); }
  })();
});
stopButton.addEventListener('click', () => {
  void (async () => {
    if (commandPending) return;
    commandPending = true; updateControls();
    try { stateEpoch++; applyState(await window.csd.stop()); operation('Yêu cầu dừng đã được gửi. Đang lưu dữ liệu còn lại.'); }
    catch (error) { operation(friendlyError(error, 'Chưa gửi được yêu cầu dừng. Hãy thử lại.'), true); }
    finally { commandPending = false; updateControls(); }
  })();
});
for (const format of ['json', 'xlsx'] as const) {
  element<HTMLButtonElement>('export-' + format).addEventListener('click', () => {
    void (async () => {
      if (exportPending || active()) return;
      exportPending = true; operation('Đang chuẩn bị file ' + (format === 'xlsx' ? 'Excel…' : 'JSON…')); updateControls();
      try {
        const result = await window.csd.exportResults({ format });
        operation(result.canceled ? 'Đã hủy xuất file.' : 'Đã lưu file: ' + (result.path || ''));
      } catch (error) { operation(friendlyError(error, 'Không thể xuất file. Dữ liệu gốc vẫn được giữ; hãy thử lại.'), true); }
      finally { exportPending = false; updateControls(); }
    })();
  });
}
element<HTMLButtonElement>('open-output').addEventListener('click', () => {
  void window.csd.openOutput().catch(error => operation(friendlyError(error, 'Không mở được thư mục kết quả.'), true));
});
element<HTMLButtonElement>('reload-state').addEventListener('click', () => { void refresh(); });
window.addEventListener('focus', () => { void refresh(); });
void refresh();
window.setInterval(() => { void refresh(); }, 2000);

const coolerToggle = element<HTMLInputElement>('make-it-cooler');
void window.csd.cooler.get().then(enabled => { coolerToggle.checked = enabled; coolerToggle.disabled = false; }).catch(() => operation('Chưa tải được tùy chọn Make it cooler. Hãy mở lại ứng dụng.', true));
coolerToggle.addEventListener('change', () => {
  const desired = coolerToggle.checked; coolerToggle.disabled = true;
  void window.csd.cooler.set({ enabled: desired }).then(enabled => { coolerToggle.checked = enabled; }).catch(() => {
    coolerToggle.checked = !desired; operation('Chưa lưu được tùy chọn Make it cooler. Hãy thử lại.', true);
  }).finally(() => { coolerToggle.disabled = false; });
});
