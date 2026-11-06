import { afterEach, describe, expect, it, vi } from "vitest";

const { run_backend_runtime } = vi.hoisted(() => ({ run_backend_runtime: vi.fn() }));

vi.mock("./backend-runtime", () => ({ run_backend_runtime }));

/** 宿主注入的完整 workerData，用例按需删改单个字段。 */
const WORKER_DATA = {
  appRoot: "E:/app",
  builtinRoot: "E:/app.asar/builtin",
  workspaceRuntimeDirectory: "E:/runtime",
  fontsDirectory: "E:/fonts",
  defaultAppLanguage: "JA",
} as const;

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

  it.each(["appRoot", "builtinRoot", "workspaceRuntimeDirectory", "fontsDirectory"])(
    "缺少 %s 时拒绝启动",
    async (field) => {
      const worker_data: Record<string, unknown> = { ...WORKER_DATA };
      delete worker_data[field];
      vi.doMock("node:worker_threads", () => ({
        default: { parentPort: {}, workerData: worker_data },
        parentPort: {},
        workerData: worker_data,
      }));

      await expect(import("./backend-runtime-worker-entry")).rejects.toThrow(`missing ${field}`);
    },
  );

  it.each([undefined, "fr-FR"])("拒绝无效的默认应用语言 %s", async (defaultAppLanguage) => {
    vi.doMock("node:worker_threads", () => ({
      parentPort: {},
      workerData: { ...WORKER_DATA, defaultAppLanguage },
    }));
    await expect(import("./backend-runtime-worker-entry")).rejects.toThrow(
      "valid defaultAppLanguage",
    );
    expect(run_backend_runtime).not.toHaveBeenCalled();
  });

  it("把收窄后的 workerData 和 parentPort 交给运行时", async () => {
    const parent_port = {};
    vi.doMock("node:worker_threads", () => ({
      default: { parentPort: parent_port, workerData: WORKER_DATA },
      parentPort: parent_port,
      workerData: WORKER_DATA,
    }));

    await import("./backend-runtime-worker-entry");

    expect(run_backend_runtime).toHaveBeenCalledWith({
      ...WORKER_DATA,
      moduleUrl: expect.stringContaining("backend-runtime-worker-entry"),
      port: parent_port,
    });
  });
});
