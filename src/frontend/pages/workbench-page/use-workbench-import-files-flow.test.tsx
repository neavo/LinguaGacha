import { useEffect, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type { ProjectWriteResultPayload } from "@frontend/app/state/desktop-project-write";
import type {
  WorkbenchCommandPlanningState,
  WorkbenchCommandPlan,
} from "@shared/workbench/workbench-command-planner";
import type { WorkbenchDialogState } from "@frontend/pages/workbench-page/types";
import {
  close_dialog_state,
  useWorkbenchImportFilesFlow,
  type WorkbenchImportFilesFlow,
} from "@frontend/pages/workbench-page/use-workbench-import-files-flow";

type HookSnapshot = {
  flow: WorkbenchImportFilesFlow;
  dialog_state: WorkbenchDialogState;
};

const api_fetch_mock = vi.mocked(api_fetch);

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: vi.fn(),
  };
});

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
    const write_payloads: Record<string, unknown>[] = [];
    const snapshots = await mount_hook({
      run_project_file_write: async (plan, request) => {
        write_payloads.push(plan.requestBody);
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
      await latest_snapshot(snapshots).flow.secondary_dialog();
    });

    expect(write_payloads).toEqual([
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
      "/api/workbench/files/import",
      write_payloads[0],
    );
    expect(latest_snapshot(snapshots).dialog_state.kind).toBeNull();
  });

  it("新增与同名文件混合导入时，确认替换后两者一起提交", async () => {
    api_fetch_mock
      .mockResolvedValueOnce({
        files: [
          {
            source_path: "C:/source/new.txt",
            target_rel_path: "new.txt",
            file_type: "TXT",
            parsed_items: [{ src: "新增文本" }],
          },
          {
            source_path: "C:/source/old.txt",
            target_rel_path: "old.txt",
            file_type: "TXT",
            parsed_items: [{ src: "替换文本" }],
          },
        ],
      })
      .mockResolvedValueOnce({ accepted: true, changes: [] });
    const write_payloads: Record<string, unknown>[] = [];
    const snapshots = await mount_hook({
      run_project_file_write: async (plan, request) => {
        write_payloads.push(plan.requestBody);
        return await request(plan.requestBody);
      },
    });

    await act(async () => {
      await latest_snapshot(snapshots).flow.request_add_files_from_paths([
        "C:/source/new.txt",
        "C:/source/old.txt",
      ]);
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
      target_rel_paths: ["new.txt", "old.txt"],
      pending_path: "C:/source/new.txt",
    });

    await act(async () => {
      await latest_snapshot(snapshots).flow.confirm_dialog();
    });

    expect(write_payloads[0]).toMatchObject({
      files: [
        { source_path: "C:/source/new.txt", target_rel_path: "new.txt" },
        { source_path: "C:/source/old.txt", target_rel_path: "old.txt" },
      ],
      conflict_action: "replace",
      inheritance_mode: "inherit",
    });
    expect(latest_snapshot(snapshots).dialog_state.kind).toBeNull();
  });

  it("跳过同名文件时只导入新增文件", async () => {
    api_fetch_mock
      .mockResolvedValueOnce({
        files: [
          { source_path: "C:/source/new.txt", target_rel_path: "new.txt" },
          { source_path: "C:/source/old-copy.txt", target_rel_path: "old.txt" },
        ],
      })
      .mockResolvedValueOnce({ accepted: true, changes: [] });
    const write_payloads: Record<string, unknown>[] = [];
    const snapshots = await mount_hook({
      run_project_file_write: async (plan, request) => {
        write_payloads.push(plan.requestBody);
        return await request(plan.requestBody);
      },
    });

    await act(async () => {
      await latest_snapshot(snapshots).flow.request_add_files_from_paths([
        "C:/source/new.txt",
        "C:/source/old-copy.txt",
      ]);
    });
    await act(async () => {
      await latest_snapshot(snapshots).flow.secondary_dialog();
    });
    expect(latest_snapshot(snapshots).dialog_state).toMatchObject({
      kind: "inherit-import-files",
      target_rel_paths: ["new.txt"],
    });

    await act(async () => {
      await latest_snapshot(snapshots).flow.secondary_dialog();
    });

    expect(write_payloads[0]).toMatchObject({
      files: [{ source_path: "C:/source/new.txt", target_rel_path: "new.txt" }],
      conflict_action: "skip",
      inheritance_mode: "none",
    });
  });

  it("取消同名确认时不提交导入", async () => {
    api_fetch_mock.mockResolvedValueOnce({
      files: [{ source_path: "C:/source/old-copy.txt", target_rel_path: "old.txt" }],
    });
    const snapshots = await mount_hook();

    await act(async () => {
      await latest_snapshot(snapshots).flow.request_add_file_from_path("C:/source/old-copy.txt");
    });
    await act(async () => {
      latest_snapshot(snapshots).flow.close_dialog();
    });

    expect(latest_snapshot(snapshots).dialog_state.kind).toBeNull();
    expect(api_fetch_mock).toHaveBeenCalledOnce();
  });

  it("部分文件解析失败时提示跳过并继续有效文件", async () => {
    api_fetch_mock.mockResolvedValueOnce({
      files: [{ source_path: "C:/source/new.txt", target_rel_path: "new.txt" }],
      failed_files: [
        {
          filename: "broken.json",
          code: "file.parse_failed",
        },
      ],
    });
    const push_toast = vi.fn();
    const snapshots = await mount_hook({ push_toast });

    await act(async () => {
      await latest_snapshot(snapshots).flow.request_add_files_from_paths([
        "C:/source/new.txt",
        "C:/source/broken.json",
      ]);
    });

    expect(latest_snapshot(snapshots).dialog_state.kind).toBe("inherit-import-files");
    expect(push_toast).toHaveBeenCalledWith(
      "warning",
      "broken.json - app.error.file.parse_failed.message",
    );
  });

  it("全部文件解析失败时只展示一次阻断错误", async () => {
    api_fetch_mock.mockResolvedValueOnce({
      files: [],
      failed_files: [
        {
          filename: "broken.json",
          code: "file.parse_failed",
        },
      ],
    });
    const push_toast = vi.fn();
    const snapshots = await mount_hook({ push_toast });

    await act(async () => {
      await latest_snapshot(snapshots).flow.request_add_files_from_paths(["C:/source/broken.json"]);
    });

    expect(latest_snapshot(snapshots).dialog_state.kind).toBeNull();
    expect(push_toast).toHaveBeenCalledOnce();
    expect(push_toast).toHaveBeenCalledWith(
      "error",
      "broken.json - app.error.file.parse_failed.message",
    );
  });

  async function mount_hook(
    options: {
      state?: WorkbenchCommandPlanningState;
      run_project_file_write?: (
        plan: WorkbenchCommandPlan,
        request: (body: Record<string, unknown>) => Promise<ProjectWriteResultPayload>,
      ) => Promise<ProjectWriteResultPayload>;
      push_toast?: (kind: "info" | "success" | "warning" | "error", message: string) => unknown;
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
          run_project_file_write={options.run_project_file_write}
          push_toast={options.push_toast}
          onSnapshot={(snapshot) => {
            snapshots.push(snapshot);
          }}
        />,
      );
    });

    return snapshots;
  }
});

function HookProbe(props: {
  state: WorkbenchCommandPlanningState;
  run_project_file_write?: (
    plan: WorkbenchCommandPlan,
    request: (body: Record<string, unknown>) => Promise<ProjectWriteResultPayload>,
  ) => Promise<ProjectWriteResultPayload>;
  push_toast?: (kind: "info" | "success" | "warning" | "error", message: string) => unknown;
  onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
  const [dialog_state, set_dialog_state] = useState<WorkbenchDialogState>(close_dialog_state());
  const flow = useWorkbenchImportFilesFlow({
    readonly: false,
    project_identity: "E:/demo/project.lg",
    dialog_state,
    get_planning_state: () => props.state,
    planner_settings: {
      source_language: "JA",
      mtool_optimizer_enable: true,
      skip_duplicate_source_text_enable: false,
    },
    run_modal_progress_toast: async (args) => {
      return await args.task();
    },
    run_project_file_write:
      props.run_project_file_write ??
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
    push_toast: props.push_toast ?? vi.fn(),
    t: (key) => key,
  });

  useEffect(() => {
    props.onSnapshot({ flow, dialog_state });
  }, [dialog_state, flow, props]);

  return null;
}

function latest_snapshot(snapshots: HookSnapshot[]): HookSnapshot {
  const snapshot = snapshots.at(-1);
  if (snapshot === undefined) {
    throw new Error("没有捕获到 Hook 快照。");
  }
  return snapshot;
}

function create_project_store_state(): WorkbenchCommandPlanningState {
  return {
    files: [
      {
        rel_path: "old.txt",
      },
    ],
    section_revisions: {
      files: 1,
      items: 2,
      analysis: 3,
    },
  };
}
