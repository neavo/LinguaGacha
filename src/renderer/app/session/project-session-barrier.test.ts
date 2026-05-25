import { describe, expect, it } from "vitest";

import {
  createProjectSessionBarrierCheckpoint,
  isProjectSessionBarrierReady,
  type ProjectSessionBarrierState,
} from "@/app/session/project-session-barrier";

// create_barrier_state 构造 barrier 判定所需的最小 session 快照。
function create_barrier_state(
  overrides: Partial<ProjectSessionBarrierState> = {},
): ProjectSessionBarrierState {
  return {
    projectLoaded: true,
    projectPath: "E:/demo/demo.lg",
    projectSectionRevisions: {
      items: 3,
      proofreading: 2,
    },
    projectSessionReady: true,
    pageCaches: {},
    ...overrides,
  };
}

describe("project session barrier", () => {
  it("project_session_ready 只等待项目 session 身份和 ready 状态", () => {
    const state = create_barrier_state({
      pageCaches: {
        workbench: {
          isRefreshing: true,
          consumedRevisions: {},
          requiredSections: ["items"],
          settledProjectPath: "E:/demo/demo.lg",
        },
      },
    });

    expect(
      isProjectSessionBarrierReady("project_session_ready", state, {
        projectPath: "E:/demo/demo.lg",
      }),
    ).toBe(true);
  });

  it("页面缓存未挂载时不阻塞页面级 barrier", () => {
    expect(
      isProjectSessionBarrierReady(
        "proofreading_cache_refresh",
        create_barrier_state(),
        {
          projectPath: "E:/demo/demo.lg",
        },
      ),
    ).toBe(true);
  });

  it("已挂载页面缓存必须覆盖声明 section revision 才 ready", () => {
    const state = create_barrier_state({
      pageCaches: {
        proofreading: {
          isRefreshing: false,
          consumedRevisions: {
            proofreading: 1,
          },
          requiredSections: ["proofreading"],
          settledProjectPath: "E:/demo/demo.lg",
        },
      },
    });

    expect(
      isProjectSessionBarrierReady("proofreading_cache_refresh", state, {
        projectPath: "E:/demo/demo.lg",
      }),
    ).toBe(false);
  });

  it("工作台文件操作 barrier 会同时等待文件操作和相关页面缓存", () => {
    const state = create_barrier_state({
      pageCaches: {
        workbench: {
          isRefreshing: false,
          consumedRevisions: {
            items: 3,
          },
          requiredSections: ["items"],
          settledProjectPath: "E:/demo/demo.lg",
          fileOperationRunning: true,
        },
      },
    });

    expect(
      isProjectSessionBarrierReady("workbench_file_operation", state, {
        projectPath: "E:/demo/demo.lg",
      }),
    ).toBe(false);
  });

  it("checkpoint 固定操作开始时的项目路径", () => {
    const checkpoint = createProjectSessionBarrierCheckpoint({
      projectPath: "E:/demo/start.lg",
    });
    const state = create_barrier_state({
      projectPath: "E:/demo/next.lg",
    });

    expect(
      isProjectSessionBarrierReady("project_session_ready", state, {
        checkpoint,
      }),
    ).toBe(false);
  });
});
