import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { forbidden } from '../core/errors.ts';

export type SandboxResult = { status: 'ok' | 'error' | 'timeout' | 'disabled'; output: string; durationMs: number };

/**
 * 沙箱：独立 Node 子进程 + --permission + vm 上下文（不注入宿主对象）。
 * - 子进程无应用环境变量、无文件读写（仅自身脚本）、无子进程 / worker 权限。
 * - 800ms 脚本超时 + 1.5s 硬终止 + 32MB 内存上限。
 * 该实现显著降低 RCE/密钥泄露风险，但仍非虚拟机级硬隔离；
 * 因此必须显式 ENABLE_SANDBOX=true 才启用，生产默认关闭。
 */
export function sandboxEnabled(): boolean {
  return process.env.ENABLE_SANDBOX === 'true';
}

let runnerPath = '';
function resolveRunner(): string {
  if (!runnerPath) runnerPath = fs.realpathSync(fileURLToPath(new URL('./sandbox-runner.ts', import.meta.url)));
  return runnerPath;
}

export async function runSandbox(code: string, timeoutMs = 1500): Promise<SandboxResult> {
  if (!sandboxEnabled()) throw forbidden('沙箱默认关闭；需在服务端显式设置 ENABLE_SANDBOX=true');
  const started = Date.now();
  const runner = resolveRunner();
  return await new Promise<SandboxResult>((resolve) => {
    const child = spawn(process.execPath, [
      '--permission',
      `--allow-fs-read=${runner}`,
      '--max-old-space-size=32',
      runner,
      String(code).slice(0, 20_000),
    ], {
      env: {},
      cwd: os.tmpdir(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: SandboxResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ status: 'timeout', output: `执行超时（>${timeoutMs}ms），已终止沙箱。`, durationMs: Date.now() - started });
    }, timeoutMs);

    child.stdout.on('data', chunk => { if (stdout.length < 64_000) stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { if (stderr.length < 8_000) stderr += chunk.toString(); });
    child.once('error', (error) => {
      finish({ status: 'error', output: `沙箱启动失败：${error.message}`, durationMs: Date.now() - started });
    });
    child.once('close', () => {
      try {
        const parsed = JSON.parse(stdout) as { status: 'ok' | 'error' | 'timeout'; output: string };
        finish({ status: parsed.status, output: parsed.output, durationMs: Date.now() - started });
      } catch {
        finish({
          status: 'error',
          output: `沙箱异常退出。${stderr ? stderr.slice(0, 500) : ''}`.trim(),
          durationMs: Date.now() - started,
        });
      }
    });
  });
}
