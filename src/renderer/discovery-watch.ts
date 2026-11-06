import type { ProductionApi, ProductionState } from '../shared/production-api.js';
import type { DiscoverySubscription } from '../shared/discovery-watch.js';

export function bindDiscoveryWatch(api: ProductionApi, state: () => ProductionState | null, busy: () => boolean,
  report: (message: string, failed?: boolean) => void) {
  const panel = document.createElement('section'); panel.className = 'panel discovery-panel';
  const title = document.createElement('h2'); title.textContent = 'Tìm bổ sung định kỳ';
  const explanation = document.createElement('p'); explanation.className = 'helper';
  explanation.textContent = 'Mục tiêu 100 bài chưa từng xuất mỗi tháng, gồm cả bài cũ mới tìm thấy. Lịch chạy khi ứng dụng đang mở. Xuất kết quả để ghi nhận bài đã giao. Khi đổi cấu hình cùng khách/lĩnh vực, gắn vào lịch đã có để giữ lịch sử.';
  const create = document.createElement('button'); create.type = 'button'; create.className = 'secondary-button'; create.textContent = 'Theo dõi lĩnh vực của lượt này';
  const label = document.createElement('input'); label.type = 'text'; label.maxLength = 200; label.placeholder = 'Tên khách hàng / lĩnh vực (để phân biệt lịch sử giao bài)'; label.setAttribute('aria-label', 'Tên khách hàng và lĩnh vực');
  const list = document.createElement('div'); panel.append(title, explanation, label, create, list); document.querySelector('main')!.append(panel);
  let pending = false, refreshing = false, lastKey = '', subscriptions: DiscoverySubscription[] = [];
  async function action(work: () => Promise<DiscoverySubscription[]>, allowDuringRun = false) {
    if (pending || (!allowDuringRun && busy())) return; pending = true; render();
    try { subscriptions = await work(); report('Đã cập nhật lịch tìm bổ sung.'); }
    catch (error) {
      const code = error instanceof Error ? error.message : '';
      report(/EXPORT_REQUIRED/.test(code) ? 'Hãy xuất kết quả hiện tại trước khi tìm bổ sung.'
        : /NOT_DUE/.test(code) ? 'Đã đạt mục tiêu tháng, có kết quả chờ xuất hoặc lịch đang tắt.'
        : /ALREADY_EXISTS/.test(code) ? 'Lĩnh vực này đã có lịch theo dõi.'
        : /RUN_ACTIVE|BUSY/.test(code) ? 'Đợi lượt hiện tại hoàn tất để cập nhật lịch.' : 'Chưa cập nhật được lịch. Kiểm tra lượt nguồn và tài khoản.', true);
    } finally { pending = false; lastKey = ''; render(); }
  }
  function render() {
    const current = state(), locked = pending || busy();
    create.disabled = locked || !current?.run?.opportunity || current?.run?.mode === 'RETAINED' || ['RUNNING', 'STOPPING'].includes(current.run.state);
    const key = JSON.stringify([subscriptions, locked, current?.run?.id]); if (key === lastKey) return; lastKey = key;
    list.replaceChildren(...subscriptions.map(sub => {
      const row = document.createElement('article'); row.className = 'opportunity-card';
      const name = document.createElement('strong'); name.textContent = sub.label;
      const status = document.createElement('p'); status.textContent = `${sub.deliveredThisMonth}/${sub.monthlyTarget} bài bổ sung đã xuất tháng này · ${sub.deliveredTotal} bài đã xuất tổng cộng`;
      const next = document.createElement('p'); next.className = 'helper'; next.textContent = sub.activeRunId ? 'Đang tìm bổ sung…'
        : sub.awaitingExport ? 'Có kết quả chờ xuất.' : sub.enabled ? 'Lượt kế tiếp: ' + new Date(sub.nextRunAt).toLocaleString('vi-VN') : 'Lịch đang tắt.';
      if (sub.lastError) next.textContent += ' Lượt trước cần kiểm tra; dữ liệu đã lưu được giữ.';
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'text-button'; toggle.textContent = sub.enabled ? 'Tắt lịch' : 'Bật lịch'; toggle.disabled = pending;
      toggle.addEventListener('click', () => { void action(() => api.discoveryWatch.setEnabled({ id: sub.id, enabled: !sub.enabled }), true); });
      const run = document.createElement('button'); run.type = 'button'; run.className = 'secondary-button'; run.textContent = 'Tìm bổ sung ngay'; run.disabled = locked || !sub.enabled || !!sub.activeRunId || sub.awaitingExport;
      run.addEventListener('click', () => { void action(() => api.discoveryWatch.runNow({ id: sub.id })); });
      const attach = document.createElement('button'); attach.type = 'button'; attach.className = 'text-button'; attach.textContent = 'Dùng cấu hình lượt hiện tại cho khách / lĩnh vực này';
      attach.disabled = locked || sub.awaitingExport || !!sub.activeRunId || !current?.run?.opportunity || current.run.mode === 'RETAINED' || current.run.id === (sub.recipeRunId ?? sub.sourceRunId);
      attach.addEventListener('click', () => { const sourceRunId = state()?.run?.id; if (sourceRunId) void action(() => api.discoveryWatch.attachRecipe({ id: sub.id, sourceRunId })); });
      row.append(name, status, next, toggle, run, attach); return row;
    }));
  }
  create.addEventListener('click', () => {
    const run = state()?.run; if (!run) return;
    void action(() => api.discoveryWatch.create({ sourceRunId: run.id, label: label.value.trim() || run.keywords.slice(0, 3).join(' · ').slice(0, 200) || 'Lĩnh vực đang theo dõi' }));
  });
  return { async refresh() {
    if (refreshing || pending) { render(); return; } refreshing = true;
    try { subscriptions = await api.discoveryWatch.list(); render(); } catch { create.disabled = true; }
    finally { refreshing = false; }
  } };
}
