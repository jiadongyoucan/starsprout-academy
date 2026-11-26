#!/usr/bin/env node
/**
 * 可选的浏览器 E2E（需要 Chrome 以 --remote-debugging-port=9223 启动，服务已在 8080 运行）。
 * 用法：E2E_BASE=http://localhost:8080 E2E_CDP=http://127.0.0.1:9223 node scripts/e2e.mjs
 * 没有 Chrome/CDP 时退出 2（跳过），而不是伪报通过。
 */
const BASE = process.env.E2E_BASE || 'http://localhost:8080';
const CDP = process.env.E2E_CDP || 'http://127.0.0.1:9223';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  let tab;
  try {
    tab = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
  } catch { console.error('SKIP: Chrome CDP 不可用'); process.exit(2); }
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(msg.error) : p.resolve(msg.result); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails?.text);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })).result?.value;
  const check = (condition, label) => { if (!condition) throw new Error(`FAIL: ${label}`); console.log(`✓ ${label}`); };

  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true }); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'parent@demo.com', password: 'Parent123!' }),
  }).then(r => r.json());
  check(login.ok, 'demo parent login');
  await send('Page.navigate', { url: `${BASE}/` }); await sleep(800);
  await evaluate(`localStorage.setItem('starsprout.token', ${JSON.stringify(login.data.token)}); localStorage.setItem('starsprout.child', 'chi_mili')`);
  await send('Page.reload', { ignoreCache: true }); await sleep(2200);
  check(await evaluate("!!document.querySelector('.home-hero')"), 'parent home renders');
  check(await evaluate("!!document.querySelector('.warm-card')"), 'warmth card renders');
  check((await evaluate("document.querySelectorAll('.stat-card-v2').length")) === 3, 'three calm stats');
  check(await evaluate("!document.querySelector('#quickFeed')"), 'no duplicate quick-feed button');
  await evaluate("location.hash = '#/child'"); await sleep(1600);
  check(await evaluate("document.body.classList.contains('kid-mode')"), 'child mode isolates parent chrome');
  check((await evaluate("document.querySelectorAll('.kid-stop').length")) >= 1, 'child adventure path renders');
  check(parseFloat(await evaluate("getComputedStyle(document.querySelector('.kid-speech')).fontSize")) >= 16, 'kid speech >=16px');
  check((await evaluate("document.querySelector('.kid-parent-link').getBoundingClientRect().height")) >= 64, 'child parent-gate target >=64px');
  check((await evaluate("document.querySelector('.kid-chip').getBoundingClientRect().height")) >= 64, 'kid chip target >=64px');
  check(parseFloat(await evaluate("getComputedStyle(document.body).fontSize")) >= 16, 'body >=16px');
  check((await evaluate("getComputedStyle(document.querySelector('.rainbow')).display")) !== 'none', 'rainbow rendered');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(700);
  check((await evaluate("document.documentElement.scrollWidth")) <= 390, '390px no horizontal overflow');
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 2, mobile: true }); await sleep(700);
  check((await evaluate("document.documentElement.scrollWidth")) <= 320, '320px no horizontal overflow');
  check(errors.length === 0, 'no uncaught page exceptions');
  ws.close();
  console.log('E2E PASS');
}
main().catch((error) => { console.error(error.message); process.exit(1); });
