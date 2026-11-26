const TOKEN_KEY = 'starsprout.token';
const CHILD_KEY = 'starsprout.child';

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const session = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  user: null,
  household: null,
  children: [],
  currentChildId: localStorage.getItem(CHILD_KEY) || '',
};

export function saveSession(data) {
  if (data?.token) {
    session.token = data.token;
    localStorage.setItem(TOKEN_KEY, data.token);
  }
  if (data?.user) session.user = data.user;
  if (data?.household) session.household = data.household;
  if (data?.children) session.children = data.children;
  if (session.children.length && !session.children.some(c => c.id === session.currentChildId)) {
    setCurrentChild(session.children[0].id);
  }
}

export function setSessionFromMe(data) {
  session.user = data.user;
  session.household = data.household;
  session.children = data.children || [];
  if (session.children.length && !session.children.some(c => c.id === session.currentChildId)) {
    setCurrentChild(session.children[0].id);
  }
}

export function setCurrentChild(id) {
  session.currentChildId = id;
  localStorage.setItem(CHILD_KEY, id);
}

export function currentChild() {
  return session.children.find(c => c.id === session.currentChildId) || session.children[0] || null;
}

export function childClassLabel(code) {
  const map = { nursery: '托班', junior: '小班', middle: '中班', senior: '大班' };
  return map[code] || code || '';
}

export function clearSession() {
  session.token = '';
  session.user = null;
  session.household = null;
  session.children = [];
  localStorage.removeItem(TOKEN_KEY);
}

export async function request(path, options = {}) {
  const { method = 'GET', body, headers = {}, signal } = options;
  const finalHeaders = { ...headers };
  if (session.token) finalHeaders.authorization = `Bearer ${session.token}`;
  if (body !== undefined) finalHeaders['content-type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('网络连接失败，请检查网络后重试', 0, 'NETWORK');
  }
  let payload = null;
  const text = await response.text();
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok || payload?.ok === false) {
    if (response.status === 401 && session.token) {
      clearSession();
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    const err = payload?.error || {};
    throw new ApiError(err.message || `请求失败（${response.status}）`, response.status, err.code, err.details);
  }
  return payload?.data;
}

export async function blob(path) {
  const response = await fetch(path, { headers: session.token ? { authorization: `Bearer ${session.token}` } : {} });
  if (!response.ok) throw new ApiError('文件加载失败', response.status, 'BLOB');
  return response.blob();
}

export async function refreshMe() {
  const data = await request('/api/auth/me');
  setSessionFromMe(data);
  return data;
}

export async function bootstrap() {
  if (!session.token) return false;
  try {
    await refreshMe();
    return true;
  } catch {
    return false;
  }
}

export function logoutLocal() {
  clearSession();
}
