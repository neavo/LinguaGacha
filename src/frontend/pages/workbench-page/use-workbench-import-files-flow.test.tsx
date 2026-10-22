import { useEffect, useState, act } from "react";

import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch, DesktopApiError } from "@frontend/app/desktop/desktop-api";
import {
  run_modal_progress_toast,
  read_progress_toast,
} from "@frontend/app/feedback/desktop-toast";
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
vi.mock("@frontend/app/feedback/desktop-toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@frontend/app/feedback/desktop-toast")>()),
  push_error_toast: error_toast,
}));

const api_fetch_mock = vi.mocked(api_fetch);

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@frontend/app/desktop/desktop-api", async (importOriginal) => {
  return {
    ...(await importOriginal<typeof import("@frontend/app/desktop/desktop-api")>()),
    api_fetch: vi.fn(),
  };
});

describe("useWorkbenchImportFilesFlow", () => {
  it.each(["backup", "order", null])("游戏确认取消于 %s，完成确认后才导入", async (cancel) => {
    const game_root = "C:/games/demo",
      orders = [{ game_root, ordered_pcks: ["patch.pck", "base.pck"] }];
    api_fetch_mock
      .mockResolvedValueOnce({
        files_revision: 1,
        files: [{ source_path: game_root, target_rel_path: "demo.godot", conflict: false }],
        contains_game: true,
        godot_packs: [{ game_root, game_name: "demo", external_pcks: ["base.pck", "patch.pck"] }],
      })
      .mockResolvedValueOnce({ accepted: true, changes: [] });
    const snapshots = await mount_hook();
    let pending!: Promise<void>;
    await act(async () => {
      pending = latest_snapshot(snapshots).flow.request_add_files_from_paths([game_root]);
    });
    expect(latest_snapshot(snapshots).flow.godot_pack_order.dialog_props.games).toHaveLength(0);
    await act(async () => {
      latest_snapshot(snapshots).flow.game_backup_confirm.finish(cancel !== "backup");
    });
    if (cancel === "backup") {
      await pending;
      expect(latest_snapshot(snapshots).dialog_state.kind).toBeNull();
      expect(api_fetch_mock).toHaveBeenCalledTimes(1);
      return;
    }
    expect(latest_snapshot(snapshots).flow.godot_pack_order.dialog_props.games).toHaveLength(1);
    expect(api_fetch_mock).toHaveBeenCalledTimes(1);
    await act(async () => {
      latest_snapshot(snapshots).flow.godot_pack_order.finish(cancel ? null : orders);
      await pending;
    });
    if (cancel) {
      expect(latest_snapshot(snapshots).dialog_state.kind).toBeNull();
      expect(api_fetch_mock).toHaveBeenCalledTimes(1);
    } else {
      await act(async () => {
        await latest_snapshot(snapshots).flow.confirm_dialog();
      });
      expect(api_fetch_mock).toHaveBeenLastCalledWith(
        "/api/workbench/files/import",
        expect.objectContaining({ godot_pack_orders: orders }),
      );
    }
  });

  it.each(["empty", "invalid", "error"])(
    "重新准备失败退出旧确认，恢复后只提交新请求：%s",
    async (failure) => {
      const state = create_project_store_state();
      api_fetch_mock.mockResolvedValueOnce({
        files_revision: 1,
        files: [{ source_path: "C:/source/old.txt", target_rel_path: "old.txt", conflict: true }],
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
      const pending = Promise.withResolvers<{ files: unknown[] }>();
      api_fetch_mock.mockReturnValueOnce(pending.promise);
      let preparation!: Promise<boolean>;
      await act(async () => {
        preparation = latest_snapshot(snapshots).flow.confirm_dialog();
      });
      expect(latest_snapshot(snapshots).dialog_state).toEqual(close_dialog_state());
      const error = new Error("prepare failed");
      await act(async () => {
        if (failure === "empty") pending.resolve({ files: [] });
        else if (failure === "invalid")
          pending.resolve({
            files: [
              null,
              { source_path: {}, target_rel_path: "bad.txt" },
              { source_path: "bad", target_rel_path: 1 },
            ],
          });
        else pending.reject(error);
        await preparation;
      });
      expect(latest_snapshot(snapshots).dialog_state).toEqual(close_dialog_state());
      expect(error_toast).toHaveBeenCalledExactlyOnceWith(
        "app.feedback.operation_failed",
        failure !== "error" ? "workbench_page.feedback.no_valid_file" : error,
      );
      expect(await latest_snapshot(snapshots).flow.confirm_dialog()).toBe(false);

      api_fetch_mock
        .mockResolvedValueOnce({
          files_revision: 2,
          files: [
            { source_path: "C:/source/new.txt", target_rel_path: "new.txt", conflict: false },
          ],
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
    },
  );

  it("预览期间修订变化时采用后端快照，冲突分类不依赖前端文件窗口", async () => {
    const state = create_project_store_state();
    state.files = [];
    const pending = Promise.withResolvers<{
      files_revision: number;
      files: { source_path: string; target_rel_path: string; conflict: boolean }[];
    }>();
    api_fetch_mock.mockReturnValueOnce(pending.promise);
    const snapshots = await mount_hook({ state });
    let preview!: Promise<void>;
    await act(async () => {
      preview = latest_snapshot(snapshots).flow.request_add_files_from_paths(["C:/source/OLD.txt"]);
    });
    state.section_revisions.files = 2;
    await act(async () => {
      pending.resolve({
        files_revision: 2,
        files: [{ source_path: "C:/source/OLD.txt", target_rel_path: "old.txt", conflict: true }],
      });
      await preview;
    });
    expect(latest_snapshot(snapshots).dialog_state.kind).toBe("confirm-import-files");
    await act(async () => {
      await latest_snapshot(snapshots).flow.confirm_dialog();
    });
    api_fetch_mock.mockResolvedValueOnce({ accepted: true, changes: [] });
    await act(async () => {
      await latest_snapshot(snapshots).flow.secondary_dialog();
    });
    expect(api_fetch_mock.mock.calls.map(([url]) => url)).toEqual([
      "/api/workbench/files/preview",
      "/api/workbench/files/import",
    ]);
    expect(api_fetch_mock).toHaveBeenLastCalledWith(
      "/api/workbench/files/import",
      expect.objectContaining({
        files: [{ source_path: "C:/source/OLD.txt", target_rel_path: "old.txt" }],
        conflict_action: "replace",
        expected_section_revisions: { files: 2, items: 2 },
      }),
    );
  });

  it("普通提交失败保留当前确认和名称，可直接重试", async () => {
    const file = { source_path: "C:/source/new.txt", target_rel_path: "new.txt", conflict: false };
    const error = new Error("write failed");
    api_fetch_mock
      .mockResolvedValueOnce({ files_revision: 1, files: [file] })
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
      files_revision: name === original ? 1 : 2,
      files: [{ source_path: "C:/source/game", target_rel_path: name, conflict: false }],
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
          throw new DesktopApiError({ code: "data.revision_conflict" });
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
      "/api/workbench/files/preview",
      "/api/workbench/files/preview",
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
        files_revision: 1,
        files: [
          {
            source_path: "C:/source/ new.txt ",
            target_rel_path: " new.txt",
            conflict: false,
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
        files_revision: 1,
        files: [
          {
            source_path: "C:/source/new.txt",
            target_rel_path: "new.txt",
            conflict: false,
          },
          {
            source_path: "C:/source/old.txt",
            target_rel_path: "old.txt",
            conflict: true,
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
        files_revision: 1,
        files: [
          { source_path: "C:/source/new.txt", target_rel_path: "new.txt", conflict: false },
          { source_path: "C:/source/old-copy.txt", target_rel_path: "old.txt", conflict: true },
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
      files_revision: 1,
      files: [
        { source_path: "C:/source/old-copy.txt", target_rel_path: "old.txt", conflict: true },
      ],
    });
    const snapshots = await mount_hook();

    await act(async () => {
      await latest_snapshot(snapshots).flow.request_add_files_from_paths([
        "C:/source/old-copy.txt",
      ]);
    });
    await act(async () => {
      latest_snapshot(snapshots).flow.close_dialog();
    });

    expect(latest_snapshot(snapshots).dialog_state.kind).toBeNull();
    expect(api_fetch_mock).toHaveBeenCalledOnce();
  });

  it.each(["partial", "all"])(
    "正式导入 %s 失败只在操作结束后提示一次，保留重试入口",
    async (mode) => {
      const failure = {
        filename: "broken.json",
        code: "file.parse_failed",
        message: "Parser rejected the file",
      };
      api_fetch_mock.mockResolvedValueOnce({
        files_revision: 1,
        files: [
          { source_path: "C:/source/new.txt", target_rel_path: "new.txt", conflict: false },
          { source_path: "C:/source/broken.json", target_rel_path: "broken.json", conflict: false },
        ],
      });
      const pending = Promise.withResolvers<ProjectWriteResultPayload>();
      api_fetch_mock.mockReturnValueOnce(pending.promise);
      const push_toast = vi.fn();
      const snapshots = await mount_hook({ push_toast });
      await act(async () => {
        await latest_snapshot(snapshots).flow.request_add_files_from_paths([
          "C:/source/new.txt",
          "C:/source/broken.json",
        ]);
      });
      expect(push_toast).not.toHaveBeenCalled();
      let submission!: Promise<boolean>;
      await act(async () => {
        submission = latest_snapshot(snapshots).flow.confirm_dialog();
      });
      expect(latest_snapshot(snapshots).dialog_state.submitting).toBe(true);
      expect(read_progress_toast()).toMatchObject({ presentation: "modal" });
      await act(async () => {
        if (mode === "all")
          pending.reject(
            new DesktopApiError({
              code: "file.parse_failed",
              details: { failed_files: [failure] },
            }),
          );
        else
          pending.resolve({
            accepted: true,
            changes: [],
            failed_files: [failure],
          } as unknown as ProjectWriteResultPayload);
        await submission;
      });
      expect(read_progress_toast()).toBeNull();
      if (mode === "all") {
        expect(error_toast).toHaveBeenCalledExactlyOnceWith(
          "app.feedback.operation_failed",
          "broken.json - Parser rejected the file",
        );
        expect(latest_snapshot(snapshots).dialog_state).toMatchObject({
          kind: "inherit-import-files",
          submitting: false,
        });
        expect(push_toast).not.toHaveBeenCalled();
      } else {
        expect(push_toast).toHaveBeenCalledExactlyOnceWith(
          "warning",
          "broken.json - Parser rejected the file",
        );
        expect(latest_snapshot(snapshots).dialog_state.kind).toBeNull();
        expect(error_toast).not.toHaveBeenCalled();
      }
    },
  );

  /** 挂载导入流程并记录每次对话框和请求状态。 */
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

/** 连接真实 Hook 与本地对话框状态，按用例注入写入结果。 */
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
    run_modal_progress_toast,
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

/** 从 React 更新记录中取得最新公开状态。 */
function latest_snapshot(snapshots: HookSnapshot[]): HookSnapshot {
  const snapshot = snapshots.at(-1);
  if (snapshot === undefined) {
    throw new Error("没有捕获到 Hook 快照。");
  }
  return snapshot;
}

/** 提供已有文件与修订，使冲突处理使用一致的工程基线。 */
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
