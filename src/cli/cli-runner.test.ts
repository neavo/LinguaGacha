import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BackendResourceOptions } from "../backend/bootstrap/backend-resources";
import type { BackendServicesOptions } from "../backend/bootstrap/backend-services";
import type { BackendWorkerExecution } from "../backend/worker/worker-execution";
import type { CLICommandOptions } from "./cli-parser";

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  resource_options: [] as unknown[],
  service_options: [] as unknown[],
  when_ready: vi.fn(),
  configure_proxy: vi.fn(),
  resolve_proxy: vi.fn(),
  dispose_resources: vi.fn(),
  dispose_services: vi.fn(),
  run_cli_job: vi.fn(),
}));

const backend_services = { marker: "backend-services", dispose: mocks.dispose_services };
const backend_resources = {
  paths: { marker: "paths" },
  metadata: { marker: "metadata" },
  settings: { marker: "settings" },
  database: { marker: "database" },
  logManager: { marker: "log-manager" },
  dispose: mocks.dispose_resources,
};

vi.mock("electron", () => ({
  app: { whenReady: mocks.when_ready, getAppPath: () => "E:/app.asar" },
  session: { defaultSession: { resolveProxy: mocks.resolve_proxy } },
}));

vi.mock("../backend/bootstrap/backend-resources", () => ({
  BackendResources: class {
    /** 记录资源启动，验证代理配置先于后端装配。 */
    public static async start(options: unknown): Promise<unknown> {
      mocks.events.push("resources");
      mocks.resource_options.push(options);
      return backend_resources;
    }
  },
}));

vi.mock("../backend/bootstrap/backend-services", () => ({
  BackendServices: class {
    /** 捕获装配依赖，隔离真实任务与资源。 */
    public constructor(options: unknown) {
      mocks.events.push("services");
      mocks.service_options.push(options);
      return backend_services;
    }
  },
}));

vi.mock("./job/cli-job-runner", () => ({ run_cli_job: mocks.run_cli_job }));
vi.mock("../native/app-proxy", () => ({ configure_app_proxy: mocks.configure_proxy }));
vi.mock("./cli-output", () => ({ write_stdout: vi.fn() }));

import { run_cli_command } from "./cli-runner";

beforeEach(() => {
  mocks.events.length = 0;
  mocks.resource_options.length = 0;
  mocks.service_options.length = 0;
  mocks.when_ready.mockReset().mockImplementation(async () => mocks.events.push("ready"));
  mocks.configure_proxy.mockReset().mockImplementation(async () => mocks.events.push("proxy"));
  mocks.resolve_proxy.mockReset().mockResolvedValue("DIRECT");
  mocks.dispose_services
    .mockReset()
    .mockImplementation(async () => mocks.events.push("dispose-services"));
  mocks.dispose_resources
    .mockReset()
    .mockImplementation(async () => mocks.events.push("dispose-resources"));
  mocks.run_cli_job.mockReset().mockImplementation(async () => mocks.events.push("job"));
});

describe("run_cli_command", () => {
  it("等待代理配置完成才启动 Backend", async () => {
    const configured = Promise.withResolvers<void>();
    mocks.configure_proxy.mockReturnValueOnce(configured.promise);
    const pending = run_cli_command("E:/App", create_translate_command(), { kind: "in_process" });
    await vi.waitFor(() => expect(mocks.configure_proxy).toHaveBeenCalledOnce());
    expect(mocks.resource_options).toEqual([]);
    configured.resolve();
    await pending;
    expect(mocks.resource_options).toHaveLength(1);
  });

  it("代理配置失败向 CLI 错误出口传播并阻止 Backend 启动", async () => {
    const error = new Error("LG_PROXY invalid");
    mocks.configure_proxy.mockRejectedValueOnce(error);
    await expect(
      run_cli_command("E:/App", create_translate_command(), { kind: "in_process" }),
    ).rejects.toBe(error);
    expect(mocks.resource_options).toEqual([]);
    expect(mocks.run_cli_job).not.toHaveBeenCalled();
  });

  it("只组装共享 Backend 能力并在 job 后逆序释放", async () => {
    const command = create_translate_command();

    await run_cli_command("E:/App", command, { kind: "in_process" });

    expect(mocks.events).toEqual([
      "ready",
      "proxy",
      "resources",
      "services",
      "job",
      "dispose-services",
      "dispose-resources",
    ]);
    const resource_options = mocks.resource_options[0] as BackendResourceOptions;
    expect(resource_options).toMatchObject({
      appRoot: "E:/App",
      builtinRoot: path.join("E:/app.asar", "builtin"),
      logTargets: { console: false, window: false },
    });
    await expect(
      resource_options.proxyResolver.resolveProxy("https://api.example/v1"),
    ).resolves.toBe("DIRECT");
    const service_options = mocks.service_options[0] as BackendServicesOptions;
    expect(service_options).toMatchObject({
      paths: backend_resources.paths,
      metadata: backend_resources.metadata,
      appSettingService: backend_resources.settings,
      database: backend_resources.database,
      logManager: backend_resources.logManager,
      workerExecution: { kind: "in_process" } satisfies BackendWorkerExecution,
    });
    expect(mocks.run_cli_job).toHaveBeenCalledWith(backend_services, command, expect.any(Object));
  });

  it("job 与两层收尾失败时按发生顺序保留全部异常", async () => {
    const job_failure = new Error("job failed");
    const service_failure = new Error("services failed");
    const resource_failure = new Error("resources failed");
    mocks.run_cli_job.mockRejectedValue(job_failure);
    mocks.dispose_services.mockRejectedValue(service_failure);
    mocks.dispose_resources.mockRejectedValue(resource_failure);

    const error = await run_cli_command("E:/App", create_translate_command(), {
      kind: "in_process",
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      job_failure,
      service_failure,
      resource_failure,
    ]);
  });
});

/** 构造翻译任务，聚焦 CLI 装配与资源释放。 */
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
