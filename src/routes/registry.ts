import type { Router } from '../core/http.ts';
import type { Db } from '../infra/db.ts';
import {
  createConnector, createExpert, createSkill, expertDetail, installItem, invocationLogs, invokeConnector,
  listConnectors, listExperts, listSkills, registryQueue, reviewRegistryItem, uninstallItem,
} from '../modules/registry.ts';

export function registerRegistryRoutes(router: Router, db: Db): void {
  router.get('/api/registry/experts', 'user', ctx => listExperts(db, ctx.user!, ctx.query.get('scope')));
  router.post('/api/registry/experts', 'user', ctx => createExpert(db, ctx.user!, ctx.body, ctx.ip));
  router.get('/api/registry/experts/:id', 'user', ctx => expertDetail(db, ctx.user!, ctx.params.id!));

  router.get('/api/registry/skills', 'user', ctx => listSkills(db, ctx.user!, ctx.query.get('scope')));
  router.post('/api/registry/skills', 'user', ctx => createSkill(db, ctx.user!, ctx.body, ctx.ip));

  router.get('/api/registry/connectors', 'user', ctx => listConnectors(db, ctx.user!));
  router.get('/api/registry/connectors/invocations', 'user', ctx => invocationLogs(db, ctx.user!));
  router.post('/api/registry/connectors', 'user', ctx => createConnector(db, ctx.user!, ctx.body, ctx.ip));
  router.post('/api/registry/connectors/:id/invoke', 'user', async ctx => invokeConnector(db, ctx.user!, ctx.params.id!, ctx.body),
    { max: 30, windowMs: 60_000, key: 'connector-invoke' });

  router.post('/api/registry/:type/:id/install', 'user', ctx => {
    const type = ctx.params.type === 'experts' ? 'expert' : ctx.params.type === 'skills' ? 'skill' : ctx.params.type === 'connectors' ? 'connector' : '';
    if (!type) throw new Error('资源类型不正确');
    return installItem(db, ctx.user!, type as 'expert' | 'skill' | 'connector', ctx.params.id!);
  });
  router.delete('/api/registry/:type/:id/install', 'user', ctx => {
    const type = ctx.params.type === 'experts' ? 'expert' : ctx.params.type === 'skills' ? 'skill' : ctx.params.type === 'connectors' ? 'connector' : '';
    if (!type) throw new Error('资源类型不正确');
    return uninstallItem(db, ctx.user!, type, ctx.params.id!);
  });

  router.get('/api/admin/registry/queue', 'staff', ctx => registryQueue(db, ctx.query.get('type')));
  router.post('/api/admin/registry/:type/:id/review', 'staff', ctx => {
    const raw = ctx.params.type!;
    const type = raw === 'experts' ? 'expert' : raw === 'skills' ? 'skill' : raw === 'connectors' ? 'connector' : raw;
    return reviewRegistryItem(db, ctx.user!, type, ctx.params.id!, ctx.body);
  });
}
