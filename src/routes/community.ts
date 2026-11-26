import type { Router } from '../core/http.ts';
import type { Db } from '../infra/db.ts';
import {
  addComment, deletePost, getPost, listFeed, listReportsForAdmin, moderationQueue, myPosts,
  reportPost, resolveReport, reviewPost, communityStats, submitPost, toggleLike, updatePost,
} from '../modules/community.ts';

export function registerCommunityRoutes(router: Router, db: Db): void {
  router.get('/api/community/feed', 'user', ctx => listFeed(db, ctx.user!, ctx.query));
  router.get('/api/community/mine', 'user', ctx => myPosts(db, ctx.user!));
  router.post('/api/community/posts', 'user', ctx => submitPost(db, ctx.user!, ctx.body), { max: 10, windowMs: 10 * 60_000, key: 'post-create' });
  router.get('/api/community/posts/:id', 'user', ctx => getPost(db, ctx.user!, ctx.params.id!));
  router.patch('/api/community/posts/:id', 'user', ctx => updatePost(db, ctx.user!, ctx.params.id!, ctx.body));
  router.delete('/api/community/posts/:id', 'user', ctx => deletePost(db, ctx.user!, ctx.params.id!));
  router.post('/api/community/posts/:id/like', 'user', ctx => toggleLike(db, ctx.user!, ctx.params.id!));
  router.post('/api/community/posts/:id/comments', 'user', ctx => addComment(db, ctx.user!, ctx.params.id!, ctx.body));
  router.post('/api/community/posts/:id/report', 'user', ctx => reportPost(db, ctx.user!, ctx.params.id!, ctx.body));

  router.get('/api/admin/community/queue', 'staff', ctx => moderationQueue(db, ctx.user!, ctx.query.get('status')));
  router.post('/api/admin/community/posts/:id/review', 'staff', ctx => reviewPost(db, ctx.user!, ctx.params.id!, ctx.body));
  router.get('/api/admin/community/reports', 'staff', ctx => listReportsForAdmin(db));
  router.post('/api/admin/community/reports/:id/resolve', 'staff', ctx => resolveReport(db, ctx.user!, ctx.params.id!, ctx.body));
  router.get('/api/admin/community/stats', 'staff', () => communityStats(db));
}
