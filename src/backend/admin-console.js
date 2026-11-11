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
const scale = key => key === 'trial_grant_cap' ? 1e6 : 1e9;
const overviewNames = { accounts: 'Tài khoản', devices: 'Thiết bị', reviews: 'Hồ sơ xét duyệt', payments: 'Giao dịch',
  costs: 'Chi phí và dự phòng (nanodollar)', unknown: 'Yêu cầu chờ đối soát', audit: 'Nhật ký vận hành' };
async function refresh() {
  const result = await api('overview');
  const form = byId('policy');
  for (const key of flags) form.elements[key].checked = result.policy[0][key];
  for (const key of countFields) form.elements[key].value = result.policy[0][key];
  for (const key of amountFields) form.elements[key].value = Number(result.policy[0][key]) / scale(key);
  byId('overview').replaceChildren(...Object.entries(overviewNames).map(([key,title]) => {
    const section = document.createElement('section'), heading = document.createElement('h2');
    heading.textContent = title;
    section.append(heading);
    const rows = result[key];
    if (!rows.length) { section.append('Chưa có dữ liệu.'); return section; }
    const table = document.createElement('table'), head = table.createTHead().insertRow(), columns = Object.keys(rows[0]);
    for (const column of columns) {
      const cell = document.createElement('th'); cell.textContent = column; head.append(cell);
    }
    const body = table.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      for (const column of columns) tr.insertCell().textContent = row[column] == null ? '' : typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column]);
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
  for (const key of amountFields) policy[key] = String(Math.round(Number(values[key]) * scale(key)));
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
  await api('ai/reconcile','POST',{ ...values,cost:String(Math.round(Number(values.cost)*1e9)) });
  await refresh();
});
bind('credits', async ({accountId,amount,...values}) => {
  await api('accounts/' + encodeURIComponent(accountId) + '/credits','POST',{
    ...values, amount:String(Math.round(Number(amount)*1e6)), requestId:crypto.randomUUID(),
  });
  await refresh();
});
bind('tariff', async ({observed_at,...values}) => {
  await api('tariffs','POST',{price:{observed_at,...Object.fromEntries(Object.entries(values).map(([k,v])=>[k,Number(v)]))}});
  await refresh();
});
byId('refresh').addEventListener('click',()=>void refresh().catch(error=>{if(error.message==='ADMIN_AUTH_REQUIRED')reset();message(error.message,true);}));
byId('logout').addEventListener('click',()=>void api('logout','POST').catch(()=>{}).finally(reset));
