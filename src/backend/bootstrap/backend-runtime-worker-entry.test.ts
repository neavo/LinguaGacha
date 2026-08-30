import { afterEach, describe, expect, it, vi } from "vitest";

const { run_backend_runtime } = vi.hoisted(() => ({ run_backend_runtime: vi.fn() }));

vi.mock("./backend-runtime", () => ({ run_backend_runtime }));

describe("Backend Runtime worker 入口", () => {
  afterEach(() => {
    run_backend_runtime.mockReset();
    vi.resetModules();
    vi.doUnmock("node:worker_threads");
  });

  it("缺少 parentPort 时拒绝启动", async () => {
    vi.doMock("node:worker_threads", () => ({
      default: { parentPort: null, workerData: {} },
      parentPort: null,
      workerData: {},
    }));

    await expect(import("./backend-runtime-worker-entry")).rejects.toThrow("missing parentPort");
  });

  it.each([
    ["appRoot", { builtinRoot: "E:/app.asar/builtin" }],
    ["builtinRoot", { appRoot: "E:/app" }],
  ])("缺少 %s 时拒绝启动", async (field, worker_data) => {
    vi.doMock("node:worker_threads", () => ({
      default: { parentPort: {}, workerData: worker_data },
      parentPort: {},
      workerData: worker_data,
    }));

    await expect(import("./backend-runtime-worker-entry")).rejects.toThrow(`missing ${field}`);
  });

  it("把收窄后的 workerData 和 parentPort 交给运行时", async () => {
    const parent_port = {};
    vi.doMock("node:worker_threads", () => ({
      default: {
        parentPort: parent_port,
        workerData: { appRoot: "E:/app", builtinRoot: "E:/app.asar/builtin" },
      },
      parentPort: parent_port,
      workerData: { appRoot: "E:/app", builtinRoot: "E:/app.asar/builtin" },
    }));

    await import("./backend-runtime-worker-entry");

    expect(run_backend_runtime).toHaveBeenCalledWith({
      appRoot: "E:/app",
      builtinRoot: "E:/app.asar/builtin",
      moduleUrl: expect.stringContaining("backend-runtime-worker-entry"),
      port: parent_port,
    });
  });
});
