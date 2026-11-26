import vm from 'node:vm';

/**
 * 沙箱子进程入口。
 * 只向 vm 上下文注入由上下文自身创建的 console；不传任何宿主对象 / 函数，
 * 避免 `hostFn.constructor.constructor('return process')()` 这类逃逸。
 * 子进程由 --permission 启动，除自身脚本外无文件系统 / 子进程 / worker 权限。
 */
const code = String(process.argv[2] ?? '').slice(0, 20_000);
const context = vm.createContext(Object.create(null));

const bootstrap = `
  globalThis.__logs = [];
  const format = (value) => {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  };
  globalThis.console = {
    log: (...args) => { __logs.push(args.map(format).join(' ')); },
    info: (...args) => { __logs.push(args.map(format).join(' ')); },
    warn: (...args) => { __logs.push(args.map(format).join(' ')); },
    error: (...args) => { __logs.push(args.map(format).join(' ')); }
  };
`;

try {
  vm.runInContext(bootstrap, context, { timeout: 200 });
  const result = vm.runInContext(code, context, { timeout: 800, displayErrors: true });
  if (result !== undefined) {
    vm.runInContext('console.log', context, { timeout: 100 });
    const logs = context.__logs as string[];
    logs.push(String(result));
  }
  const logs = (context.__logs as string[] | undefined) || [];
  process.stdout.write(JSON.stringify({ status: 'ok', output: logs.join('\n').slice(0, 4000) }));
} catch (error) {
  const logs = (context.__logs as string[] | undefined) || [];
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  logs.push(message);
  const timedOut = /timed out|ERR_SCRIPT_EXECUTION_TIMED_OUT/i.test(message);
  process.stdout.write(JSON.stringify({ status: timedOut ? 'timeout' : 'error', output: logs.join('\n').slice(0, 4000) }));
}
