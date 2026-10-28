import type { DesktopApi, ProbeViewStatus } from '../shared/desktop-api.js';
declare global { interface Window { readonly csd: DesktopApi; } }

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error('UI_ELEMENT_MISSING');
  return value as T;
}
const labels = { PAGE: 'Page', PUBLIC_GROUP: 'Nhóm công khai', PUBLIC_PERSONAL: 'Trang cá nhân công khai' };
async function initialize() {
  const info = await window.csd.getInfo();
  element('version').textContent = 'v' + info.version;
  element('campaign-name').textContent = info.campaign.name;
  element('target').textContent = info.campaign.target.toLocaleString('vi-VN');
  element('max-hours').textContent = String(info.campaign.maxHours);
  element('preference').textContent = 'Ưu tiên ' + info.campaign.preferredPlaces.join(', ') + ' · Chấp nhận địa phương khác';
  for (const keyword of info.campaign.keywords) {
    const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = keyword;
    element('keywords').append(chip);
  }
  for (const source of info.campaign.sources) {
    const item = document.createElement('li');
    const dot = document.createElement('span'); dot.className = 'source-dot'; dot.setAttribute('aria-hidden', 'true');
    item.append(dot, document.createTextNode(labels[source.type]));
    element('sources').append(item);
  }
  const button = element<HTMLButtonElement>('offline-check');
  button.disabled = false;
  button.addEventListener('click', async () => {
    button.disabled = true;
    const result = element('check-result');
    result.dataset.state = 'running'; result.textContent = 'Đang kiểm tra…';
    try {
      const check = await window.csd.runOfflineCheck();
      if (check.captureMode !== 'FIXTURE' || check.benchmarkEligible || check.verifiedValidUniquePosts !== 0) throw new Error('OFFLINE_RESULT_INVALID');
      result.textContent = 'Đã kiểm tra cấu hình mẫu thành công. Chưa có bài Facebook nào được thu thập.';
      result.dataset.state = 'passed';
    } catch {
      result.textContent = 'Chưa hoàn tất kiểm tra. Hãy khởi động lại CSD và thử lại.';
      result.dataset.state = 'failed';
    } finally { button.disabled = false; }
  });
  const probeConfig = await window.csd.probe.config();
  let probeActive = false;
  const probeStart = element<HTMLButtonElement>('probe-start'), probeStop = element<HTMLButtonElement>('probe-stop');
  element('probe-availability').textContent = probeConfig.available
    ? 'FIXTURE trên máy · 3 query · tối đa 30 phút, 20 thao tác, 50 MB. Mỗi lần bắt đầu tạo lượt mới; không tiếp tục lượt cũ.'
    : 'Thu Facebook chưa khả dụng. Driver tìm kiếm/phân trang, parser, điều kiện route và phiên thực còn chờ xác minh.';
  function showProbe(state: ProbeViewStatus) {
    probeActive = ['STARTING', 'RUNNING', 'STOPPING'].includes(state.state);
    element('probe-status').dataset.state = state.state;
    element('probe-status').textContent = state.runId
      ? `${state.state} · ${state.runId} · ${state.reason || 'Đang chạy'}${state.deadlineAt ? ' · Hạn ' + new Date(state.deadlineAt).toLocaleTimeString('vi-VN') : ''}`
      : 'Chưa có lượt chạy.';
    element('probe-counts').textContent = `Thao tác: ${state.counters.actions}/20 · Batch: ${state.counters.batches.join('/')} · Response chẩn đoán: ${state.counters.diagnosticCaptures} · Đã lưu: ${state.persistedBytes.toLocaleString('vi-VN')} byte · Bài hợp lệ: 0 · Candidate, Page/nhóm/cá nhân: UNKNOWN.`;
    probeStart.disabled = !probeConfig.available || probeActive || !element<HTMLSelectElement>('probe-profile').value;
    probeStop.disabled = !probeActive;
  }
  let polling = false;
  const refreshProbe = async () => { if (polling) return; polling = true; try { showProbe(await window.csd.probe.status()); } finally { polling = false; } };
  probeStart.addEventListener('click', async () => {
    probeStart.disabled = true;
    try { showProbe(await window.csd.probe.start({ profileId: element<HTMLSelectElement>('probe-profile').value })); }
    catch { element('probe-status').textContent = 'Chưa bắt đầu được. Mở phiên và kiểm tra cấu hình fixture.'; }
    finally { await refreshProbe(); }
  });
  probeStop.addEventListener('click', async () => { probeStop.disabled = true; try { showProbe(await window.csd.probe.stop()); } catch { element('probe-status').textContent = 'Không dừng được; đóng ứng dụng để kết thúc phép thử.'; } });
  element('probe-profile').addEventListener('change', () => { void refreshProbe().catch(() => {}); });
  const probeTimer = setInterval(() => { if (probeActive) void refreshProbe().catch(() => {}); }, 500);
  window.addEventListener('beforeunload', () => clearInterval(probeTimer), { once: true });
  async function refreshProfiles() {
    const state = await window.csd.profiles.list();
    const selector = element<HTMLSelectElement>('probe-profile'), previous = selector.value;
    selector.replaceChildren();
    for (const profile of state.profiles.filter(profile => profile.open && !profile.persistenceError)) {
      const option = document.createElement('option'); option.value = profile.id; option.textContent = profile.label; selector.append(option);
    }
    if ([...selector.options].some(option => option.value === previous)) selector.value = previous;
    element('profiles').replaceChildren();
    for (const profile of state.profiles) {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = profile.label + (profile.open ? ' · Đang mở' : ' · Đã đóng');
      row.append(label);
      const actions = document.createElement('div'); actions.className = 'profile-actions';
      for (const [title, action, disabled] of [
        ['Mở phiên', () => window.csd.profiles.open({ profileId: profile.id }), false],
        ['Đóng phiên', () => window.csd.profiles.close({ profileId: profile.id }), !profile.open],
        ['Đăng nhập Facebook', () => window.csd.profiles.openLogin({ profileId: profile.id }), !state.manualLoginEnabled],
      ] as const) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = title; button.disabled = disabled;
        if (disabled && title === 'Đăng nhập Facebook') button.title = 'Đăng nhập thủ công chưa được bật ở cấu hình khởi động.';
        button.addEventListener('click', async () => {
          button.disabled = true;
          try { await action(); await refreshProfiles(); element('profile-result').textContent = 'Đã cập nhật phiên. Chưa bắt đầu thu thập bài.'; }
          catch { element('profile-result').textContent = 'Không thực hiện được thao tác phiên. Kiểm tra cấu hình và thử lại.'; button.disabled = false; }
        });
        actions.append(button);
      }
      row.append(actions); element('profiles').append(row);
    }
    element('profile-result').textContent = state.profiles.length ? 'Các phiên dùng dữ liệu riêng trên máy này; chưa xác minh tài khoản.' : 'Chưa có phiên truy cập.';
    await refreshProbe();
  }
  element<HTMLFormElement>('profile-form').addEventListener('submit', event => {
    event.preventDefault();
    const field = element<HTMLInputElement>('profile-label');
    void window.csd.profiles.create({ label: field.value }).then(async () => { field.value = ''; await refreshProfiles(); }, () => {
      element('profile-result').textContent = 'Không tạo được phiên. Nhập tên từ 1 đến 80 ký tự và thử lại.';
    }).catch(() => { element('profile-result').textContent = 'Không tải được danh sách phiên.'; });
  });
  window.addEventListener('focus', () => { void refreshProfiles().catch(() => {}); });
  await refreshProfiles();
  document.documentElement.dataset.ready = 'true';
}
void initialize().catch(() => {
  element('check-result').textContent = 'Không tải được cấu hình CSD. Hãy khởi động lại ứng dụng.';
  element('check-result').dataset.state = 'failed';
});
