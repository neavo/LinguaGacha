import { useEffect, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@/app/desktop/desktop-api";
import type { ProjectMutationResultPayload } from "@/app/desktop/desktop-project-mutation";
import type { TaskSnapshot } from "@/app/desktop/task-runtime-store";
import type {
  WorkbenchMutationPlanningState,
  WorkbenchProjectMutationPlan,
} from "@/pages/workbench-page/workbench-mutation-planner";
import type { WorkbenchDialogState } from "@/pages/workbench-page/types";
import {
  close_dialog_state,
  useWorkbenchImportFilesFlow,
  type WorkbenchImportFilesFlow,
} from "@/pages/workbench-page/use-workbench-import-files-flow";

type HookSnapshot = {
  flow: WorkbenchImportFilesFlow;
  dialog_state: WorkbenchDialogState;
};

// api fetch mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const api_fetch_mock = vi.mocked(api_fetch);

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: vi.fn(),
  };
});

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useWorkbenchImportFilesFlow", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
    api_fetch_mock.mockReset();
  });

  it("新增文件先进入继承确认，取消继承后提交后端导入命令", async () => {
    api_fetch_mock
      .mockResolvedValueOnce({
        files: [
          {
            source_path: "C:/source/new.txt",
            target_rel_path: "new.txt",
            file_type: "TXT",
            parsed_items: [{ src: "新文本" }],
          },
        ],
      })
      .mockResolvedValueOnce({ accepted: true, changes: [] });
    const mutation_payloads: Record<string, unknown>[] = [];
    const snapshots = await mount_hook({
      run_project_file_mutation: async (plan, request) => {
        mutation_payloads.push(plan.requestBody);
        return await request(plan.requestBody);
      },
    });

    await act(async () => {
      await latest_snapshot(snapshots).flow.request_add_files_from_paths(["C:/source/new.txt"]);
    });

    expect(latest_snapshot(snapshots).dialog_state).toMatchObject({
      kind: "inherit-import-files",
      target_rel_paths: ["new.txt"],
      pending_path: "C:/source/new.txt",
      submitting: false,
    });

    await act(async () => {
      await latest_snapshot(snapshots).flow.cancel_dialog();
    });

    expect(mutation_payloads).toEqual([
      {
        files: [{ source_path: "C:/source/new.txt", target_rel_path: "new.txt" }],
        conflict_action: "skip",
        inheritance_mode: "none",
        project_settings: {
          source_language: "JA",
          mtool_optimizer_enable: true,
          skip_duplicate_source_text_enable: false,
        },
        expected_section_revisions: {
          files: 1,
          items: 2,
          analysis: 3,
        },
      },
    ]);
    expect(api_fetch_mock).toHaveBeenLastCalledWith(
      "/api/project/workbench/import-files",
      mutation_payloads[0],
    );
    expect(latest_snapshot(snapshots).dialog_state.kind).toBeNull();
  });

  it("同名文件先进入冲突确认，确认替换后再进入继承确认", async () => {
    api_fetch_mock.mockResolvedValueOnce({
      files: [
        {
          source_path: "C:/source/old.txt",
          target_rel_path: "old.txt",
          file_type: "TXT",
          parsed_items: [{ src: "替换文本" }],
        },
      ],
    });
    const snapshots = await mount_hook();

    await act(async () => {
      await latest_snapshot(snapshots).flow.request_add_files_from_paths(["C:/source/old.txt"]);
    });

    expect(latest_snapshot(snapshots).dialog_state).toMatchObject({
      kind: "confirm-import-files",
      target_rel_paths: ["old.txt"],
      pending_path: "C:/source/old.txt",
    });

    await act(async () => {
      await latest_snapshot(snapshots).flow.confirm_dialog();
    });

    expect(latest_snapshot(snapshots).dialog_state).toMatchObject({
      kind: "inherit-import-files",
      target_rel_paths: ["old.txt"],
      pending_path: "C:/source/old.txt",
    });
  });

  // mount_hook 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
  async function mount_hook(
    options: {
      state?: WorkbenchMutationPlanningState;
      run_project_file_mutation?: (
        plan: WorkbenchProjectMutationPlan,
        request: (body: Record<string, unknown>) => Promise<ProjectMutationResultPayload>,
      ) => Promise<ProjectMutationResultPayload>;
    } = {},
  ): Promise<HookSnapshot[]> {
    const snapshots: HookSnapshot[] = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <HookProbe
          state={options.state ?? create_project_store_state()}
          run_project_file_mutation={options.run_project_file_mutation}
          onSnapshot={(snapshot) => {
            snapshots.push(snapshot);
          }}
        />,
      );
    });

    return snapshots;
  }
});

// HookProbe 收口测试中的共享步骤，保证断言只关注当前行为。
function HookProbe(props: {
  state: WorkbenchMutationPlanningState;
  run_project_file_mutation?: (
    plan: WorkbenchProjectMutationPlan,
    request: (body: Record<string, unknown>) => Promise<ProjectMutationResultPayload>,
  ) => Promise<ProjectMutationResultPayload>;
  onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
  const [dialog_state, set_dialog_state] = useState<WorkbenchDialogState>(close_dialog_state());
  const flow = useWorkbenchImportFilesFlow({
    readonly: false,
    project_identity: "E:/demo/project.lg",
    dialog_state,
    get_planning_state: () => props.state,
    task_snapshot: create_task_snapshot(),
    planner_settings: {
      source_language: "JA",
      mtool_optimizer_enable: true,
      skip_duplicate_source_text_enable: false,
    },
    run_modal_progress_toast: async (args) => {
      return await args.task();
    },
    run_project_file_mutation:
      props.run_project_file_mutation ??
      (async (plan, request) => {
        return await request(plan.requestBody);
      }),
    set_dialog_state,
    set_dialog_submitting: (next_submitting) => {
      set_dialog_state((previous_state) => {
        return previous_state.kind === null
          ? previous_state
          : { ...previous_state, submitting: next_submitting };
      });
    },
    push_toast: vi.fn(),
    t: (key) => key,
  });

  useEffect(() => {
    props.onSnapshot({ flow, dialog_state });
  }, [dialog_state, flow, props]);

  return null;
}

// latest_snapshot 收口测试中的共享步骤，保证断言只关注当前行为。
function latest_snapshot(snapshots: HookSnapshot[]): HookSnapshot {
  const snapshot = snapshots.at(-1);
  if (snapshot === undefined) {
    throw new Error("没有捕获到 Hook 快照。");
  }
  return snapshot;
}

// create_project_store_state 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_project_store_state(): WorkbenchMutationPlanningState {
  return {
    files: [
      {
        rel_path: "old.txt",
        file_type: "TXT",
        sort_index: 0,
      },
    ],
    section_revisions: {
      files: 1,
      items: 2,
      analysis: 3,
    },
  };
}

// create_task_snapshot 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_task_snapshot(): TaskSnapshot {
  return {
    runtime_revision: 0,
    task_type: "translation",
    status: "idle",
    busy: false,
    request_in_flight_count: 0,
    progress: {
      line: 0,
      total_line: 0,
      processed_line: 0,
      error_line: 0,
      total_tokens: 0,
      total_output_tokens: 0,
      total_input_tokens: 0,
      time: 0,
      start_time: 0,
    },
    extras: {
      kind: "translation",
      scope: { kind: "all" },
    },
  };
}
