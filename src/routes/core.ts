import type { Router } from '../core/http.ts';
import type { Db } from '../infra/db.ts';
import { config } from '../config.ts';
import crypto from 'node:crypto';
import { forbidden, validation } from '../core/errors.ts';
import {
  adjustDemoMode, adminResetPassword, changePassword, listUsers, login, logout, me, register, setUserRole, setupAdmin, setupRequired, updateProfile, verifyPasswordForUser,
} from '../modules/auth.ts';
import {
  childrenView, createChild, deleteChild, deleteHouseholdMemories, disableAccount, eraseHousehold, exportChildData,
  listConsents, setConsent, updateChild,
} from '../modules/privacy.ts';
import { adminOverview, auditLogs, purgeExpiredSnapshots } from '../modules/analytics.ts';
import { communityStats } from '../modules/community.ts';
import { warmthForUser } from '../modules/warmth.ts';
import { approvePackById, publicSources, syncSources } from '../modules/curriculum.ts';
import { aiConfigured, listModels } from '../modules/ai.ts';
import { createModel, deleteModel, setDefaultModel } from '../modules/models.ts';
import { sandboxEnabled } from '../modules/sandbox.ts';
import fs from 'node:fs';
import path from 'node:path';

export function registerCoreRoutes(router: Router, db: Db): void {
  router.get('/api/warmth', 'user', ctx => warmthForUser(db, ctx.user!, ctx.query), { max: 60, windowMs: 10 * 60_000, key: 'warmth' });
  router.get('/api/health', 'public', () => ({
    status: 'ok',
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks: {
      db: !!db.get('SELECT 1 AS ok'),
      lessons: Number(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM lessons')?.c || 0),
      ai: aiConfigured(db) ? 'configured' : 'local-fallback',
    },
  }));

  router.get('/api/meta', 'public', () => {
    const demoMode = adjustDemoMode(db);
    const models = listModels(db);
    return {
      app: { name: '星芽学堂', slogan: '每天 20 分钟，陪孩子长成自己的样子', version: '1.0.0' },
      demoMode,
      setupRequired: setupRequired(db),
      demoAccounts: demoMode ? [
        { role: 'parent', label: '家长', email: config.demo.parent.email, password: config.demo.parent.password },
        { role: 'teacher', label: '教师（可审核）', email: config.demo.teacher.email, password: config.demo.teacher.password },
        { role: 'admin', label: '管理员', email: config.demo.admin.email, password: config.demo.admin.password },
      ] : [],
      ai: {
        configured: models.models.some(m => m.configured),
        defaultRef: models.defaultRef,
        models: models.models.map(m => ({ id: m.id, name: m.name, provider: m.provider, model: m.model, isDefault: m.isDefault, configured: m.configured })),
      },
      features: {
        sandbox: sandboxEnabled(), camera: true, sse: true, offlinePwa: true,
        publicSources: Number(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM public_sources')?.c || 0),
        curriculumLessons: Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM lessons WHERE is_published = 1")?.c || 0),
      },
      policy: {
        version: '2026-01',
        summary: '儿童数据最小化采集；照片需监护人单独授权，默认 30 天自动清理；AI 处理可随时关闭。',
        retentionDays: Number(process.env.SNAPSHOT_RETENTION_DAYS || 30),
      },
      docs: { product: '/docs/product.html', architecture: '/docs/architecture.html', index: '/docs/' },
    };
  });

  router.post('/api/setup', 'public', ctx => {
    const remote = ctx.req.socket.remoteAddress || '';
    const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    const proxied = !!(ctx.req.headers['x-forwarded-for'] || ctx.req.headers['x-real-ip'] || ctx.req.headers.forwarded);
    const token = String(ctx.req.headers['x-setup-token'] || '');
    const mustToken = !local || proxied || config.env === 'production';
    const expected = config.setupToken;
    const tokenOk = !!expected && token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (mustToken && !tokenOk) throw forbidden('首次初始化需要 SETUP_TOKEN（远程部署必填；请查看启动日志或环境变量）');
    return setupAdmin(db, ctx.body);
  }, { max: 5, windowMs: 10 * 60_000, key: 'setup' });
  router.post('/api/auth/register', 'public', ctx => register(db, ctx.body), { max: 8, windowMs: 10 * 60_000, key: 'register' });
  router.post('/api/auth/login', 'public', ctx => login(db, ctx.body), { max: 10, windowMs: 5 * 60_000, key: 'login' });
  router.post('/api/auth/logout', 'user', ctx => logout(db, ctx.user!));
  router.post('/api/auth/verify-password', 'user', ctx => verifyPasswordForUser(db, ctx.user!, ctx.body), { max: 10, windowMs: 10 * 60_000, key: 'verify-password' });
  router.get('/api/auth/me', 'user', ctx => me(db, ctx.user!));
  router.patch('/api/auth/profile', 'user', ctx => updateProfile(db, ctx.user!, ctx.body), { max: 20, windowMs: 10 * 60_000, key: 'profile' });
  router.post('/api/auth/change-password', 'user', ctx => changePassword(db, ctx.user!, ctx.body), { max: 6, windowMs: 10 * 60_000, key: 'password' });

  router.get('/api/children', 'user', ctx => childrenView(db, ctx.user!));
  router.post('/api/children', 'user', ctx => createChild(db, ctx.user!, ctx.body));
  router.patch('/api/children/:id', 'user', ctx => updateChild(db, ctx.user!, ctx.params.id!, ctx.body));
  router.delete('/api/children/:id', 'user', ctx => deleteChild(db, ctx.user!, ctx.params.id!, ctx.body));
  router.get('/api/children/:id/consents', 'user', ctx => listConsents(db, ctx.user!, ctx.params.id!));
  router.put('/api/children/:id/consents/:kind', 'user', ctx => setConsent(db, ctx.user!, ctx.params.id!, ctx.params.kind!, ctx.body));

  router.get('/api/privacy/export', 'user', ctx => exportChildData(db, ctx.user!, String(ctx.query.get('childId') || '')));
  router.delete('/api/privacy/memory', 'user', ctx => deleteHouseholdMemories(db, ctx.user!));
  router.delete('/api/privacy/account', 'user', ctx => disableAccount(db, ctx.user!));
  router.delete('/api/privacy/household', 'user', async ctx => {
    if (ctx.body?.confirm !== true) throw validation('删除家庭数据需要 confirm: true');
    const result = eraseHousehold(db, ctx.user!);
    for (const file of result.files) {
      await fs.promises.unlink(path.join(config.snapshotDir, path.basename(file))).catch(() => {});
    }
    return { deleted: result.deleted, message: '家庭数据已删除，账号已停用。' };
  });
  router.post('/api/privacy/snapshots/purge', 'admin', async ctx => {
    const days = Number(ctx.body?.days ?? 30);
    if (!Number.isFinite(days) || days < 0 || days > 3650) throw validation('保留天数不合法');
    const result = purgeExpiredSnapshots(db, days);
    for (const file of result.files) {
      await fs.promises.unlink(path.join(config.snapshotDir, path.basename(file))).catch(() => {});
    }
    return { ...result, files: undefined };
  });

  router.get('/api/admin/overview', 'admin', () => ({ ...adminOverview(db), community: communityStats(db) }));
  router.get('/api/admin/users', 'admin', () => listUsers(db));
  router.patch('/api/admin/users/:id/role', 'admin', ctx => setUserRole(db, ctx.user!, ctx.params.id!, ctx.body, ctx.ip));
  router.post('/api/admin/users/:id/reset-password', 'admin', ctx => adminResetPassword(db, ctx.user!, ctx.params.id!, ctx.ip));
  router.get('/api/admin/audit', 'admin', ctx => auditLogs(db, Number(ctx.query.get('limit') || 50)));
  router.get('/api/admin/packs', 'admin', () => publicSources(db));
  router.post('/api/admin/sources/sync', 'admin', ctx => syncSources(db, ctx.user!, ctx.ip));
  router.post('/api/admin/packs/:id/approve', 'admin', ctx => approvePackById(db, ctx.user!, ctx.params.id!, ctx.ip));

  router.get('/api/agent/models', 'user', () => listModels(db));
  router.post('/api/admin/models', 'admin', ctx => createModel(db, ctx.user!, ctx.body, ctx.ip));
  router.post('/api/admin/models/:id/default', 'admin', ctx => setDefaultModel(db, ctx.user!, ctx.params.id!));
  router.delete('/api/admin/models/:id', 'admin', ctx => deleteModel(db, ctx.user!, ctx.params.id!));

  router.get('/api/registry/meta', 'user', ctx => ({
    subjects: ['thinking', 'english', 'piano', 'hanzi', 'montessori'],
    classCodes: ['nursery', 'junior', 'middle', 'senior'],
    canPublishPublic: ['teacher', 'admin'].includes(ctx.user!.role),
  }));

  router.get('/api/curriculum/sources', 'user', () => publicSources(db));
}
