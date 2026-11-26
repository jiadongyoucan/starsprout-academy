import type { Router } from '../core/http.ts';
import type { Db } from '../infra/db.ts';
import {
  createSession, deleteMemory, deleteSession, deleteWorkspaceFile, getSession, listMemories, listMessages, listSessions,
  listTools, listWorkspace, postMessage, putWorkspaceFile, runAgentSandbox,
} from '../modules/agent.ts';

export function registerAgentRoutes(router: Router, db: Db): void {
  router.get('/api/agent/sessions', 'user', ctx => listSessions(db, ctx.user!));
  router.post('/api/agent/sessions', 'user', ctx => createSession(db, ctx.user!, ctx.body));
  router.get('/api/agent/sessions/:id', 'user', ctx => getSession(db, ctx.user!, ctx.params.id!));
  router.delete('/api/agent/sessions/:id', 'user', ctx => deleteSession(db, ctx.user!, ctx.params.id!));
  router.get('/api/agent/sessions/:id/messages', 'user', ctx => listMessages(db, ctx.user!, ctx.params.id!));
  router.post('/api/agent/sessions/:id/messages', 'user', async ctx => postMessage(db, ctx.user!, ctx.params.id!, ctx.body),
    { max: 30, windowMs: 5 * 60_000, key: 'agent-chat' });
  router.get('/api/agent/sessions/:id/files', 'user', ctx => listWorkspace(db, ctx.user!, ctx.params.id!));
  router.put('/api/agent/sessions/:id/files', 'user', ctx => putWorkspaceFile(db, ctx.user!, ctx.params.id!, ctx.body));
  router.delete('/api/agent/sessions/:id/files/:fileId', 'user', ctx => deleteWorkspaceFile(db, ctx.user!, ctx.params.id!, ctx.params.fileId!));

  router.get('/api/agent/memory', 'user', ctx => listMemories(db, ctx.user!));
  router.delete('/api/agent/memory/:id', 'user', ctx => deleteMemory(db, ctx.user!, ctx.params.id!));
  router.get('/api/agent/tools', 'user', () => listTools());
  router.post('/api/agent/sandbox', 'user', ctx => runAgentSandbox(db, ctx.user!, ctx.body, ctx.body?.sessionId),
    { max: 20, windowMs: 10 * 60_000, key: 'sandbox' });
}
