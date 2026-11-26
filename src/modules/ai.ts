import type { Db } from '../infra/db.ts';
import { config } from '../config.ts';
import { AppError, tooMany, upstream } from '../core/errors.ts';
import { newId, nowIso, openSecret } from '../core/security.ts';

export type ModelSelection = {
  provider: string; model: string; baseUrl: string; apiKey: string;
  source: 'env' | 'database' | 'none'; name: string;
};

export type AiMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
};

export type AiTool = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type AiResult = {
  content: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  usage: { prompt: number; completion: number };
  model: string;
  engine: 'llm' | 'local-rules';
};

export function resolveModel(db: Db, ref?: string): ModelSelection {
  const explicit = ref && ref !== 'default' && ref !== 'env'
    ? db.get<{ id: string; name: string; provider: string; base_url: string; model: string; api_key_enc: string | null }>(
      'SELECT * FROM model_configs WHERE id = ? OR name = ? LIMIT 1', [ref, ref],
    )
    : undefined;
  const row = explicit || db.get<{ id: string; name: string; provider: string; base_url: string; model: string; api_key_enc: string | null }>(
    'SELECT * FROM model_configs WHERE is_default = 1 ORDER BY created_at DESC LIMIT 1',
  );
  if (row) {
    return {
      provider: row.provider, model: row.model, baseUrl: row.base_url.replace(/\/$/, ''),
      apiKey: openSecret(row.api_key_enc), source: 'database', name: row.name,
    };
  }
  if (config.ai.apiKey) {
    return {
      provider: config.ai.provider, model: config.ai.model, baseUrl: config.ai.baseUrl,
      apiKey: config.ai.apiKey, source: 'env', name: '默认模型（环境变量）',
    };
  }
  return { provider: 'none', model: 'local-rules', baseUrl: '', apiKey: '', source: 'none', name: '星芽本地规则引擎' };
}

export function aiConfigured(db: Db): boolean {
  return resolveModel(db).apiKey.length > 0;
}

export function recordAiUsage(db: Db, householdId: string, kind: string): void {
  db.run('INSERT INTO ai_usage(id, household_id, kind, created_at) VALUES(?,?,?,?)', [newId(), householdId, kind, nowIso()]);
}

export function assertAiQuota(db: Db, householdId: string, limit = Number(process.env.AI_DAILY_LIMIT || 120)): void {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const row = db.get<{ c: number }>('SELECT COUNT(*) AS c FROM ai_usage WHERE household_id = ? AND created_at >= ?', [householdId, since]);
  if ((row?.c ?? 0) >= limit) throw tooMany('今日 AI 使用次数已达上限，明天再来或联系管理员');
}

export type ChatOptions = {
  messages: AiMessage[];
  modelRef?: string;
  tools?: AiTool[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

export async function chat(db: Db, opts: ChatOptions): Promise<AiResult> {
  const selection = resolveModel(db, opts.modelRef);
  if (!selection.apiKey) {
    return { content: '', toolCalls: [], usage: { prompt: 0, completion: 0 }, model: 'local-rules', engine: 'local-rules' };
  }
  const url = `${selection.baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || config.ai.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${selection.apiKey}` },
      body: JSON.stringify({
        model: selection.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.6,
        max_tokens: opts.maxTokens ?? 1400,
        ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw upstream('AI 服务暂时不可用，请稍后重试', { status: response.status, body: text.slice(0, 200) });
    }
    const payload = await response.json() as {
      choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const message = payload.choices?.[0]?.message;
    return {
      content: (message?.content || '').trim(),
      toolCalls: (message?.tool_calls || []).map(call => ({ id: call.id, name: call.function.name, arguments: call.function.arguments })),
      usage: { prompt: payload.usage?.prompt_tokens || 0, completion: payload.usage?.completion_tokens || 0 },
      model: selection.model,
      engine: 'llm',
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw upstream('AI 服务连接超时或失败，请检查网络/密钥配置', {
      reason: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Extract the first JSON object from a model response that may contain prose or code fences. */
export function listModels(db: Db) {
  const dbRows = db.all<{ id: string; name: string; provider: string; base_url: string; model: string; api_key_enc: string | null; is_default: number; created_at: string }>(
    'SELECT * FROM model_configs ORDER BY created_at',
  ).map(row => ({
    id: row.id, name: row.name, provider: row.provider, baseUrl: row.base_url, model: row.model,
    isDefault: !!row.is_default, source: 'database' as const, configured: !!openSecret(row.api_key_enc),
    createdAt: row.created_at,
  }));
  const envRows = config.ai.apiKey ? [{
    id: 'env', name: '环境变量模型', provider: config.ai.provider, baseUrl: config.ai.baseUrl,
    model: config.ai.model, isDefault: !dbRows.some(r => r.isDefault), source: 'env' as const,
    configured: true, createdAt: null,
  }] : [];
  return { models: [...envRows, ...dbRows], localAvailable: true, defaultRef: dbRows.find(r => r.isDefault)?.id || (envRows.length ? 'env' : 'local') };
}

export function extractJson<T = Record<string, unknown>>(text: string): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    } catch {
      continue;
    }
  }
  return null;
}
