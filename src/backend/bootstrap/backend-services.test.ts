import { beforeEach, describe, expect, it, vi } from "vitest";

const { work_unit_dispose_mock, planning_dispose_mock } = vi.hoisted(() => {
  return {
    work_unit_dispose_mock: vi.fn(async () => undefined),
    planning_dispose_mock: vi.fn(async () => undefined),
  };
});

vi.mock("../batch-translation/work-unit/translation-worker-pool", () => {
  return {
    // 用关闭回调观察翻译线程池的收尾。
    TranslationWorkerPool: class {
      public dispose = work_unit_dispose_mock;
    },
  };
});

vi.mock("../batch-translation/planning/planning-worker-pool", () => {
  return {
    // 用关闭回调观察规划线程池的收尾。
    PlanningWorkerPool: class {
      public dispose = planning_dispose_mock;
    },
  };
});

import { BackendServices } from "./backend-services";
import type { BackendServicesOptions } from "./backend-services";
import { ComputeWorkerClient } from "../worker/compute-worker-client";

const TEST_APP_ROOT = "E:/linguagacha-backend-test";

/** 构造不访问磁盘和真实外部服务的最小组合根依赖。 */
function create_backend_services_options(): BackendServicesOptions {
  return {
    paths: {
      get_app_root: () => TEST_APP_ROOT,
      get_builtin_root: () => "E:/app.asar/builtin",
      get_user_data_path: (name: string) => `E:/UserData/${name}`,
      get_user_data_dir: () => "E:/UserData",
      get_agent_workspace_root_dir: () => "E:/UserData/workspace",
    },
    metadata: {
      build_linguagacha_user_agent: vi.fn(() => "LinguaGacha/Test"),
      read_version_or_default: vi.fn(() => "1.2.3"),
    },
    appSettingService: {
      read_setting: () => ({ app_language: "zh-CN" }),
      set_stream_publisher: vi.fn(),
      update_app_settings: vi.fn((request) => ({ settings: request })),
    },
    database: {},
    logManager: {
      warning: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
    publishEvent: vi.fn(),
    openOutputFolder: vi.fn(),
    workerExecution: { kind: "in_process" },
  } as unknown as BackendServicesOptions;
}

describe("BackendServices", () => {
  beforeEach(() => {
    work_unit_dispose_mock.mockClear();
    planning_dispose_mock.mockClear();
  });

  it("后台目录检查只启动一次，关闭时释放共享资源", async () => {
    const options = create_backend_services_options();
    const compute_worker_dispose = vi.spyOn(ComputeWorkerClient.prototype, "dispose");
    const services = new BackendServices(options);
    const check = vi.spyOn(services.modelCatalog, "check").mockResolvedValue();
    services.start_model_catalog_check();
    services.start_model_catalog_check();
    expect(check).toHaveBeenCalledOnce();

    await services.dispose();

    expect(work_unit_dispose_mock).toHaveBeenCalledTimes(1);
    expect(planning_dispose_mock).toHaveBeenCalledTimes(1);
    expect(compute_worker_dispose).toHaveBeenCalledTimes(1);
    check.mockRestore();
    compute_worker_dispose.mockRestore();
  });

  it("一个执行池快速失败时仍等待其余执行池释放完毕再汇总异常", async () => {
    const dispose_failure = new Error("work unit dispose failed");
    work_unit_dispose_mock.mockRejectedValueOnce(dispose_failure);
    let release_planning_dispose: () => void = () => undefined;
    const planning_dispose_block = new Promise<void>((resolve) => {
      release_planning_dispose = resolve;
    });
    planning_dispose_mock.mockImplementationOnce(async () => {
      await planning_dispose_block;
      return undefined;
    });
    const services = new BackendServices(create_backend_services_options());
    let dispose_settled = false;
    const disposing = services.dispose().then(
      () => {
        dispose_settled = true;
        return { error: null };
      },
      (error: unknown) => {
        dispose_settled = true;
        return { error };
      },
    );

    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(work_unit_dispose_mock).toHaveBeenCalledTimes(1);
      expect(planning_dispose_mock).toHaveBeenCalledTimes(1);
      expect(dispose_settled).toBe(false);
    } finally {
      release_planning_dispose();
    }

    const result = await disposing;
    expect(result.error).toBeInstanceOf(AggregateError);
    expect((result.error as AggregateError).errors).toEqual([dispose_failure]);
  });
});
