import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BackendBootstrapOptions } from "../backend/bootstrap/backend-bootstrap-types";
import type { BackendBootstrapStartResult } from "../backend/bootstrap/backend-bootstrap-types";
import type { BackendWorkerExecution } from "../backend/worker/worker-execution";
import type { CLICommandOptions } from "./cli-parser";

const mocks = vi.hoisted(() => ({
  backend_bootstrap_options: [] as unknown[],
  backend_services: { marker: "backend-services" },
  events: [] as string[],
  start_result: undefined as unknown,
  when_ready: vi.fn(),
  resolve_proxy: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  run_cli_job: vi.fn(),
  write_stdout: vi.fn(),
  render_desktop_pdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
}));

vi.mock("electron", () => ({
  app: { whenReady: mocks.when_ready },
  session: { defaultSession: { resolveProxy: mocks.resolve_proxy } },
}));

vi.mock("../backend/bootstrap/backend-bootstrap", () => ({
  BackendBootstrap: class {
    public constructor(options: unknown) {
      mocks.events.push("bootstrap");
      mocks.backend_bootstrap_options.push(options);
    }

    public async start(): Promise<unknown> {
      return await mocks.start();
    }

    public async stop(): Promise<void> {
      await mocks.stop();
    }
  },
}));

vi.mock("./job/cli-job-runner", () => ({ run_cli_job: mocks.run_cli_job }));
vi.mock("./cli-output", () => ({
  write_stdout: mocks.write_stdout,
}));
vi.mock("../gui/shell/desktop-pdf-render-host", () => ({
  render_desktop_pdf: mocks.render_desktop_pdf,
}));

import { run_cli_command } from "./cli-runner";

beforeEach(() => {
  mocks.backend_bootstrap_options.length = 0;
  mocks.events.length = 0;
  mocks.start_result = create_start_result();
  mocks.when_ready.mockImplementation(async () => {
    mocks.events.push("ready");
  });
  mocks.resolve_proxy.mockImplementation(async () => "DIRECT");
  mocks.start.mockImplementation(async () => {
    mocks.events.push("start");
    return mocks.start_result;
  });
  mocks.stop.mockImplementation(async () => {
    mocks.events.push("stop");
  });
  mocks.run_cli_job.mockImplementation(async (_backend, _command, status_reporter) => {
    mocks.events.push("job");
    (status_reporter as { emit_started: () => void }).emit_started();
  });
});

describe("run_cli_command", () => {
  it("等待 Electron ready 后以无 Gateway 配置执行 CLI job", async () => {
    const command = create_translate_command();

    await run_cli_command("E:/App", "E:/Desktop", command, { kind: "in_process" });

    expect(mocks.events).toEqual(["ready", "bootstrap", "start", "job", "stop"]);
    const bootstrap_options = mocks.backend_bootstrap_options[0] as
      | BackendBootstrapOptions
      | undefined;
    expect(bootstrap_options).toBeDefined();
    expect(bootstrap_options).toMatchObject({
      appRoot: "E:/App",
      exposeApiGateway: false,
      logTargets: { console: false, window: false },
      workerExecution: { kind: "in_process" } satisfies BackendWorkerExecution,
    });
    await expect(
      bootstrap_options?.systemProxyResolver.resolveProxy("https://api.example/v1"),
    ).resolves.toBe("DIRECT");
    expect(mocks.resolve_proxy).toHaveBeenCalledWith("https://api.example/v1");
    await expect(bootstrap_options?.renderPdf("# 译题")).resolves.toEqual(
      new Uint8Array([37, 80, 68, 70]),
    );
    expect(mocks.render_desktop_pdf).toHaveBeenCalledWith({
      markdown: "# 译题",
      desktopBundleDir: "E:/Desktop",
      signal: expect.any(AbortSignal),
    });
    expect(mocks.run_cli_job).toHaveBeenCalledWith(
      mocks.backend_services,
      command,
      expect.any(Object),
    );
    expect(mocks.write_stdout).toHaveBeenCalledOnce();
    expect(JSON.parse(String(mocks.write_stdout.mock.calls[0]?.[0]))).toMatchObject({
      type: "started",
      command: "translate",
    });
  });

  it("CLI job 与 Backend 收尾同时失败时保留两个异常和原始顺序", async () => {
    const job_failure = new Error("job failed");
    const stop_failure = new Error("stop failed");
    mocks.run_cli_job.mockRejectedValue(job_failure);
    mocks.stop.mockRejectedValue(stop_failure);

    const command_error = await run_cli_command(
      "E:/App",
      "E:/Desktop",
      create_translate_command(),
      {
        kind: "in_process",
      },
    ).catch((error: unknown) => error);

    expect(command_error).toBeInstanceOf(AggregateError);
    expect((command_error as AggregateError).errors).toEqual([job_failure, stop_failure]);
  });
});

function create_start_result(
  overrides: Partial<BackendBootstrapStartResult> = {},
): BackendBootstrapStartResult {
  return {
    apiBaseUrl: null,
    backendServices:
      mocks.backend_services as unknown as BackendBootstrapStartResult["backendServices"],
    readAppLanguage: () => "ZH",
    ...overrides,
  };
}

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
