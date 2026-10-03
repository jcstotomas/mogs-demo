import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

const START_TIMEOUT_MS = 10_000;
type RuntimeState = { child: ChildProcess | null; starting: Promise<string> | null; origin: string | null; hooks: boolean };
const globals = globalThis as typeof globalThis & { mogsMultichannelRuntime?: RuntimeState };
const state = globals.mogsMultichannelRuntime ??= { child: null, starting: null, origin: null, hooks: false };

export const multichannelEnabled = () => process.env.MOGS_MULTICHANNEL_ENABLED === '1';

function configuration() {
  const port = Number(process.env.MOGS_LAB_PORT ?? 3220);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('The multichannel port must be between 1024 and 65535.');
  const storage = process.env.MOGS_LAB_STORAGE ?? 'main-campaign-demo';
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(storage)) throw new Error('The multichannel storage name is invalid.');
  return { port, storage };
}

/** The lab receives no launch, GitHub, hosting, or database configuration. */
export function labEnvironment(port: number, storage: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? 'production' };
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'MOGS_LAB_PYTHON', 'MOGS_LAB_PDFTOPPM', 'MOGS_LAB_TESSERACT', 'MOGS_LAB_MODEL']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  env.MOGS_MULTICHANNEL_ENABLED = '1';
  env.MOGS_LAB_PORT = String(port);
  env.MOGS_LAB_STORAGE = storage;
  const key = process.env.MOGS_LAB_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (key) env.MOGS_LAB_ANTHROPIC_API_KEY = key;
  return env;
}

export async function stopLabRuntime(): Promise<void> {
  const child = state.child;
  state.child = null;
  state.starting = null;
  state.origin = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => {
    const force = setTimeout(() => child.kill('SIGKILL'), 2_000);
    force.unref();
    child.once('close', () => { clearTimeout(force); resolve(); });
    child.kill('SIGTERM');
  });
}

function installCleanup() {
  if (state.hooks) return;
  state.hooks = true;
  process.once('exit', () => { state.child?.kill('SIGTERM'); });
  process.once('SIGINT', () => { void stopLabRuntime(); });
  process.once('SIGTERM', () => { void stopLabRuntime(); });
}

/** Spawn lazily, and trust only the listening event from the child we own. */
export async function labOrigin(): Promise<string> {
  if (!multichannelEnabled()) throw new Error('Multichannel review is disabled.');
  if (state.child && state.child.exitCode === null && state.child.signalCode === null && state.origin) return state.origin;
  if (state.starting) return state.starting;
  const { port, storage } = configuration();
  const packageRoot = path.join(process.cwd(), 'experiments', 'multichannel-lab');
  installCleanup();
  const child = spawn(process.execPath, ['src/server.ts'], {
    cwd: packageRoot, env: labEnvironment(port, storage), stdio: ['ignore', 'pipe', 'pipe'],
  });
  state.child = child;
  const origin = `http://127.0.0.1:${port}`;
  state.starting = new Promise<string>((resolve, reject) => {
    let settled = false, output = '';
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      if (error) {
        child.kill('SIGTERM');
        if (state.child === child) { state.child = null; state.origin = null; }
        reject(error);
      } else { state.origin = origin; resolve(origin); }
    };
    const onData = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-2_000);
      if (output.includes(`MOGS multichannel lab: ${origin} (enabled)`)) finish();
    };
    const timer = setTimeout(() => finish(new Error('Multichannel review did not start. Check its local port and Node runtime.')), START_TIMEOUT_MS);
    child.stdout?.on('data', onData);
    // Drain output without forwarding provider or local configuration details.
    child.stderr?.on('data', () => {});
    child.once('error', () => finish(new Error('Multichannel review could not start. Check its local package and Node runtime.')));
    child.once('close', () => {
      finish(new Error('Multichannel review stopped before it was ready. Its local port may already be in use.'));
      if (state.child === child) { state.child = null; state.origin = null; }
    });
  });
  try {
    const ready = await state.starting;
    if (!multichannelEnabled()) { await stopLabRuntime(); throw new Error('Multichannel review is disabled.'); }
    return ready;
  } finally { state.starting = null; }
}
