import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CoreBootstrapOptions } from "../core/bootstrap/core-bootstrap-types";
import type { CoreBootstrapStartResult } from "../core/bootstrap/core-bootstrap-types";
import type { EngineExecution } from "../core/engine/core/engine-execution";
import type { CLICommandOptions } from "./cli-parser";

type FakeCoreServices = { marker: "core-services" };
type RunCliJobCall = {
  coreServices: FakeCoreServices;
  command: CLICommandOptions;
  options: Record<string, unknown>;
};

const MOCK_MODULES = [
  "electron",
  "../core/bootstrap/core-bootstrap",
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
    expect(harness.calls.core_bootstrap_options).toHaveLength(1);
    expect(harness.calls.core_bootstrap_options[0]).toMatchObject({
      appRoot: "E:/App",
      exposeApiGateway: false,
      logTargets: { console: false, window: false },
      engineExecution: { kind: "in_process" } satisfies EngineExecution,
    });
    await expect(
      harness.calls.core_bootstrap_options[0]?.systemProxyResolver?.resolveProxy(
        "https://api.example/v1",
      ),
    ).resolves.toBe("DIRECT");
    expect(harness.calls.proxy_resolve_urls).toEqual(["https://api.example/v1"]);
    expect(harness.calls.run_cli_jobs).toHaveLength(1);
    expect(harness.calls.run_cli_jobs[0]?.coreServices).toBe(harness.core_services);
    expect(harness.calls.run_cli_jobs[0]?.command.command).toBe("translate");
  });
});

/**
 * 搭建 CLI runner 测试夹具，用假的 Electron、CoreBootstrap 和 job 观察入口编排。
 */
function create_runner_harness(): {
  core_services: FakeCoreServices;
  calls: {
    core_bootstrap_options: CoreBootstrapOptions[];
    events: string[];
    proxy_resolve_urls: string[];
    run_cli_jobs: RunCliJobCall[];
    stdout_lines: string[];
  };
} {
  const core_services: FakeCoreServices = { marker: "core-services" };
  const calls = {
    core_bootstrap_options: [] as CoreBootstrapOptions[],
    events: [] as string[],
    proxy_resolve_urls: [] as string[],
    run_cli_jobs: [] as RunCliJobCall[],
    stdout_lines: [] as string[],
  };

  class FakeCoreBootstrap {
    private readonly options: CoreBootstrapOptions; // options 记录 CLI 注入给 CoreBootstrap 的启动契约

    public constructor(options: CoreBootstrapOptions) {
      this.options = options;
      calls.events.push("bootstrap");
      calls.core_bootstrap_options.push(options);
    }

    /**
     * start 返回同进程 job 需要的 CoreServices 句柄。
     */
    public async start(): Promise<Pick<CoreBootstrapStartResult, "coreServices">> {
      calls.events.push("start");
      return { coreServices: core_services } as unknown as Pick<
        CoreBootstrapStartResult,
        "coreServices"
      >;
    }

    /**
     * stop 只记录收尾顺序，真实资源释放由 CoreBootstrap 单元测试覆盖。
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

  vi.doMock("../core/bootstrap/core-bootstrap", () => {
    return {
      CoreBootstrap: FakeCoreBootstrap,
    };
  });

  vi.doMock("./job/cli-job-runner", () => {
    return {
      run_cli_job: async (
        coreServices: FakeCoreServices,
        command: CLICommandOptions,
        options: Record<string, unknown>,
      ) => {
        calls.events.push("job");
        calls.run_cli_jobs.push({ coreServices, command, options });
      },
    };
  });

  vi.doMock("./cli-output", () => {
    return {
      write_stdout: (line: string) => {
        calls.stdout_lines.push(line);
      },
    };
  });

  return { calls, core_services };
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
