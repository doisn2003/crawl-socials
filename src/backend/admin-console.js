let session = '';
const byId = id => document.getElementById(id);
const message = (text, failed = false) => {
  byId('message').textContent = text;
  byId('message').dataset.error = String(failed);
};
async function api(path, method = 'GET', data) {
  const headers = { 'Content-Type': 'application/json' };
  if (session) headers.Authorization = 'Bearer ' + session;
  const response = await fetch('/v1/admin/' + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw Error(result.code || 'BACKEND_UNAVAILABLE');
  return result;
}
function reset() {
  session = '';
  byId('console').hidden = true;
  byId('login').hidden = false;
  byId('invite-code').textContent = '';
  byId('overview').replaceChildren();
}
function bind(id, action) {
  const form = byId(id);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await action(Object.fromEntries(new FormData(form)));
      message('Đã cập nhật.');
    } catch (error) {
      if (error.message === 'ADMIN_AUTH_REQUIRED') reset();
      message(error.message,true);
    } finally { button.disabled = false; }
  });
}
const countFields = ['max_trial_subjects','trial_subjects_per_day'];
const amountFields = ['trial_grant_cap','trial_daily_cost','trial_total_cost','paid_daily_cost','paid_total_cost'];
const flags = ['trial_enabled','pause_grants','pause_trial','pause_ai'];
const microsPerCredit = 1e6;
const creditsPerUsd = 1000;
const tariffFields = ['input_per_million','cached_input_per_million','output_per_million'];
const modelNames = { 'gemini-3.1-flash-lite':'Gemini 3.1 Flash-Lite', 'deepseek-flash':'DeepSeek Flash' };
let models = [], savedPrices = new Map();
const overviewNames = { accounts: 'Tài khoản và số dư', orders: 'Đơn hàng và hạn gói', payments: 'Giao dịch SePay',
  devices: 'Thiết bị', reviews: 'Hồ sơ xét duyệt', costs: 'Chi phí AI và dự phòng (credits)', unknown: 'Yêu cầu chờ đối soát', audit: 'Nhật ký vận hành' };
const columnsVi = { username:'Tài khoản', id:'ID', account_id:'ID tài khoản', plan:'Gói', available:'Credits còn lại', paid_until:'Starter đến',
  trial_until:'Trial đến', suspended:'Đã tạm ngừng', email_verified_at:'Xác minh lúc', code:'Mã đơn', kind:'Loại', amount_vnd:'Số tiền',
  credits:'Credits', state:'Trạng thái', starts_at:'Bắt đầu', ends_at:'Kết thúc', order_id:'ID đơn', provider_id:'ID SePay', reason:'Lý do',
  created_at:'Tạo lúc', seen_at:'Hoạt động gần nhất', revoked_at:'Thu hồi lúc', funding:'Quỹ', attempts:'Lượt gọi', measured:'Đã đo', held:'Đang giữ', bound:'Dự phòng (credits)' };
const names = { STARTER:'Starter', TRIAL:'Dùng thử', INACTIVE:'Chưa có gói', TOPUP:'Nạp credits', PAID:'Starter', PENDING:'Chờ thanh toán',
  APPLIED:'Đã xác nhận', REVIEW:'Cần đối soát', REFUNDED:'Đã hoàn tiền', EXPIRED:'Hết hạn' };
const number = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6 });
const date = new Intl.DateTimeFormat('vi-VN', { dateStyle:'short', timeStyle:'short' });
function cellText(key, value) {
  if (value == null) return '';
  if (['available','credits','measured','held','bound'].includes(key)) return number.format(Number(value)/microsPerCredit);
  if (key === 'amount_vnd') return number.format(Number(value)) + ' ₫';
  if ((key === 'at' || key.endsWith('_at') || key.endsWith('_until')) && Number.isFinite(Date.parse(value))) return date.format(new Date(value));
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'object') return JSON.stringify(value);
  return Object.hasOwn(names, value) ? names[value] : String(value);
}
function choices(id, rows, value, label) {
  byId(id).replaceChildren(...rows.map(row => {
    const option = document.createElement('option');
    option.value = row[value];
    option.label = label(row);
    return option;
  }));
}
function fillTariff() {
  const form = byId('tariff'), model = form.elements.model.value;
  const price = savedPrices.get(model), provider = models.find(option => option.model === model);
  for (const key of tariffFields) form.elements[key].value = price ? price[key] * creditsPerUsd : '';
  form.elements.observed_at.value = price?.observed_at ?? '';
  const info = byId('tariff-provider');
  info.textContent = provider?.configured ? 'Khóa đã cấu hình trên máy chủ. ' : 'Thêm khóa của model vào cấu hình máy chủ. ';
  if (provider) {
    const link = document.createElement('a');
    link.href = provider.source;
    link.textContent = 'Biểu giá nhà cung cấp';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    info.append(link);
  }
}
async function refresh() {
  const result = await api('overview');
  const form = byId('policy');
  const policy = result.policy[0], tariff = result.tariff[0];
  const { starter, trial, sepayMode } = result.setup;
  models = result.setup.models;
  savedPrices = new Map(result.tariffs.map(row => [row.model, row.price]));
  byId('starter-offer').textContent = number.format(starter.priceVnd) + ' ₫/năm · ' + number.format(starter.credits) + ' credits';
  byId('trial-offer').textContent = trial.credits + ' credits · ' + trial.days + ' ngày · ' + (policy.trial_enabled && !policy.pause_grants ? 'Đang cấp mã đã duyệt' : 'Tạm dừng cấp mới');
  const activeConfigured = models.some(model => model.model === tariff.model && model.configured);
  byId('service-setup').textContent = 'AI ' + (!activeConfigured ? 'thiếu khóa' : policy.pause_ai ? 'tạm dừng' : 'đang hoạt động')
    + ' · SePay ' + (sepayMode === 'live' ? 'Live' : sepayMode === 'test' ? 'Test Mode' : 'chưa cấu hình');
  byId('active-tariff').textContent = `${modelNames[tariff.model]} · Biểu giá ${tariff.id} · Xác minh ngày ${tariff.price.observed_at}`;
  const tariffForm = byId('tariff');
  tariffForm.elements.model.replaceChildren(...models.map(row => {
    const option = document.createElement('option');
    option.value = row.model;
    option.textContent = modelNames[row.model];
    return option;
  }));
  tariffForm.elements.model.value = tariff.model;
  fillTariff();
  for (const key of flags) form.elements[key].checked = result.policy[0][key];
  for (const key of countFields) form.elements[key].value = result.policy[0][key];
  for (const key of amountFields) form.elements[key].value = Number(result.policy[0][key]) / microsPerCredit;
  const usernames = new Map(result.accounts.map(row => [row.id,row.username]));
  choices('account-options',result.accounts,'id',row=>row.username);
  choices('device-options',result.devices,'id',row=>usernames.get(row.account_id) ?? row.account_id);
  choices('order-options',result.orders,'order_id',row=>row.code + ' · ' + row.username);
  choices('payment-options',result.payments,'provider_id',row=>cellText('state',row.state) + ' · ' + cellText('amount_vnd',row.amount_vnd));
  byId('overview').replaceChildren(...Object.entries(overviewNames).map(([key,title]) => {
    const section = document.createElement('section'), heading = document.createElement('h2');
    section.id = key + '-list';
    heading.textContent = title;
    section.append(heading);
    const rows = result[key];
    if (!rows.length) { section.append('Chưa có dữ liệu.'); return section; }
    const table = document.createElement('table'), head = table.createTHead().insertRow(), columns = Object.keys(rows[0]);
    for (const column of columns) {
      const cell = document.createElement('th'); cell.textContent = columnsVi[column] ?? column; head.append(cell);
    }
    const body = table.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      for (const column of columns) tr.insertCell().textContent = cellText(column,row[column]);
    }
    section.append(table);
    return section;
  }));
}
bind('login', async values => {
  const result = await api('session','POST',values);
  session = result.token;
  byId('login').reset();
  byId('login').hidden = true;
  byId('console').hidden = false;
  await refresh();
});
bind('invite', async values => {
  const result = await api('invites','POST',{ ...values, hours:Number(values.hours) });
  byId('invite-code').textContent = 'Mã mời cho ' + result.email + ' · ' + result.code;
});
bind('policy', async values => {
  const policy = {};
  for (const key of flags) policy[key] = values[key] === 'on';
  for (const key of countFields) policy[key] = Number(values[key]);
  for (const key of amountFields) policy[key] = String(Math.round(Number(values[key]) * microsPerCredit));
  await api('policy','PUT',policy);
  await refresh();
});
bind('account', async ({accountId,...values}) => {
  await api('accounts/' + encodeURIComponent(accountId),'POST',values);
  await refresh();
});
bind('review', async ({id,approved,reason}) => {
  await api('reviews/' + encodeURIComponent(id),'POST',{approved:approved==='true',reason});
  await refresh();
});
bind('payment', async ({id,action,...values}) => {
  await api('payments/' + encodeURIComponent(id) + '/' + action,'POST',values);
  await refresh();
});
bind('ai', async values => {
  await api('ai/reconcile','POST',{ ...values,cost:String(Math.round(Number(values.cost)*microsPerCredit)) });
  await refresh();
});
bind('credits', async ({accountId,amount,...values}) => {
  await api('accounts/' + encodeURIComponent(accountId) + '/credits','POST',{
    ...values, amount:String(Math.round(Number(amount)*microsPerCredit)), requestId:crypto.randomUUID(),
  });
  await refresh();
});
byId('tariff').elements.model.addEventListener('change', fillTariff);
bind('tariff', async ({model,observed_at,...values}) => {
  const price = Object.fromEntries(tariffFields.map(key => [key,Number(values[key])/creditsPerUsd]));
  await api('tariffs','POST',{model,price:{observed_at,...price}});
  await refresh();
});
byId('refresh').addEventListener('click',()=>void refresh().catch(error=>{if(error.message==='ADMIN_AUTH_REQUIRED')reset();message(error.message,true);}));
byId('logout').addEventListener('click',()=>void api('logout','POST').catch(()=>{}).finally(reset));
