import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { Db } from './infra/db.ts';
import { seedDatabase } from './infra/seed.ts';
import { Router, createHttpServer, type AuthContext } from './core/http.ts';
import { sha256, verifyToken } from './core/security.ts';
import { getUserHouseholdId, type UserRow } from './modules/shared.ts';
import { registerCoreRoutes } from './routes/core.ts';
import { registerLearnRoutes } from './routes/learn.ts';
import { registerAgentRoutes } from './routes/agent.ts';
import { registerRegistryRoutes } from './routes/registry.ts';
import { registerCommunityRoutes } from './routes/community.ts';
import { registerDeviceRoutes } from './routes/device.ts';
import { registerPetRoutes } from './routes/pet.ts';

export type BuildOptions = {
  dbFile?: string;
  dataDir?: string;
  seedDemo?: boolean;
};

export type BuiltApp = {
  db: Db;
  router: Router;
  server: ReturnType<typeof createHttpServer>;
  close: () => Promise<void>;
};

export function buildApp(opts: BuildOptions = {}): BuiltApp {
  if (opts.dataDir) {
    const dataDir = path.resolve(opts.dataDir);
    fs.mkdirSync(dataDir, { recursive: true });
    config.dataDir = dataDir;
    config.snapshotDir = path.join(dataDir, 'snapshots');
  }
  fs.mkdirSync(config.snapshotDir, { recursive: true });
  const dbFile = opts.dbFile || config.dbFile;
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new Db(dbFile);
  seedDatabase(db, { demo: opts.seedDemo ?? config.seedDemo });

  const router = new Router(async (token): Promise<AuthContext | null> => {
    const payload = verifyToken(token);
    if (!payload) return null;
    if (payload.typ === 'user') {
      if (!payload.sub || !payload.jti) return null;
      const user = db.get<UserRow>('SELECT * FROM users WHERE id = ? AND disabled = 0', [payload.sub]);
      const session = db.get<{ revoked_at: string | null; expires_at: string }>(
        'SELECT revoked_at, expires_at FROM sessions WHERE id = ? AND user_id = ?', [payload.jti, payload.sub],
      );
      if (!user || !session || session.revoked_at) return null;
      if (new Date(session.expires_at).getTime() < Date.now()) return null;
      const householdId = getUserHouseholdId(db, user.id);
      if (!householdId) return null;
      return {
        user: { id: user.id, name: user.name, email: user.email, role: user.role, householdId, jti: payload.jti, mustChangePassword: !!user.must_change_password },
        device: null,
      };
    }
    if (payload.typ === 'device') {
      if (!payload.did) return null;
      const device = db.get<{ id: string; name: string; household_id: string; token_hash: string | null; status: string }>(
        'SELECT id, name, household_id, token_hash, status FROM devices WHERE id = ?', [payload.did],
      );
      if (!device || device.status !== 'paired' || !device.token_hash) return null;
      if (sha256(token) !== device.token_hash) return null;
      return { user: null, device: { id: device.id, name: device.name, householdId: device.household_id } };
    }
    return null;
  });

  registerCoreRoutes(router, db);
  registerLearnRoutes(router, db);
  registerAgentRoutes(router, db);
  registerRegistryRoutes(router, db);
  registerCommunityRoutes(router, db);
  registerDeviceRoutes(router, db);
  registerPetRoutes(router, db);

  const server = createHttpServer(router);
  return {
    db, router, server,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => {
        db.close();
        if (error) reject(error); else resolve();
      });
    }),
  };
}
