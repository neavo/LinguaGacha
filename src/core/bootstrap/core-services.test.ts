import { describe, expect, it, vi } from "vitest";

const { work_unit_dispose_mock, planning_dispose_mock } = vi.hoisted(() => {
  return {
    work_unit_dispose_mock: vi.fn(async () => undefined),
    planning_dispose_mock: vi.fn(async () => undefined),
  };
});

vi.mock("../engine/work-unit/work-unit-worker-pool", () => {
  return {
    WorkUnitWorkerPool: class {
      public async dispose(): Promise<void> {
        await work_unit_dispose_mock();
      }
    },
  };
});

vi.mock("../engine/planning/planning-worker-pool", () => {
  return {
    PlanningWorkerPool: class {
      public async dispose(): Promise<void> {
        await planning_dispose_mock();
      }
    },
  };
});

import { CoreServices } from "./core-services";
import type { CoreServicesOptions } from "./core-services";

function create_core_services_options(): CoreServicesOptions {
  return {
    paths: {
      get_app_root: () => "E:/Project/LinguaGacha",
      get_user_data_dir: () => "E:/UserData",
    },
    metadata: {
      build_linguagacha_user_agent: () => "LinguaGacha/Test",
    },
    appSettingService: {
      read_setting: () => ({ app_language: "zh-CN" }),
      set_stream_publisher: vi.fn(),
    },
    database: {
      execute: vi.fn(() => ({})),
      execute_transaction: vi.fn(),
    },
    logManager: {
      warning: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
    systemProxySnapshot: null,
    openOutputFolder: vi.fn(),
    workerExecution: { kind: "in_process" },
  } as unknown as CoreServicesOptions;
}

describe("CoreServices", () => {
  it("装配 AppEventBus、AppSessionCache 和 ProjectQueryService 到同一个组合根", () => {
    const services = new CoreServices(create_core_services_options());

    expect(services.app_event_bus).toBeDefined();
    expect(services.app_session_cache).toBeDefined();
    expect(services.app_session_proofreading_cache).toBeDefined();
    expect(services.project_query_service).toBeDefined();
    expect(services.proofreading_query_service).toBeDefined();
    expect(services.proofreading_query_worker).toBeDefined();
    expect(services.project_service).toBeDefined();
    expect(services.project_task_store).toBeDefined();
  });

  it("启动和释放时只管理组合根拥有的运行期资源", async () => {
    const options = create_core_services_options();
    const services = new CoreServices(options);

    services.start();
    services.start();
    await services.dispose();

    expect(options.appSettingService.set_stream_publisher).toHaveBeenCalledTimes(2);
    expect(work_unit_dispose_mock).toHaveBeenCalledTimes(1);
    expect(planning_dispose_mock).toHaveBeenCalledTimes(1);
  });
});
