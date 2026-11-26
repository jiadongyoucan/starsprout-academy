#!/usr/bin/env node
/** Accessibility-tree audit (proxy for screen-reader naming; not a substitute for manual VoiceOver). */
const BASE = process.env.E2E_BASE || 'http://localhost:8080';
const CDP = process.env.E2E_CDP || 'http://127.0.0.1:9223';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const tab = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json()).catch(() => null);
if (!tab) { console.error('SKIP: Chrome CDP unavailable'); process.exit(2); }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map(); const problems = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
await send('Runtime.enable'); await send('Page.enable'); await send('Accessibility.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'parent@demo.com', password: 'Parent123!' }) }).then(r => r.json());
await send('Page.navigate', { url: `${BASE}/` }); await sleep(700);
await ev(`localStorage.setItem('starsprout.token', ${JSON.stringify(login.data.token)}); localStorage.setItem('starsprout.child', 'chi_mili')`);
await send('Page.reload', { ignoreCache: true }); await sleep(1800);

async function audit(label) {
  const { nodes } = await send('Accessibility.getFullAXTree');
  const interactive = nodes.filter(n => !n.ignored && ['button', 'link', 'textbox', 'combobox', 'checkbox', 'switch', 'tab', 'menuitem'].includes(n.role?.value));
  for (const node of interactive) {
    const name = node.name?.value?.trim();
    if (!name) problems.push(`${label}: ${node.role.value} without accessible name (${node.nodeId})`);
  }
  const images = nodes.filter(n => !n.ignored && n.role?.value === 'image');
  for (const node of images) {
    if (!node.name?.value?.trim()) problems.push(`${label}: image without alt/name`);
  }
  console.log(`✓ ${label}: ${interactive.length} interactive nodes checked`);
}
await audit('parent-home');
await ev("location.hash='#/child'"); await sleep(1200); await audit('child-space');
await ev("sessionStorage.removeItem('starsprout.kidLocked'); location.hash='#/home'"); await sleep(1000);
await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false }); await sleep(700);
await audit('parent-tablet-rail');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(700);
await audit('parent-mobile');
if (problems.length) { console.error(problems.slice(0, 20).join('\n')); process.exit(1); }
console.log('A11Y PASS (naming only; manual VoiceOver checklist in docs/e2e/accessibility.md)');
ws.close();
