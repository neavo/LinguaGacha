import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { execa } from 'execa';
import getPort, { portNumbers } from 'get-port';
import waitOn from 'wait-on';

const CORE_API_HOST = '127.0.0.1';
const CORE_API_PORT_RANGE_START = 49152;
const CORE_API_PORT_RANGE_END = 65535;
const CORE_API_ENV_NAME = 'LINGUAGACHA_CORE_API_BASE_URL';
const CORE_API_STARTUP_RETRY_LIMIT = 3;
const CORE_API_HEALTH_PATH = '/api/health';
const CORE_API_HEALTH_TIMEOUT_MS = 20_000;
const CORE_API_HEALTH_INTERVAL_MS = 250;
const CORE_API_HTTP_TIMEOUT_MS = 1_000;
const CORE_API_RETRY_DELAY_MS = 500;
const FORCED_KILL_DELAY_MS = 5_000;

/** @type {import('execa').ResultPromise | null} */
let coreProcess = null;
/** @type {import('execa').ResultPromise | null} */
let electronProcess = null;
let isCleaningUp = false;

function buildCoreApiBaseUrl(port) {
  return `http://${CORE_API_HOST}:${port.toString()}`;
}

function buildSpawnEnv(baseUrl) {
  return {
    ...process.env,
    [CORE_API_ENV_NAME]: baseUrl,
  };
}

function buildHealthCheckResource(baseUrl) {
  const { port } = new URL(baseUrl);
  return `http-get://${CORE_API_HOST}:${port}${CORE_API_HEALTH_PATH}`;
}

function buildRandomizedPortCandidates() {
  const candidates = Array.from(
    portNumbers(CORE_API_PORT_RANGE_START, CORE_API_PORT_RANGE_END),
  );

  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const currentPort = candidates[index];
    candidates[index] = candidates[randomIndex];
    candidates[randomIndex] = currentPort;
  }

  return candidates;
}

async function selectCoreApiBaseUrl() {
  // 端口选择发生在 Electron 启动前，避免窗口先起来再等待后端。
  const port = await getPort({
    host: CORE_API_HOST,
    port: buildRandomizedPortCandidates(),
  });
  return buildCoreApiBaseUrl(port);
}

function startCoreProcess(baseUrl) {
  return execa('uv', ['--project', '..', 'run', '../app.py'], {
    cleanup: true,
    cwd: process.cwd(),
    env: buildSpawnEnv(baseUrl),
    forceKillAfterDelay: FORCED_KILL_DELAY_MS,
    reject: false,
    stdio: 'inherit',
  });
}

function startElectronProcess(baseUrl) {
  return execa('electron-vite', ['dev'], {
    cleanup: true,
    cwd: process.cwd(),
    env: buildSpawnEnv(baseUrl),
    forceKillAfterDelay: FORCED_KILL_DELAY_MS,
    preferLocal: true,
    reject: false,
    stdio: 'inherit',
  });
}

async function stopProcess(subprocess) {
  if (subprocess === null) {
    return;
  }

  if (subprocess.exitCode === undefined) {
    subprocess.kill();
  }

  try {
    await subprocess;
  } catch {
    return;
  }
}

async function cleanupProcesses() {
  if (isCleaningUp) {
    return;
  }

  isCleaningUp = true;
  const currentElectronProcess = electronProcess;
  const currentCoreProcess = coreProcess;
  electronProcess = null;
  coreProcess = null;

  await stopProcess(currentElectronProcess);
  await stopProcess(currentCoreProcess);
}

function installSignalHandlers() {
  /** @param {'SIGINT' | 'SIGTERM'} signal */
  const handleSignal = async (signal) => {
    console.log(`\n[dev] 收到 ${signal}，正在关闭开发环境...`);
    await cleanupProcesses();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  process.once('SIGINT', () => {
    void handleSignal('SIGINT');
  });
  process.once('SIGTERM', () => {
    void handleSignal('SIGTERM');
  });
}

async function waitForCoreReady(baseUrl, subprocess) {
  const healthCheckPromise = waitOn({
    httpTimeout: CORE_API_HTTP_TIMEOUT_MS,
    interval: CORE_API_HEALTH_INTERVAL_MS,
    resources: [buildHealthCheckResource(baseUrl)],
    timeout: CORE_API_HEALTH_TIMEOUT_MS,
    tcpTimeout: CORE_API_HTTP_TIMEOUT_MS,
  }).then(() => {
    return { type: 'ready' };
  }).catch((error) => {
    return { type: 'health_error', error };
  });

  const processExitPromise = subprocess.then((result) => {
    return { type: 'process_exit', result };
  });

  return Promise.race([healthCheckPromise, processExitPromise]);
}

async function startCoreWithRetry() {
  let lastError = new Error('Python Core 启动失败。');

  for (let attempt = 1; attempt <= CORE_API_STARTUP_RETRY_LIMIT; attempt += 1) {
    const baseUrl = await selectCoreApiBaseUrl();
    console.log(`[dev] 第 ${attempt} 次尝试启动 Python Core：${baseUrl}`);

    coreProcess = startCoreProcess(baseUrl);
    const readinessResult = await waitForCoreReady(baseUrl, coreProcess);

    if (readinessResult.type === 'ready') {
      console.log(`[dev] Python Core 已就绪：${baseUrl}`);
      return { baseUrl, subprocess: coreProcess };
    }

    if (readinessResult.type === 'process_exit') {
      const exitCode = readinessResult.result.exitCode;
      lastError = new Error(
        `Python Core 在健康检查通过前退出，退出码：${exitCode === null ? 'null' : exitCode.toString()}`,
      );
    } else {
      lastError = new Error(
        `等待 Python Core 健康检查超时：${baseUrl}`,
        { cause: readinessResult.error },
      );
    }

    await stopProcess(coreProcess);
    coreProcess = null;

    if (attempt < CORE_API_STARTUP_RETRY_LIMIT) {
      console.warn(`[dev] ${lastError.message}，准备重试...`);
      await delay(CORE_API_RETRY_DELAY_MS);
    }
  }

  throw lastError;
}

async function run() {
  installSignalHandlers();

  const { baseUrl, subprocess } = await startCoreWithRetry();
  coreProcess = subprocess;

  console.log(`[dev] 启动 Electron 开发环境，Core API 地址：${baseUrl}`);
  electronProcess = startElectronProcess(baseUrl);

  const firstExit = await Promise.race([
    coreProcess.then((result) => {
      return { name: 'core', result };
    }),
    electronProcess.then((result) => {
      return { name: 'electron', result };
    }),
  ]);

  if (firstExit.name === 'electron') {
    await cleanupProcesses();
    const exitCode = firstExit.result.exitCode ?? 0;
    process.exit(exitCode);
  }

  console.error('[dev] Python Core 提前退出，正在关闭 Electron 开发环境。');
  await cleanupProcesses();
  const exitCode = firstExit.result.exitCode;
  process.exit(exitCode === 0 || exitCode === null ? 1 : exitCode);
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : '开发态启动失败。';
  console.error(`[dev] ${message}`);
  await cleanupProcesses();
  process.exit(1);
}
