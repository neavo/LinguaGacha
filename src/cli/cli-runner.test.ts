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
    public static async start(options: unknown): Promise<unknown> {
      mocks.events.push("resources");
      mocks.resource_options.push(options);
      return backend_resources;
    }
  },
}));

vi.mock("../backend/bootstrap/backend-services", () => ({
  BackendServices: class {
    public constructor(options: unknown) {
      mocks.events.push("services");
      mocks.service_options.push(options);
      return backend_services;
    }
  },
}));

vi.mock("./job/cli-job-runner", () => ({ run_cli_job: mocks.run_cli_job }));
vi.mock("./cli-output", () => ({ write_stdout: vi.fn() }));

import { run_cli_command } from "./cli-runner";

beforeEach(() => {
  mocks.events.length = 0;
  mocks.resource_options.length = 0;
  mocks.service_options.length = 0;
  mocks.when_ready.mockReset().mockImplementation(async () => mocks.events.push("ready"));
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
  it("只组装共享 Backend 能力并在 job 后逆序释放", async () => {
    const command = create_translate_command();

    await run_cli_command("E:/App", command, { kind: "in_process" });

    expect(mocks.events).toEqual([
      "ready",
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
      resource_options.systemProxyResolver.resolveProxy("https://api.example/v1"),
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
