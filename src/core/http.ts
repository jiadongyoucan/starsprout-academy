import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { AppError, notFound, tooMany, unauthorized } from './errors.ts';
import { log } from './logger.ts';
import { config } from '../config.ts';
import { createRateLimiter, newId, type RateLimiter } from './security.ts';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: 'parent' | 'teacher' | 'admin' | string;
  householdId: string;
  jti: string;
  mustChangePassword?: boolean;
};
export type AuthDevice = { id: string; name: string; householdId: string };
export type AuthContext = { user: AuthUser | null; device: AuthDevice | null };

export type Ctx = {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  raw: Buffer;
  ip: string;
  requestId: string;
  user: AuthUser | null;
  device: AuthDevice | null;
  json: (data: unknown, status?: number) => void;
  text: (body: string, status?: number) => void;
  redirect: (url: string) => void;
};

export type Access = 'public' | 'user' | 'staff' | 'admin' | 'device';
export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

type Route = {
  method: string;
  segments: string[];
  access: Access;
  handler: Handler;
  rate?: { max: number; windowMs: number; key: string };
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const MAX_BODY = 8 * 1024 * 1024;

function securityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
      "media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
}

async function readBody(req: http.IncomingMessage): Promise<{ body: any; raw: Buffer }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new AppError(413, 'PAYLOAD_TOO_LARGE', '请求内容超过 8MB 限制');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks);
  if (raw.length === 0) return { body: {}, raw };
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (type.includes('application/json')) {
    try {
      return { body: JSON.parse(raw.toString('utf8')), raw };
    } catch {
      throw new AppError(400, 'INVALID_JSON', '请求体不是合法 JSON');
    }
  }
  return { body: raw.toString('utf8'), raw };
}

export class Router {
  private routes: Route[] = [];
  private limiter: RateLimiter;
  private resolveAuth: (token: string) => Promise<AuthContext | null>;

  constructor(resolveAuth: (token: string) => Promise<AuthContext | null>) {
    this.resolveAuth = resolveAuth;
    this.limiter = createRateLimiter();
  }

  add(method: string, pattern: string, access: Access, handler: Handler, rate?: Route['rate']): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: pattern.split('/').filter(Boolean),
      access,
      handler,
      rate,
    });
    this.routes.sort((a, b) => {
      const aStatic = a.segments.filter(s => !s.startsWith(':')).length;
      const bStatic = b.segments.filter(s => !s.startsWith(':')).length;
      return bStatic - aStatic;
    });
    return this;
  }
  get(p: string, a: Access, h: Handler, r?: Route['rate']) { return this.add('GET', p, a, h, r); }
  post(p: string, a: Access, h: Handler, r?: Route['rate']) { return this.add('POST', p, a, h, r); }
  patch(p: string, a: Access, h: Handler, r?: Route['rate']) { return this.add('PATCH', p, a, h, r); }
  put(p: string, a: Access, h: Handler, r?: Route['rate']) { return this.add('PUT', p, a, h, r); }
  del(p: string, a: Access, h: Handler, r?: Route['rate']) { return this.add('DELETE', p, a, h, r); }
  delete(p: string, a: Access, h: Handler, r?: Route['rate']) { return this.add('DELETE', p, a, h, r); }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const started = Date.now();
    const requestId = newId().slice(0, 8);
    securityHeaders(res);
    res.setHeader('X-Request-Id', requestId);

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    const ip = req.socket.remoteAddress || 'unknown';

    const ctx: Ctx = {
      req, res, method: req.method || 'GET', path: pathname,
      params: {}, query: url.searchParams, body: {}, raw: Buffer.alloc(0),
      ip, requestId, user: null, device: null,
      json: (data, status = 200) => sendJson(res, status, { ok: true, data }),
      text: (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(body); },
      redirect: (target) => { res.writeHead(302, { Location: target }); res.end(); },
    };

    try {
      if (!pathname.startsWith('/api/')) {
        await this.serveStatic(pathname, res, req);
        return;
      }

      const matched = this.match(req.method || 'GET', pathname);
      if (!matched) throw notFound('接口不存在');

      const auth = await this.authenticate(req, url);
      ctx.user = auth?.user ?? null;
      ctx.device = auth?.device ?? null;
      ctx.params = matched.params;

      const { route } = matched;
      if (route.access === 'user' || route.access === 'staff' || route.access === 'admin') {
        if (!ctx.user) throw unauthorized();
      }
      if (route.access === 'staff' && !['teacher', 'admin'].includes(ctx.user!.role)) {
        throw new AppError(403, 'FORBIDDEN', '需要教师或管理员权限');
      }
      if (route.access === 'admin' && ctx.user!.role !== 'admin') {
        throw new AppError(403, 'FORBIDDEN', '需要管理员权限');
      }
      if (route.access === 'device' && !ctx.device) {
        throw new AppError(401, 'UNAUTHORIZED', '设备未配对或令牌失效');
      }
      if (route.rate && config.env !== 'test') {
        const key = `${ip}:${route.rate.key}`;
        if (!this.limiter.hit(key, route.rate.max, route.rate.windowMs)) throw tooMany();
      }

      if (ctx.user?.mustChangePassword && !['/api/auth/me', '/api/auth/change-password', '/api/auth/logout', '/api/meta', '/api/health'].includes(pathname)) {
        throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', '请先修改临时密码后再继续使用');
      }

      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(ctx.method)) {
        const parsed = await readBody(req);
        ctx.body = parsed.body;
        ctx.raw = parsed.raw;
      }

      const result = await route.handler(ctx);
      if (result !== undefined && !res.writableEnded) sendJson(res, 200, { ok: true, data: result });
    } catch (error) {
      if (res.writableEnded) return;
      if (error instanceof AppError) {
        sendJson(res, error.status, {
          ok: false,
          error: { code: error.code, message: error.message, details: error.details },
        });
      } else {
        log.error('unhandled_request_error', {
          requestId, path: pathname,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack?.split('\n').slice(0, 4).join(' | ') : undefined,
        });
        sendJson(res, 500, { ok: false, error: { code: 'INTERNAL_ERROR', message: '服务器开小差了，请稍后重试' } });
      }
    } finally {
      log.info('request', {
        requestId, method: req.method, path: pathname,
        status: res.statusCode, ms: Date.now() - started,
      });
    }
  }

  private async authenticate(req: http.IncomingMessage, url: URL): Promise<AuthContext | null> {
    const header = String(req.headers.authorization || '');
    let token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    // EventSource cannot set headers; only the device SSE endpoint accepts a query token.
    if (!token && url.pathname === '/api/device/events') token = url.searchParams.get('token') || '';
    if (!token) return null;
    return this.resolveAuth(token);
  }

  private match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(':')) params[seg.slice(1)] = parts[i];
        else if (seg !== parts[i]) { ok = false; break; }
      }
      if (ok) return { route, params };
    }
    return null;
  }

  private async serveStatic(pathname: string, res: http.ServerResponse, req: http.IncomingMessage): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw notFound();
    let filePath: string | null = null;
    if (pathname === '/') filePath = path.join(config.webDir, 'index.html');
    else if (pathname === '/device' || pathname === '/device/') filePath = path.join(config.webDir, 'device.html');
    else if (pathname === '/docs' || pathname === '/docs/') filePath = path.join(process.cwd(), 'docs', 'index.html');
    else if (/^\/docs\/(?:(?:reviews|e2e)\/)?[a-z0-9-]+\.(?:html|md)$/.test(pathname)) filePath = path.join(process.cwd(), 'docs', pathname.replace(/^\/docs\//, ''));
    else if (/^\/(app|device)\.html$/.test(pathname)) filePath = path.join(config.webDir, pathname.slice(1));
    else if (/^\/(js|assets)\/[A-Za-z0-9._/-]+$/.test(pathname)) filePath = path.join(config.webDir, pathname.slice(1));
    else if (/^\/(styles\.css|theme\.css|device\.css|manifest\.webmanifest|sw\.js|favicon\.svg|icon(?:-[0-9]+)?\.(?:svg|png))$/.test(pathname)) {
      filePath = path.join(config.webDir, pathname.slice(1));
    }
    if (!filePath) throw notFound('页面不存在');

    const resolved = path.resolve(filePath);
    const root = path.resolve(config.webDir);
    const allowedExternal = resolved.startsWith(path.resolve(process.cwd(), 'docs') + path.sep);
    if (!resolved.startsWith(root + path.sep) && !allowedExternal) throw notFound();
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw notFound('页面不存在');

    const ext = path.extname(resolved).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=300';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(await fs.promises.readFile(resolved));
  }
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded) return;
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function createHttpServer(router: Router): http.Server {
  return http.createServer((req, res) => {
    void router.handle(req, res);
  });
}
