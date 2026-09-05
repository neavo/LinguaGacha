import { beforeEach, describe, expect, it, vi } from "vitest";

const { work_unit_dispose_mock, planning_dispose_mock } = vi.hoisted(() => {
  return {
    work_unit_dispose_mock: vi.fn(async () => undefined),
    planning_dispose_mock: vi.fn(async () => undefined),
  };
});

vi.mock("../batch-translation/work-unit/translation-worker-pool", () => {
  return {
    TranslationWorkerPool: class {
      public async dispose(): Promise<void> {
        await work_unit_dispose_mock();
      }
    },
  };
});

vi.mock("../batch-translation/planning/planning-worker-pool", () => {
  return {
    PlanningWorkerPool: class {
      public async dispose(): Promise<void> {
        await planning_dispose_mock();
      }
    },
  };
});

import { BackendServices } from "./backend-services";
import type { BackendServicesOptions } from "./backend-services";
import { BatchTranslationService } from "../batch-translation/batch-translation-service";
import { BatchTranslationRuntime } from "../batch-translation/batch-translation-runtime";
import { ComputeWorkerClient } from "../worker/compute-worker-client";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { AppError } from "../../shared/error";

const TEST_APP_ROOT = "E:/linguagacha-backend-test";

/** 构造不访问磁盘和真实外部服务的最小组合根依赖。 */
function create_backend_services_options(): BackendServicesOptions {
  return {
    paths: {
      get_app_root: () => TEST_APP_ROOT,
      get_builtin_root: () => "E:/app.asar/builtin",
      get_user_data_dir: () => "E:/UserData",
      get_agent_workspace_root_dir: () => "E:/UserData/agent/workspace",
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

  it("释放时只管理共享业务根拥有的运行期资源", async () => {
    const options = create_backend_services_options();
    const compute_worker_dispose = vi.spyOn(ComputeWorkerClient.prototype, "dispose");
    const services = new BackendServices(options);

    await services.dispose();

    expect(work_unit_dispose_mock).toHaveBeenCalledTimes(1);
    expect(planning_dispose_mock).toHaveBeenCalledTimes(1);
    expect(compute_worker_dispose).toHaveBeenCalledTimes(1);
    expect(options.metadata.build_linguagacha_user_agent).toHaveBeenCalledTimes(1);
    compute_worker_dispose.mockRestore();
  });

  it("把任务快照交给入口事件出口", async () => {
    let publish_snapshot: Parameters<BatchTranslationService["subscribe"]>[0] | undefined;
    const subscribe_spy = vi
      .spyOn(BatchTranslationService.prototype, "subscribe")
      .mockImplementation((listener) => {
        publish_snapshot = listener;
        return vi.fn();
      });
    const options = create_backend_services_options();
    const services = new BackendServices(options);
    vi.mocked(options.publishEvent).mockClear();

    expect(publish_snapshot).toBeDefined();
    await publish_snapshot?.({
      revision: 7,
      status: "running",
      request_in_flight_count: 2,
      progress: {
        line: 1,
        total_line: 3,
        processed_line: 1,
        error_line: 0,
        total_tokens: 10,
        total_output_tokens: 4,
        total_reasoning_tokens: 0,
        total_input_tokens: 6,
        time: 1,
        start_time: 2,
      },
      scope: { kind: "all" },
    });
    await services.dispose();
    subscribe_spy.mockRestore();

    expect(options.publishEvent).toHaveBeenCalledWith(
      "batch_translation.snapshot_changed",
      expect.objectContaining({ batch_translation: expect.objectContaining({ revision: 7 }) }),
    );
  });

  it("把统一运行时快照交给入口事件出口", async () => {
    let publish_snapshot: Parameters<RuntimeOperationGate["subscribe"]>[0] | undefined;
    const subscribe_spy = vi
      .spyOn(RuntimeOperationGate.prototype, "subscribe")
      .mockImplementation((listener) => {
        publish_snapshot = listener;
        return vi.fn();
      });
    const options = create_backend_services_options();
    const services = new BackendServices(options);
    vi.mocked(options.publishEvent).mockClear();

    expect(publish_snapshot).toBeDefined();
    publish_snapshot?.({ revision: 3, owner: "agent" });

    await services.dispose();
    subscribe_spy.mockRestore();

    expect(options.publishEvent).toHaveBeenCalledWith("runtime.snapshot_changed", {
      runtime: { revision: 3, owner: "agent" },
    });
  });

  it("设置更新在持久化前经过统一运行时门禁", async () => {
    const options = create_backend_services_options();
    const assert_idle_spy = vi
      .spyOn(RuntimeOperationGate.prototype, "assert_runtime_idle")
      .mockImplementation(() => {
        throw new AppError("runtime.busy");
      });
    const services = new BackendServices(options);

    expect(() => services.app.updateSettings({ app_language: "ZH" })).toThrow("runtime.busy");
    expect(options.appSettingService.update_app_settings).not.toHaveBeenCalled();

    assert_idle_spy.mockRestore();
    await services.dispose();
  });

  it("等待任务落稳后才释放执行池", async () => {
    let release_task_runtime: () => void = () => undefined;
    const task_runtime_dispose = new Promise<void>((resolve) => {
      release_task_runtime = resolve;
    });
    const dispose_spy = vi
      .spyOn(BatchTranslationRuntime.prototype, "dispose")
      .mockImplementation(async () => await task_runtime_dispose);
    const services = new BackendServices(create_backend_services_options());

    const disposing = services.dispose();
    await Promise.resolve();

    expect(work_unit_dispose_mock).not.toHaveBeenCalled();
    expect(planning_dispose_mock).not.toHaveBeenCalled();

    release_task_runtime();
    await disposing;
    dispose_spy.mockRestore();

    expect(work_unit_dispose_mock).toHaveBeenCalledTimes(1);
    expect(planning_dispose_mock).toHaveBeenCalledTimes(1);
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
