import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useDesktopRuntimeRecovery,
  type DesktopRuntimeRecoveryActions,
} from "@/app/desktop/desktop-runtime-recovery";
import type { TaskSnapshot } from "@/app/desktop/task-runtime-store";
import type { TaskType } from "@domain/task";

// capture renderer error mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const capture_renderer_error_mock = vi.hoisted(() => vi.fn());

vi.mock("@/app/diagnostics/renderer-error-reporter", () => {
  return {
    capture_renderer_error: capture_renderer_error_mock,
  };
});

type RecoveryProbeProps = {
  projectLoaded: boolean;
  projectPath: string;
  refreshProjectRuntime: () => Promise<void>;
  refreshTask: (task_type?: TaskType) => Promise<TaskSnapshot>;
  onActions: (actions: DesktopRuntimeRecoveryActions) => void;
};

// RecoveryProbe 收口测试中的共享步骤，保证断言只关注当前行为。
/**
 * 渲染当前组件的公开界面。
 */
function RecoveryProbe(props: RecoveryProbeProps): null {
  const actions = useDesktopRuntimeRecovery({
    project_loaded: props.projectLoaded,
    project_path: props.projectPath,
    refresh_project_runtime: props.refreshProjectRuntime,
    refresh_task: props.refreshTask,
  });

  useEffect(() => {
    props.onActions(actions);
  }, [actions, props]);

  return null;
}

describe("useDesktopRuntimeRecovery", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    capture_renderer_error_mock.mockClear();
    root?.unmount();
    root = null;
    host?.remove();
    host = null;
  });

  it("项目恢复失败时写入 runtime-recovery 诊断上下文", async () => {
    const refresh_project_runtime = vi.fn(async () => {
      throw new Error("manifest boom");
    });
    const refresh_task = vi.fn(async () => ({}) as TaskSnapshot);
    const actions: { current: DesktopRuntimeRecoveryActions | null } = { current: null };

    await render_probe({
      projectLoaded: true,
      projectPath: "E:/demo/demo.lg",
      refreshProjectRuntime: refresh_project_runtime,
      refreshTask: refresh_task,
      onActions: (next_actions) => {
        actions.current = next_actions;
      },
    });

    const runtime_actions = actions.current;
    if (runtime_actions === null) {
      throw new Error("runtime recovery actions 未初始化。");
    }

    await act(async () => {
      await runtime_actions.refresh_project_runtime_after_error(
        "entries_save",
        {
          source: "quality_rule_save_entries",
        },
        {
          page: "glossary",
        },
      );
    });

    expect(refresh_project_runtime).toHaveBeenCalledTimes(1);
    expect(capture_renderer_error_mock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        source: "runtime-recovery",
        triggeringEvent: {
          source: "quality_rule_save_entries",
        },
        context: expect.objectContaining({
          reason: "entries_save",
          recovery: "project_runtime",
          page: "glossary",
        }),
      }),
    );
  });

  it("未加载项目时不会发起项目恢复刷新", async () => {
    const refresh_project_runtime = vi.fn(async () => {});
    const refresh_task = vi.fn(async () => ({}) as TaskSnapshot);
    const actions: { current: DesktopRuntimeRecoveryActions | null } = { current: null };

    await render_probe({
      projectLoaded: false,
      projectPath: "",
      refreshProjectRuntime: refresh_project_runtime,
      refreshTask: refresh_task,
      onActions: (next_actions) => {
        actions.current = next_actions;
      },
    });

    const runtime_actions = actions.current;
    if (runtime_actions === null) {
      throw new Error("runtime recovery actions 未初始化。");
    }

    await act(async () => {
      await runtime_actions.refresh_project_runtime_after_error("entries_save", undefined, {
        page: "glossary",
      });
    });

    expect(refresh_project_runtime).not.toHaveBeenCalled();
    expect(capture_renderer_error_mock).not.toHaveBeenCalled();
  });

  it("同一项目的并发项目恢复只共享一次完整刷新", async () => {
    let finish_refresh = (): void => {
      throw new Error("项目恢复刷新尚未启动。");
    };
    const refresh_project_runtime = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish_refresh = resolve;
        }),
    );
    const refresh_task = vi.fn(async () => ({}) as TaskSnapshot);
    const actions: { current: DesktopRuntimeRecoveryActions | null } = { current: null };

    await render_probe({
      projectLoaded: true,
      projectPath: "E:/demo/demo.lg",
      refreshProjectRuntime: refresh_project_runtime,
      refreshTask: refresh_task,
      onActions: (next_actions) => {
        actions.current = next_actions;
      },
    });

    const runtime_actions = actions.current;
    if (runtime_actions === null) {
      throw new Error("runtime recovery actions 未初始化。");
    }

    const first_recovery = runtime_actions.refresh_project_runtime_after_error("sse_failed", {
      topic: "project.data_changed",
    });
    const second_recovery = runtime_actions.refresh_project_runtime_after_error("mutation_failed", {
      operation: "save_quality_rule",
    });
    await Promise.resolve();

    expect(refresh_project_runtime).toHaveBeenCalledTimes(1);
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
