import { STARTER_OFFER, TRIAL_OFFER, type CreditEntry, type ManagedApi, type ManagedStatus, type StarterOrder } from '../shared/managed.js';
import { managedPauseMessage } from '../shared/model-status.js';

const amount = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 });
export const formatCredits = (usd: number) => amount.format(usd * 1000) + ' credits';
const credits = (micros: string) => amount.format(Number(micros) / 1e6) + ' credits';
const displayTime = (iso: string) => new Date(iso).toLocaleString('vi-VN');
const creditLabels: Record<CreditEntry['action'],string> = { GRANT:'Được cấp',HOLD:'Tạm giữ',CHARGE:'Đã dùng',RELEASE:'Nhả phần giữ',REFUND:'Hoàn credits',REVOKE:'Thu hồi' };

export function bindManagedStarter(api: ManagedApi | undefined, changed: () => void, busy: () => boolean) {
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const panel = el('managed-starter');
  const orderDialog = el<HTMLDialogElement>('managed-order-dialog');
  const recoverDialog = el<HTMLDialogElement>('managed-recover-dialog');
  let enabled = false, pending = false, checking = false;
  let status: ManagedStatus | null = null;
  let order: StarterOrder | null = null;
  let refreshedAt = 0;
  let error: string | null = null;
  let preview = false;

  function render() {
    panel.hidden = !enabled;
    if (!enabled) return;
    const trial = el<HTMLButtonElement>('managed-trial'), purchase = el<HTMLButtonElement>('managed-order');
    const unavailable = status?.state === 'UNAVAILABLE';
    const guest = status?.state === 'GUEST';
    el('brand-product').textContent = preview ? 'FindLink Starter — Bản thử' : 'FindLink Starter';
    el('managed-plan').textContent = status?.state === 'TRIAL' ? 'Dùng thử FindLink'
      : status?.state === 'STARTER' ? (status.reason ? 'Gói Starter' : 'Gói Starter đang hoạt động') : 'Tài khoản và gói Starter';
    el('managed-sign-in').hidden = !guest;
    el<HTMLButtonElement>('managed-sign-in').disabled = el<HTMLButtonElement>('project-auth-open').disabled;
    el('managed-refresh').hidden = !unavailable && !!status;
    el('managed-demo').hidden = !guest && !unavailable;
    trial.hidden = status?.state !== 'INACTIVE';
    trial.textContent = `Kích hoạt ${TRIAL_OFFER.credits} credits dùng thử`;
    purchase.hidden = !status?.verified;
    purchase.textContent = status?.state === 'STARTER' ? 'Gia hạn Starter' : 'Mua Starter';
    trial.disabled = purchase.disabled = pending || busy();
    const topup = el<HTMLButtonElement>('managed-topup');
    topup.hidden = status?.state !== 'STARTER' || !status?.topupPriceVnd;
    topup.disabled = pending || busy();
    const wallet = el<HTMLButtonElement>('managed-wallet');
    wallet.hidden = !status || status.state === 'GUEST' || status.state === 'UNAVAILABLE';
    wallet.disabled = pending;
    const update = el<HTMLButtonElement>('managed-update');
    update.hidden = !status?.updateReady;
    update.disabled = pending || busy();
    const balance = status && ['TRIAL','STARTER'].includes(status.state)
      ? credits(status.available) + ' còn lại' + (status.held !== '0' ? ' · ' + credits(status.held) + ' đang giữ' : '') : '';
    const balanceNode = el('managed-balance');
    balanceNode.textContent = balance;
    balanceNode.hidden = !balance;
    const details = status?.state === 'TRIAL' && status.rawRemaining !== null ? amount.format(status.rawRemaining) + ' bài gốc còn lại' : '';
    const date = status?.until ? 'Hạn đến ' + displayTime(status.until) : '';
    const reason = status?.reason ? managedPauseMessage(status.reason) : null;
    el('managed-status').textContent = [error || (unavailable && preview ? 'Backend bản thử chưa chạy. Mở README để khởi động môi trường thử.' : reason), details, date].filter(Boolean).join(' · ');
    const offer = status?.state === 'STARTER' ? '' : `Starter ${amount.format(STARTER_OFFER.priceVnd)} ₫/năm gồm ${amount.format(STARTER_OFFER.credits)} credits.`;
    const trialOffer = guest || unavailable ? `Dùng thử ${TRIAL_OFFER.credits} credits trong ${TRIAL_OFFER.days} ngày theo mã mời.` : '';
    el('managed-terms').textContent = [trialOffer, offer, preview ? 'Dữ liệu và giao dịch mô phỏng.' : ''].filter(Boolean).join(' ');
    if (!status && !error) el('managed-status').textContent = 'Đang kiểm tra quyền sử dụng…';
  }

  function explain(value: unknown) {
    return managedPauseMessage(value instanceof Error ? value.message : String(value)) ?? 'Chưa hoàn tất thao tác. Hãy thử lại.';
  }

  async function refresh(force = false) {
    if (!api || !enabled || checking || (!force && Date.now() - refreshedAt < 7000)) return;
    checking = true;
    refreshedAt = Date.now();
    try {
      status = await api.status();
      preview = status?.preview === true;
    }
    catch { status = null; error = 'Chưa kết nối được dịch vụ FindLink.'; }
    finally { checking = false; render(); changed(); }
  }

  async function action(work: () => Promise<void>) {
    if (!api || pending || busy()) return;
    pending = true;
    error = null;
    render();
    try { await work(); }
    catch (failure) { error = explain(failure); }
    finally { pending = false; render(); changed(); }
  }

  function showOrder() {
    if (!order) return;
    el('managed-order-title').textContent = order.kind === 'TOPUP' ? 'Nạp credits qua SePay' : 'Thanh toán Starter qua SePay';
    el('managed-order-description').textContent = preview ? 'Giao dịch mô phỏng. Không chuyển tiền. Chọn Kiểm tra thanh toán để xem kết quả.'
      : order.kind === 'TOPUP' ? '10.000 credits có hiệu lực một năm kể từ khi xác nhận thanh toán.'
      : `Starter có thời hạn một năm và bao gồm ${amount.format(STARTER_OFFER.credits)} credits AI.`;
    el('managed-order-amount').textContent = amount.format(order.amountVnd) + ' ₫';
    el('managed-order-bank').textContent = order.bank;
    el('managed-order-account').textContent = order.accountNumber + ' · ' + order.accountName;
    el('managed-order-code').textContent = order.code;
    el('managed-order-state').textContent = order.paid ? 'Đã xác nhận thanh toán.' + (order.startsAt && order.endsAt
      ? ' Có hiệu lực từ ' + displayTime(order.startsAt) + ' đến ' + displayTime(order.endsAt) + '.' : '')
      : 'Chờ thanh toán đến ' + displayTime(order.expiresAt) + '.';
  }

  el('managed-demo').addEventListener('click', () => el<HTMLDialogElement>('managed-demo-dialog').showModal());
  el('managed-sign-in').addEventListener('click', () => el<HTMLButtonElement>('project-auth-open').click());
  el('managed-refresh').addEventListener('click', () => void refresh(true));
  el('managed-update').addEventListener('click', () => void action(async () => { await api!.installUpdate(); }));
  el('managed-trial').addEventListener('click', () => void action(async () => { status = await api!.activateTrial(); }));
  el('managed-order').addEventListener('click', () => void action(async () => {
    order = await api!.buyStarter(); showOrder(); orderDialog.showModal();
  }));
  el('managed-topup').addEventListener('click', () => void action(async () => {
    order = await api!.buyCredits(); showOrder(); orderDialog.showModal();
  }));
  el('managed-wallet').addEventListener('click', () => void action(async () => {
    const wallet = await api!.wallet();
    el('managed-wallet-balance').textContent = 'Còn ' + credits(wallet.available) + ' · Đang giữ ' + credits(wallet.held);
    el('managed-wallet-list').replaceChildren(...wallet.ledger.map(entry => {
      const item = document.createElement('li');
      item.textContent = displayTime(entry.at) + ' · ' + creditLabels[entry.action] + ' ' + credits(entry.amount);
      return item;
    }));
    el<HTMLDialogElement>('managed-wallet-dialog').showModal();
  }));
  el('managed-order-close').addEventListener('click', () => orderDialog.close());
  el('managed-order-check').addEventListener('click', () => void action(async () => {
    if (!order) return;
    try {
      order = await api!.orderStatus({ id: order.id }); showOrder();
      if (order.paid) await refresh(true);
    } catch (failure) { el('managed-order-state').textContent = explain(failure); }
  }));
  el('managed-recover-open').addEventListener('click', () => {
    el<HTMLDialogElement>('project-auth-dialog').close();
    el('managed-recover-error').textContent = '';
    recoverDialog.showModal();
  });
  el('managed-recover-cancel').addEventListener('click', () => recoverDialog.close());
  el<HTMLFormElement>('managed-recover-form').addEventListener('submit', event => {
    event.preventDefault();
    void action(async () => {
      try {
        await api!.recover({ code: el<HTMLInputElement>('managed-recover-code').value.trim(),
          password: el<HTMLInputElement>('managed-recover-password').value });
        el<HTMLFormElement>('managed-recover-form').reset();
        recoverDialog.close();
        el<HTMLDialogElement>('project-auth-dialog').showModal();
      } catch (failure) { el('managed-recover-error').textContent = explain(failure); }
    });
  });
  recoverDialog.addEventListener('close', () => el<HTMLFormElement>('managed-recover-form').reset());
  el('project-auth-dialog').addEventListener('close', () => { error = null; void refresh(true); });
  el('project-logout').addEventListener('click', () => { if (enabled) refreshedAt = 0; });

  return {
    render, refresh,
    enabled: (value: boolean) => {
      if (enabled === value) return;
      enabled = value;
      document.body.classList.toggle('managed-mode', enabled);
      if (!enabled) el('brand-product').textContent = 'FindLink';
      el('project-invite-field').hidden = !enabled;
      render();
    },
    blocked: () => enabled && (!status || !!status.reason),
  };
}
