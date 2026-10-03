import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const port = Number(process.env.MOGS_DEMO_PORT ?? 3110);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('MOGS_DEMO_PORT must be between 1024 and 65535.');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('The campaign demo requires Node 24 or newer.');
const buildDirectory = '.next/campaign-demo';
if (!existsSync(path.join(process.cwd(), buildDirectory, 'BUILD_ID'))) {
  process.stderr.write('Build the campaign demo first: MOGS_BUILD_DIR=.next/campaign-demo npm run build\n');
  process.exitCode = 1;
} else {
  // This explicit local launcher opts into multichannel review; ordinary startup stays off.
  const child = spawn(process.execPath, [path.join(process.cwd(), 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(), env: { ...process.env, MOGS_MULTICHANNEL_ENABLED: '1', MOGS_BUILD_DIR: buildDirectory, MOGS_LAB_STORAGE: process.env.MOGS_LAB_STORAGE ?? 'main-campaign-demo' },
    stdio: 'inherit', detached: process.platform !== 'win32',
  });
  let stopping = false;
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    try { if (process.platform === 'win32') child.kill(signal); else if (child.pid) process.kill(-child.pid, signal); } catch {}
    const force = setTimeout(() => { try { if (process.platform === 'win32') child.kill('SIGKILL'); else if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5_000);
    force.unref();
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('exit', () => { try { if (process.platform === 'win32') child.kill('SIGTERM'); else if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch {} });
  child.once('error', () => { process.stderr.write('The local demo could not start.\n'); process.exitCode = 1; });
  child.once('close', code => { process.exitCode = stopping ? 0 : code ?? 1; });
}
