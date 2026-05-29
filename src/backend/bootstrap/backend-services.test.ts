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

import { BackendServices } from "./backend-services";
import type { BackendServicesOptions } from "./backend-services";

function create_backend_services_options(): BackendServicesOptions {
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
  } as unknown as BackendServicesOptions;
}

describe("BackendServices", () => {
  it("装配 ProjectEventBus、ProjectDataCache 和 WorkbenchQueryService 到同一个组合根", () => {
    const services = new BackendServices(create_backend_services_options());

    expect(services.project).toBeDefined();
    expect(services.workbench).toBeDefined();
    expect(services.proofreading).toBeDefined();
    expect(services.quality).toBeDefined();
    expect(services.translation).toBeDefined();
    expect(services.toolbox).toBeDefined();
    expect(services.engine).toBeDefined();
    expect(services.streams).toBeDefined();
  });

  it("启动和释放时只管理组合根拥有的运行期资源", async () => {
    const options = create_backend_services_options();
    const services = new BackendServices(options);

    services.start();
    services.start();
    await services.dispose();

    expect(options.appSettingService.set_stream_publisher).toHaveBeenCalledTimes(2);
    expect(work_unit_dispose_mock).toHaveBeenCalledTimes(1);
    expect(planning_dispose_mock).toHaveBeenCalledTimes(1);
  });
});
