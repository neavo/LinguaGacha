import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BackendBootstrapOptions } from "../backend/bootstrap/backend-bootstrap-types";
import type { BackendBootstrapStartResult } from "../backend/bootstrap/backend-bootstrap-types";
import type { BackendWorkerExecution } from "../backend/worker/worker-execution";
import type { CLICommandOptions } from "./cli-parser";

type FakeBackendServices = { marker: "backend-services" };
type RunCliJobCall = {
  backendServices: FakeBackendServices;
  command: CLICommandOptions;
  options: Record<string, unknown>;
};

const MOCK_MODULES = [
  "electron",
  "../backend/bootstrap/backend-bootstrap",
  "./job/cli-job-runner",
  "./cli-output",
] as const;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const module_id of MOCK_MODULES) {
    vi.doUnmock(module_id);
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("run_cli_command", () => {
  it("等待 Electron ready 后注入系统代理解析器并执行 CLI job", async () => {
    const harness = create_runner_harness();
    const { run_cli_command } = await import("./cli-runner");

    await run_cli_command("E:/App", create_translate_command(), { kind: "in_process" });

    expect(harness.calls.events).toEqual(["ready", "bootstrap", "start", "job", "stop"]);
    expect(harness.calls.backend_bootstrap_options).toHaveLength(1);
    expect(harness.calls.backend_bootstrap_options[0]).toMatchObject({
      appRoot: "E:/App",
      exposeApiGateway: false,
      logTargets: { console: false, window: false },
      workerExecution: { kind: "in_process" } satisfies BackendWorkerExecution,
    });
    await expect(
      harness.calls.backend_bootstrap_options[0]?.systemProxyResolver?.resolveProxy(
        "https://api.example/v1",
      ),
    ).resolves.toBe("DIRECT");
    expect(harness.calls.proxy_resolve_urls).toEqual(["https://api.example/v1"]);
    expect(harness.calls.run_cli_jobs).toHaveLength(1);
    expect(harness.calls.run_cli_jobs[0]?.backendServices).toBe(harness.backend_services);
    expect(harness.calls.run_cli_jobs[0]?.command.command).toBe("translate");
    expect(harness.calls.stderr_lines).toEqual([]);
  });

  it("检测到系统代理时只向 stderr 输出启动提示", async () => {
    const harness = create_runner_harness({
      systemProxyStartupNotice: {
        detected: true,
        proxiedOriginCount: 1,
        proxyDisplay: "http://127.0.0.1:7890",
      },
    });
    const { run_cli_command } = await import("./cli-runner");

    await run_cli_command("E:/App", create_translate_command(), { kind: "in_process" });

    expect(harness.calls.events).toEqual(["ready", "bootstrap", "start", "stderr", "job", "stop"]);
    expect(harness.calls.stderr_lines).toEqual(["检查到系统代理设置 - http://127.0.0.1:7890"]);
    expect(harness.calls.stdout_lines).toEqual([]);
  });
});

/**
 * 搭建 CLI runner 测试夹具，用假的 Electron、BackendBootstrap 和 job 观察入口编排。
 */
function create_runner_harness(options: Partial<BackendBootstrapStartResult> = {}): {
  backend_services: FakeBackendServices;
  calls: {
    backend_bootstrap_options: BackendBootstrapOptions[];
    events: string[];
    proxy_resolve_urls: string[];
    run_cli_jobs: RunCliJobCall[];
    stderr_lines: string[];
    stdout_lines: string[];
  };
} {
  const backend_services: FakeBackendServices = { marker: "backend-services" };
  const calls = {
    backend_bootstrap_options: [] as BackendBootstrapOptions[],
    events: [] as string[],
    proxy_resolve_urls: [] as string[],
    run_cli_jobs: [] as RunCliJobCall[],
    stderr_lines: [] as string[],
    stdout_lines: [] as string[],
  };

  class FakeBackendBootstrap {
    private readonly options: BackendBootstrapOptions; // 记录 CLI 注入给 BackendBootstrap 的启动契约

    public constructor(options: BackendBootstrapOptions) {
      this.options = options;
      calls.events.push("bootstrap");
      calls.backend_bootstrap_options.push(options);
    }

    /**
     * start 返回同进程 job 需要的 BackendServices 句柄。
     */
    public async start(): Promise<BackendBootstrapStartResult> {
      calls.events.push("start");
      return {
        apiBaseUrl: null,
        backendServices:
          backend_services as unknown as BackendBootstrapStartResult["backendServices"],
        readAppLanguage: () => "ZH",
        systemProxyStartupNotice: {
          detected: false,
          proxiedOriginCount: 0,
          proxyDisplay: null,
        },
        ...options,
      };
    }

    /**
     * stop 只记录收尾顺序，真实资源释放由 BackendBootstrap 单元测试覆盖。
     */
    public async stop(): Promise<void> {
      calls.events.push("stop");
    }
  }

  vi.doMock("electron", () => {
    return {
      app: {
        whenReady: async () => {
          calls.events.push("ready");
        },
      },
      session: {
        defaultSession: {
          resolveProxy: async (url: string) => {
            calls.proxy_resolve_urls.push(url);
            return "DIRECT";
          },
        },
      },
    };
  });

  vi.doMock("../backend/bootstrap/backend-bootstrap", () => {
    return {
      BackendBootstrap: FakeBackendBootstrap,
    };
  });

  vi.doMock("./job/cli-job-runner", () => {
    return {
      run_cli_job: async (
        backendServices: FakeBackendServices,
        command: CLICommandOptions,
        options: Record<string, unknown>,
      ) => {
        calls.events.push("job");
        calls.run_cli_jobs.push({ backendServices, command, options });
      },
    };
  });

  vi.doMock("./cli-output", () => {
    return {
      write_stderr: (line: string) => {
        calls.events.push("stderr");
        calls.stderr_lines.push(line);
      },
      write_stdout: (line: string) => {
        calls.stdout_lines.push(line);
      },
    };
  });

  return { calls, backend_services };
}

/**
 * 构造最小 translate 命令，测试关注 runner 编排而非 parser。
 */
function create_translate_command(): CLICommandOptions {
  return {
    command: "translate",
    inputPaths: ["script.txt"],
    outputDir: "out",
    sourceLanguage: "JA",
    targetLanguage: "ZH",
    resources: {
      promptPath: null,
      glossaryPath: null,
      preReplacementPath: null,
      postReplacementPath: null,
      textPreservePath: null,
    },
  };
}
