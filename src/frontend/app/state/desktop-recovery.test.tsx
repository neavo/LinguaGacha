import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useDesktopRecovery,
  type DesktopRecoveryActions,
} from "@frontend/app/state/desktop-recovery";
import type { TaskSnapshot } from "@frontend/app/state/task-snapshot-store";
import type { TaskType } from "@domain/task";

// capture renderer error mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const capture_renderer_error_mock = vi.hoisted(() => vi.fn());

vi.mock("@frontend/app/diagnostics/renderer-error-reporter", () => {
  return {
    capture_renderer_error: capture_renderer_error_mock,
  };
});

type RecoveryProbeProps = {
  projectLoaded: boolean;
  projectPath: string;
  refreshProjectState: () => Promise<void>;
  refreshTask: (task_type?: TaskType) => Promise<TaskSnapshot>;
  onActions: (actions: DesktopRecoveryActions) => void;
};

/**
 * 渲染当前组件的公开界面。
 */
function RecoveryProbe(props: RecoveryProbeProps): null {
  const actions = useDesktopRecovery({
    project_loaded: props.projectLoaded,
    project_path: props.projectPath,
    refresh_project_state: props.refreshProjectState,
    refresh_task: props.refreshTask,
  });

  useEffect(() => {
    props.onActions(actions);
  }, [actions, props]);

  return null;
}

describe("useDesktopRecovery", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    capture_renderer_error_mock.mockClear();
    root?.unmount();
    root = null;
    host?.remove();
    host = null;
  });

  it("项目恢复失败时写入 state-recovery 诊断上下文", async () => {
    const refresh_project_state = vi.fn(async () => {
      throw new Error("manifest boom");
    });
    const refresh_task = vi.fn(async () => ({}) as TaskSnapshot);
    const actions: { current: DesktopRecoveryActions | null } = { current: null };

    await render_probe({
      projectLoaded: true,
      projectPath: "E:/demo/demo.lg",
      refreshProjectState: refresh_project_state,
      refreshTask: refresh_task,
      onActions: (next_actions) => {
        actions.current = next_actions;
      },
    });

    const state_actions = actions.current;
    if (state_actions === null) {
      throw new Error("state recovery actions 未初始化。");
    }

    await act(async () => {
      await state_actions.refresh_project_state_after_error(
        "entries_save",
        {
          source: "quality_rule_save_entries",
        },
        {
          page: "glossary",
        },
      );
    });

    expect(refresh_project_state).toHaveBeenCalledTimes(1);
    expect(capture_renderer_error_mock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        source: "state-recovery",
        triggeringEvent: {
          source: "quality_rule_save_entries",
        },
        context: expect.objectContaining({
          reason: "entries_save",
          recovery: "project_state",
          page: "glossary",
        }),
      }),
    );
  });

  it("未加载项目时不会发起项目恢复刷新", async () => {
    const refresh_project_state = vi.fn(async () => {});
    const refresh_task = vi.fn(async () => ({}) as TaskSnapshot);
    const actions: { current: DesktopRecoveryActions | null } = { current: null };

    await render_probe({
      projectLoaded: false,
      projectPath: "",
      refreshProjectState: refresh_project_state,
      refreshTask: refresh_task,
      onActions: (next_actions) => {
        actions.current = next_actions;
      },
    });

    const state_actions = actions.current;
    if (state_actions === null) {
      throw new Error("state recovery actions 未初始化。");
    }

    await act(async () => {
      await state_actions.refresh_project_state_after_error("entries_save", undefined, {
        page: "glossary",
      });
    });

    expect(refresh_project_state).not.toHaveBeenCalled();
    expect(capture_renderer_error_mock).not.toHaveBeenCalled();
  });

  it("同一项目的并发项目恢复只共享一次完整刷新", async () => {
    let finish_refresh = (): void => {
      throw new Error("项目恢复刷新尚未启动。");
    };
    const refresh_project_state = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish_refresh = resolve;
        }),
    );
    const refresh_task = vi.fn(async () => ({}) as TaskSnapshot);
    const actions: { current: DesktopRecoveryActions | null } = { current: null };

    await render_probe({
      projectLoaded: true,
      projectPath: "E:/demo/demo.lg",
      refreshProjectState: refresh_project_state,
      refreshTask: refresh_task,
      onActions: (next_actions) => {
        actions.current = next_actions;
      },
    });

    const state_actions = actions.current;
    if (state_actions === null) {
      throw new Error("state recovery actions 未初始化。");
    }

    const first_recovery = state_actions.refresh_project_state_after_error("sse_failed", {
      topic: "project.data_changed",
    });
    const second_recovery = state_actions.refresh_project_state_after_error("write_failed", {
      operation: "save_quality_rule",
    });
    await Promise.resolve();

    expect(refresh_project_state).toHaveBeenCalledTimes(1);
    finish_refresh();
    await Promise.all([first_recovery, second_recovery]);
    expect(capture_renderer_error_mock).not.toHaveBeenCalled();
  });

  // render_probe 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
  /**
   * 生成当前场景的展示内容。
   */
  async function render_probe(props: RecoveryProbeProps): Promise<void> {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(RecoveryProbe, props));
      await Promise.resolve();
    });
  }
});
