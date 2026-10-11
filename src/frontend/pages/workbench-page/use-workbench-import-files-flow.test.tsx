import { useEffect, useState, act } from "react";

import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { AppError } from "@shared/error";
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

const error_toast = vi.hoisted(() => vi.fn());
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_error_toast: error_toast }));

const api_fetch_mock = vi.mocked(api_fetch);

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: vi.fn(),
  };
});

describe("useWorkbenchImportFilesFlow", () => {
  it.each(["empty", "error"])("重新准备失败退出旧确认，恢复后只提交新请求：%s", async (failure) => {
    const state = create_project_store_state();
    api_fetch_mock.mockResolvedValueOnce({
      files: [{ source_path: "C:/source/old.txt", target_rel_path: "old.txt" }],
    });
    const snapshots = await mount_hook({ state });
    await act(async () => {
      await latest_snapshot(snapshots).flow.request_add_files_from_paths(["C:/source/old.txt"]);
    });
    await act(async () => {
      await latest_snapshot(snapshots).flow.confirm_dialog();
    });
    expect(latest_snapshot(snapshots).dialog_state.kind).toBe("inherit-import-files");

    state.section_revisions.files = 2;
    const pending = Promise.withResolvers<{ files: [] }>();
    api_fetch_mock.mockReturnValueOnce(pending.promise);
    let preparation!: Promise<boolean>;
    await act(async () => {
      preparation = latest_snapshot(snapshots).flow.confirm_dialog();
    });
    expect(latest_snapshot(snapshots).dialog_state).toEqual(close_dialog_state());
    const error = new Error("prepare failed");
    await act(async () => {
      if (failure === "empty") pending.resolve({ files: [] });
      else pending.reject(error);
      await preparation;
    });
    expect(latest_snapshot(snapshots).dialog_state).toEqual(close_dialog_state());
    expect(error_toast).toHaveBeenCalledExactlyOnceWith(
      "app.feedback.operation_failed",
      failure === "empty" ? "workbench_page.feedback.no_valid_file" : error,
    );
    expect(await latest_snapshot(snapshots).flow.confirm_dialog()).toBe(false);

    api_fetch_mock
      .mockResolvedValueOnce({
        files: [{ source_path: "C:/source/new.txt", target_rel_path: "new.txt" }],
      })
      .mockResolvedValueOnce({ accepted: true, changes: [] });
    await act(async () => {
      await latest_snapshot(snapshots).flow.request_add_files_from_paths(["C:/source/new.txt"]);
    });
    await act(async () => {
      await latest_snapshot(snapshots).flow.secondary_dialog();
    });
    const imports = api_fetch_mock.mock.calls.filter(
      ([url]) => url === "/api/workbench/files/import",
    );
    expect(imports).toEqual([
      [
        "/api/workbench/files/import",
        expect.objectContaining({
          files: [{ source_path: "C:/source/new.txt", target_rel_path: "new.txt" }],
          conflict_action: "skip",
          inheritance_mode: "none",
          expected_section_revisions: { files: 2, items: 2 },
        }),
      ],
    ]);
    expect(latest_snapshot(snapshots).dialog_state).toEqual(close_dialog_state());
  });

  it("普通提交失败保留当前确认和名称，可直接重试", async () => {
    const file = { source_path: "C:/source/new.txt", target_rel_path: "new.txt" };
    const error = new Error("write failed");
    api_fetch_mock
      .mockResolvedValueOnce({ files: [file] })
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ accepted: true, changes: [] });
    const snapshots = await mount_hook();
    await act(async () => {
      await latest_snapshot(snapshots).flow.request_add_files_from_paths([file.source_path]);
    });
    await act(async () => {
      await latest_snapshot(snapshots).flow.confirm_dialog();
    });
    expect(latest_snapshot(snapshots).dialog_state).toMatchObject({
      kind: "inherit-import-files",
      target_rel_paths: [file.target_rel_path],
      submitting: false,
    });
    expect(error_toast).toHaveBeenCalledExactlyOnceWith("app.feedback.operation_failed", error);
    await act(async () => {
      await latest_snapshot(snapshots).flow.confirm_dialog();
    });
    expect(api_fetch_mock.mock.calls[2]).toEqual(api_fetch_mock.mock.calls[1]);
    expect(latest_snapshot(snapshots).dialog_state).toEqual(close_dialog_state());
  });
  it.each(["before-submit", "during-submit"])("文件修订变化后重新准备名称：%s", async (phase) => {
    const state = create_project_store_state();
    const original = "game_20261011_123456";
    const renamed = original + "_2";
    const files = (name: string) => ({
      files: [{ source_path: "C:/source/game", target_rel_path: name }],
    });
    api_fetch_mock.mockResolvedValueOnce(files(original));
    const write = vi.fn(
      async (
        plan: WorkbenchCommandPlan,
        request: (body: Record<string, unknown>) => Promise<ProjectWriteResultPayload>,
      ) => {
        if (phase === "during-submit" && state.section_revisions.files === 1) {
          state.section_revisions.files = 2;
          state.files.push({ rel_path: original });
          throw new AppError("data.revision_conflict");
        }
        return request(plan.requestBody);
      },
    );
    const snapshots = await mount_hook({ state, run_project_file_write: write });
    await act(async () => {
      await latest_snapshot(snapshots).flow.request_add_files_from_paths(["C:/source/game"]);
    });
    if (phase === "before-submit") {
      state.section_revisions.files = 2;
      state.files.push({ rel_path: original });
    }
    api_fetch_mock.mockResolvedValueOnce(files(renamed));
    await act(async () => {
      await latest_snapshot(snapshots).flow.secondary_dialog();
    });
    expect(latest_snapshot(snapshots).dialog_state).toMatchObject({
      kind: "inherit-import-files",
      target_rel_paths: [renamed],
      submitting: false,
    });
    expect(api_fetch_mock.mock.calls.map(([url]) => url)).toEqual([
      "/api/workbench/file/parse",
      "/api/workbench/file/parse",
    ]);
    api_fetch_mock.mockResolvedValueOnce({ accepted: true, changes: [] });
    await act(async () => {
      await latest_snapshot(snapshots).flow.secondary_dialog();
    });
    expect(api_fetch_mock).toHaveBeenLastCalledWith(
      "/api/workbench/files/import",
      expect.objectContaining({
        files: [{ source_path: "C:/source/game", target_rel_path: renamed }],
        expected_section_revisions: { files: 2, items: 2 },
      }),
    );
  });
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
    error_toast.mockReset();
  });

  it("新增文件先进入继承确认，取消继承后提交后端导入命令", async () => {
    api_fetch_mock
      .mockResolvedValueOnce({
        files: [
          {
            source_path: "C:/source/ new.txt ",
            target_rel_path: " new.txt",
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
      await latest_snapshot(snapshots).flow.request_add_files_from_paths(["C:/source/ new.txt "]);
    });

    expect(latest_snapshot(snapshots).dialog_state).toMatchObject({
      kind: "inherit-import-files",
      target_rel_paths: [" new.txt"],
      pending_path: "C:/source/ new.txt ",
      submitting: false,
    });

    await act(async () => {
      await latest_snapshot(snapshots).flow.secondary_dialog();
    });

    expect(write_payloads).toEqual([
      {
        files: [{ source_path: "C:/source/ new.txt ", target_rel_path: " new.txt" }],
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
          message: "Parser rejected the file",
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
    expect(push_toast).toHaveBeenCalledWith("warning", "broken.json - Parser rejected the file");
  });

  it("全部文件解析失败时只展示一次阻断错误", async () => {
    api_fetch_mock.mockResolvedValueOnce({
      files: [],
      failed_files: [
        {
          filename: "broken.json",
          code: "file.parse_failed",
          message: "Parser rejected the file",
        },
      ],
    });
    const push_toast = vi.fn();
    const snapshots = await mount_hook({ push_toast });

    await act(async () => {
      await latest_snapshot(snapshots).flow.request_add_files_from_paths(["C:/source/broken.json"]);
    });

    expect(latest_snapshot(snapshots).dialog_state.kind).toBeNull();
    expect(error_toast).toHaveBeenCalledExactlyOnceWith(
      "app.feedback.operation_failed",
      "broken.json - Parser rejected the file",
    );
    expect(push_toast).not.toHaveBeenCalled();
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
          {...(options.run_project_file_write === undefined
            ? {}
            : { run_project_file_write: options.run_project_file_write })}
          {...(options.push_toast === undefined ? {} : { push_toast: options.push_toast })}
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
    },
  };
}
