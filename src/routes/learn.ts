import type { Router } from '../core/http.ts';
import type { Db } from '../infra/db.ts';
import {
  childCurriculumSnapshot, frameworkDetail, getLesson, listFrameworks, saveProgress, searchLessons,
} from '../modules/curriculum.ts';
import {
  activatePlan, correctPlan, createManualPlan, dispatchDueReminders, dueReminders, generatePlan, listPlans, planDetail,
  updateItemStatus, updatePlanStatus, upcomingReminders,
} from '../modules/plans.ts';
import { dashboard, generateReport, listReports } from '../modules/analytics.ts';
import { resolveChildId } from '../modules/shared.ts';

export function registerLearnRoutes(router: Router, db: Db): void {
  router.get('/api/curriculum/overview', 'user', ctx => childCurriculumSnapshot(db, ctx.user!, ctx.query.get('childId')));
  router.get('/api/curriculum/search', 'user', ctx => searchLessons(db, String(ctx.query.get('q') || '').trim() || '课', 8));

  router.get('/api/curriculum/frameworks', 'user', ctx => {
    const childId = resolveChildId(db, ctx.user!, ctx.query.get('childId'));
    return listFrameworks(db, {
      classCode: ctx.query.get('classCode') || undefined,
      subjectCode: ctx.query.get('subjectCode') || undefined,
      childId,
    });
  });

  router.get('/api/curriculum/frameworks/:id', 'user', ctx => frameworkDetail(db, ctx.user!, ctx.params.id!, ctx.query.get('childId')));
  router.get('/api/curriculum/lessons/:id', 'user', ctx => getLesson(db, ctx.user!, ctx.params.id!, ctx.query.get('childId')));
  router.post('/api/curriculum/lessons/:id/progress', 'user', ctx => saveProgress(db, ctx.user!, ctx.params.id!, ctx.body));

  router.get('/api/plans', 'user', ctx => listPlans(db, ctx.user!, ctx.query.get('childId')));
  router.post('/api/plans/generate', 'user', async ctx => generatePlan(db, ctx.user!, ctx.body, ctx.ip), { max: 12, windowMs: 10 * 60_000, key: 'plan-generate' });
  router.post('/api/plans/manual', 'user', ctx => createManualPlan(db, ctx.user!, ctx.body, ctx.ip));
  router.get('/api/plans/:id', 'user', ctx => planDetail(db, ctx.user!, ctx.params.id!));
  router.patch('/api/plans/:id', 'user', ctx => updatePlanStatus(db, ctx.user!, ctx.params.id!, ctx.body));
  router.post('/api/plans/:id/activate', 'user', ctx => activatePlan(db, ctx.user!, ctx.params.id!, ctx.ip));
  router.post('/api/plans/:id/correct', 'user', ctx => correctPlan(db, ctx.user!, ctx.params.id!, ctx.body));
  router.patch('/api/plans/:id/items/:itemId', 'user', ctx => updateItemStatus(db, ctx.user!, ctx.params.id!, ctx.params.itemId!, ctx.body));
  router.get('/api/reminders/upcoming', 'user', ctx => upcomingReminders(db, ctx.user!));
  router.get('/api/reminders/due', 'user', ctx => dueReminders(db, ctx.user!));
  router.post('/api/reminders/dispatch', 'user', ctx => dispatchDueReminders(db, ctx.user!));

  router.get('/api/analytics/dashboard', 'user', ctx => dashboard(db, ctx.user!, ctx.query.get('childId'), ctx.query.get('range')));
  router.get('/api/analytics/reports', 'user', ctx => listReports(db, ctx.user!, ctx.query.get('childId')));
  router.post('/api/analytics/reports', 'user', async ctx => generateReport(db, ctx.user!, ctx.body), { max: 20, windowMs: 10 * 60_000, key: 'report' });
}
