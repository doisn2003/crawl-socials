import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { app, BrowserWindow, Menu } from 'electron';
import { totp } from '../dist/backend/admin.js';

const bootstrap = process.env.FINDLINK_PREVIEW_BOOTSTRAP;
delete process.env.FINDLINK_PREVIEW_BOOTSTRAP;
const { directory, origin, admin, signup, verify } = JSON.parse(bootstrap ?? '{}');
if (process.env.FINDLINK_LOCAL_PREVIEW !== '1' || origin !== process.env.FINDLINK_DEV_BACKEND_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
  throw Error('PREVIEW_LOOPBACK_REQUIRED');
}
app.setPath('appData', directory);
let adminWindow, quitting = false;
app.on('before-quit', () => { quitting = true; });

async function until(window, source, code, timeout = 25_000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    if (await window.webContents.executeJavaScript(source)) return;
    await delay(220);
  }
  throw Error(code);
}

async function showAdmin() {
  if (!adminWindow) {
    adminWindow = new BrowserWindow({ width: 1150, height: 770, title: 'Quản trị FindLink Starter — Bản thử', show: false,
      autoHideMenuBar: true, webPreferences: { partition: 'findlink-preview-admin', sandbox: true, contextIsolation: true, nodeIntegration: false } });
    adminWindow.removeMenu();
    adminWindow.on('page-title-updated', event => event.preventDefault());
    adminWindow.on('close', event => { if (!quitting) { event.preventDefault(); adminWindow.hide(); } });
    adminWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    adminWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
    await adminWindow.loadURL(origin + '/admin');
    await adminWindow.webContents.executeJavaScript(`(() => {
      const text = document.createElement('p');
      text.textContent = 'Bản thử trên máy. Tài khoản, giá vốn và thanh toán đều là dữ liệu mô phỏng.';
      document.querySelector('h1').after(text);
    })()`);
  }
  const otp = totp(admin.totp, Math.floor(Date.now() / 30_000));
  await adminWindow.webContents.executeJavaScript(`(() => {
    const form = document.getElementById('login');
    if (form.hidden) return;
    form.elements.token.value = ${JSON.stringify(admin.token)};
    form.elements.otp.value = ${JSON.stringify(otp)};
    form.requestSubmit();
  })()`);
  await until(adminWindow, "document.getElementById('starter-offer').textContent.includes('50.000')", 'PREVIEW_ADMIN_NOT_READY');
  if (!verify) adminWindow.show();
  return adminWindow;
}

const prompt = 'Tìm bài viết hỏi về quán cà phê yên tĩnh.';
const savedConfig = { schemaVersion: 2, keywords: ['quán cà phê yên tĩnh'], minimumPosts: 20, filterPercent: 65,
  opportunity: { enabled: true, prompt, brandContext: '', totalTarget: 20, filterMode: 'STANDARD',
    rawCap: 1000, budgetUsd: 0.1, commentsEnabled: false, languageScope: 'VIETNAMESE' } };
const startup = setTimeout(() => { console.error('FINDLINK_PREVIEW_DESKTOP_TIMEOUT'); app.exit(1); }, 90_000);
let hooked = false;
app.on('browser-window-created', (_event, window) => {
  if (hooked) return;
  hooked = true;
  if (verify) window.show = () => {};
  window.webContents.once('did-finish-load', () => void (async () => {
    let phase = 'START';
    try {
      const run = source => window.webContents.executeJavaScript(source);
      await until(window, "!!window.csd?.managed && !document.getElementById('managed-starter').hidden", 'PREVIEW_DESKTOP_NOT_READY');
      phase = 'REGISTER';
      if (verify) {
        assert.equal(await run("!!document.querySelector('.intro #managed-balance')"),true);
        await run("document.getElementById('managed-service-open').click()");
        await until(window,"!document.getElementById('managed-sign-in').hidden && !document.getElementById('managed-sign-in').disabled",'PREVIEW_SIGN_IN_NOT_READY');
        assert.equal(await run("document.getElementById('managed-service-dialog').open"),true);
        await run("document.getElementById('managed-sign-in').click()");
        assert.equal(await run("document.getElementById('project-auth-dialog').open"),true);
        await run(`{
          const credentials = ${JSON.stringify(signup)};
          document.getElementById('project-username').value = credentials.username;
          document.getElementById('project-password').value = credentials.password;
          document.getElementById('project-invite').value = credentials.invite;
          document.getElementById('project-register').click();
        }`);
        await until(window,"!document.getElementById('managed-trial').hidden && !document.getElementById('managed-trial').disabled",'PREVIEW_ACTIVATE_NOT_READY');
        await run("document.getElementById('managed-trial').click()");
        await until(window,"window.csd.managed.status().then(status => status.state === 'TRIAL')",'PREVIEW_TRIAL_NOT_ACTIVE');
      } else {
        await run('window.csd.projects.register(' + JSON.stringify(signup) + ')');
        await run('window.csd.managed.activateTrial()');
      }
      const trial = await run('window.csd.managed.status()');
      assert.equal(trial.state, 'TRIAL');
      assert.equal(trial.available, '100000000');
      await run('window.csd.saveConfig(' + JSON.stringify(savedConfig) + ')');
      await run("document.getElementById('project-auth-dialog').dispatchEvent(new Event('close'))");
      await until(window, "document.getElementById('managed-balance').textContent.includes('100 credits')", 'PREVIEW_TRIAL_BALANCE_NOT_VISIBLE');
      phase = 'ADMIN';
      const operations = await showAdmin();
      window.setMenu(Menu.buildFromTemplate([{ label: 'Bản thử', submenu: [{ label: 'Mở quản trị', click: () => {
        void showAdmin().catch(() => console.error('FINDLINK_PREVIEW_ADMIN_LOGIN_FAILED'));
      } }] }]));
      window.setAutoHideMenuBar(false);
      if (!verify) {
        clearTimeout(startup);
        window.show(); window.focus();
        console.log('FINDLINK_PREVIEW_READY trial=100 admin=ready');
        return;
      }
      phase = 'AI';
      await run('window.csd.prepareCampaign()');
      const wallet = await run('window.csd.managed.wallet()');
      assert.ok(BigInt(wallet.available) < 100000000n && BigInt(wallet.available) > 0n);
      assert.ok(wallet.ledger.some(item => item.action === 'CHARGE' && BigInt(item.amount) > 0n));
      phase = 'BILLING';
      await run("document.getElementById('managed-order').click()");
      await until(window, "document.getElementById('managed-order-dialog').open", 'PREVIEW_ORDER_NOT_VISIBLE');
      assert.match(await run("document.getElementById('managed-order-description').textContent"), /mô phỏng/);
      await until(window, "window.csd.managed.status().then(status => status.state === 'STARTER')", 'PREVIEW_SEPAY_NOT_APPLIED');
      await run("document.getElementById('managed-order-check').click()");
      await until(window, "document.getElementById('managed-balance').textContent.includes('50.000 credits')", 'PREVIEW_STARTER_BALANCE_NOT_VISIBLE');
      await until(window, "document.getElementById('managed-access-note').textContent.includes('chờ FindLink cấu hình AI')", 'PREVIEW_STARTER_KEY_NOTICE_NOT_VISIBLE');
      await run("document.getElementById('managed-order-close').click()");
      assert.equal(await run("document.getElementById('managed-service-dialog').open"),true);
      await run("document.getElementById('managed-topup').click()");
      await until(window, "document.getElementById('managed-order-dialog').open", 'PREVIEW_TOPUP_NOT_VISIBLE');
      await until(window, "window.csd.managed.status().then(status => status.available === '60000000000')", 'PREVIEW_TOPUP_NOT_APPLIED');
      await run("document.getElementById('managed-order-check').click()");
      await until(window, "document.getElementById('managed-balance').textContent.includes('60.000 credits')", 'PREVIEW_TOPUP_BALANCE_NOT_VISIBLE');
      await operations.webContents.executeJavaScript("document.getElementById('refresh').click()");
      await until(operations, "document.getElementById('orders-list')?.textContent.includes('Đã xác nhận')", 'PREVIEW_ADMIN_ORDER_NOT_VISIBLE');
      phase = 'PROVIDER_CREDENTIAL';
      await operations.webContents.executeJavaScript(`(() => {
        const form = document.getElementById('model-credential');
        form.elements.accountId.value = [...document.getElementById('account-options').options]
          .find(option => option.label === ${JSON.stringify(signup.username)}).value;
        form.elements.key.value = 'preview-starter-fixture';
        form.elements.reason.value = 'Khóa riêng của tài khoản mô phỏng';
        form.requestSubmit();
      })()`);
      await until(operations, "document.getElementById('service-setup').textContent.includes('Starter 1 tài khoản có khóa')", 'PREVIEW_ADMIN_KEY_NOT_ASSIGNED');
      assert.equal(await operations.webContents.executeJavaScript("document.getElementById('model-credential').elements.key.value"), '');
      assert.equal((await run('window.csd.managed.status()')).aiReason, undefined);
      console.log('FINDLINK_PREVIEW_VERIFIED intro=credits service=dialog trial=100 ai=charged sepay=applied starter=50000 topup=60000 admin=visible starter-key=assigned');
      clearTimeout(startup);
      app.quit();
    } catch {
      clearTimeout(startup);
      console.error('FINDLINK_PREVIEW_DESKTOP_FAILED ' + phase);
      app.exit(1);
    }
  })());
});

await import('../dist/main/index.js');
