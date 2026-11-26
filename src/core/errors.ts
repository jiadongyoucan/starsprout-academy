export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = '请求参数有误', details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = '请先登录') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = '没有权限访问该资源') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = '资源不存在') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'CONFLICT', message, details);
export const validation = (message: string, details?: unknown) =>
  new AppError(422, 'VALIDATION_ERROR', message, details);
export const tooMany = (message = '操作过于频繁，请稍后再试') => new AppError(429, 'RATE_LIMITED', message);
export const upstream = (message = '外部服务暂不可用', details?: unknown) =>
  new AppError(502, 'UPSTREAM_ERROR', message, details);
