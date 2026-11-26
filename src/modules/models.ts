import type { Db } from '../infra/db.ts';
import { forbidden, notFound, validation } from '../core/errors.ts';
import { newId, nowIso, sealSecret } from '../core/security.ts';
import { bool, str } from '../core/validate.ts';
import type { AuthUser } from '../core/http.ts';
import { audit } from './shared.ts';
import { listModels } from './ai.ts';

export function createModel(db: Db, actor: AuthUser, body: any, ip?: string) {
  if (actor.role !== 'admin') throw forbidden('只有管理员可以配置模型');
  const name = str(body?.name, { label: '配置名称', min: 2, max: 40 });
  const provider = str(body?.provider, { label: '供应商', min: 2, max: 40 });
  let baseUrl: string;
  try {
    const parsed = new URL(str(body?.baseUrl, { label: 'API 地址', min: 8, max: 300 }));
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    baseUrl = parsed.toString().replace(/\/$/, '');
  } catch {
    throw validation('API 地址必须是合法的 HTTP(S) URL');
  }
  const model = str(body?.model, { label: '模型名', min: 1, max: 80, pattern: /^[A-Za-z0-9._:/-]+$/ });
  const apiKey = str(body?.apiKey, { optional: true, max: 300, label: 'API Key' });
  const makeDefault = bool(body?.isDefault, false);
  const id = newId();
  db.tx(() => {
    if (makeDefault) db.run('UPDATE model_configs SET is_default = 0');
    db.run(
      `INSERT INTO model_configs(id, name, provider, base_url, model, api_key_enc, is_default, created_by, created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [id, name, provider, baseUrl, model, apiKey ? sealSecret(apiKey) : null, makeDefault ? 1 : 0, actor.id, nowIso()],
    );
    audit(db, { actorId: actor.id, action: 'admin.model.create', entity: 'model', entityId: id, detail: { provider, model, makeDefault }, ip });
  });
  return { id, ...listModels(db) };
}

export function setDefaultModel(db: Db, actor: AuthUser, modelId: string) {
  if (actor.role !== 'admin') throw forbidden('只有管理员可以配置模型');
  const model = db.get<{ id: string }>('SELECT id FROM model_configs WHERE id = ?', [modelId]);
  if (!model) throw notFound('模型配置不存在');
  db.tx(() => {
    db.run('UPDATE model_configs SET is_default = 0');
    db.run('UPDATE model_configs SET is_default = 1 WHERE id = ?', [modelId]);
    audit(db, { actorId: actor.id, action: 'admin.model.default', entity: 'model', entityId: modelId });
  });
  return { ok: true };
}

export function deleteModel(db: Db, actor: AuthUser, modelId: string) {
  if (actor.role !== 'admin') throw forbidden('只有管理员可以配置模型');
  const model = db.get<{ id: string }>('SELECT id FROM model_configs WHERE id = ?', [modelId]);
  if (!model) throw notFound('模型配置不存在');
  db.run('DELETE FROM model_configs WHERE id = ?', [modelId]);
  audit(db, { actorId: actor.id, action: 'admin.model.delete', entity: 'model', entityId: modelId });
  return { deleted: true };
}
