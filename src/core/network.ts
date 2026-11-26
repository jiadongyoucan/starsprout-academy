import os from 'node:os';
import type http from 'node:http';

function privateHost(host: string): boolean {
  const name = host.split(':')[0];
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(name) || /^[a-zA-Z0-9-]+\.local$/.test(name);
}

/** Best-effort LAN URL for pairing. Explicit PUBLIC_URL wins; Host is used only
 * when it is a private LAN name/IP, never for arbitrary public Host headers. */
export function pairingBaseUrl(req: http.IncomingMessage, configured: string): string {
  const explicit = configured.replace(/\/$/, '');
  if (explicit && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(explicit)) return explicit;
  const forwarded = String(req.headers['x-forwarded-proto'] || '');
  const proto = forwarded === 'https' || forwarded === 'http'
    ? forwarded
    : (req.socket as unknown as { encrypted?: boolean }).encrypted ? 'https' : 'http';
  const host = String(req.headers.host || '');
  if (host && privateHost(host) && !/[^a-zA-Z0-9.:\-\[\]]/.test(host)) return `${proto}://${host}`;
  const port = process.env.PORT || '8080';
  const candidates: { name: string; address: string }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal && privateHost(item.address)) candidates.push({ name, address: item.address });
    }
  }
  const preferred = candidates.find(c => /^(en0|en1|eth0|wlan0|Wi-Fi|Ethernet)$/i.test(c.name));
  const chosen = preferred || candidates[0];
  return `${proto}://${chosen?.address || 'localhost'}:${port}`;
}
