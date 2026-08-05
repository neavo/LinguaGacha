import { describe, expect, it } from "vitest";

import type { GithubReleaseUpdate } from "@frontend/app/desktop/desktop-api";
import {
  format_update_progress_label,
  is_update_dialog_open,
  is_update_dialog_submitting,
  read_update_release,
  resolve_disabled_route_ids,
  resolve_project_route_after_snapshot,
  resolve_route_selection,
  resolve_update_confirm_label,
  type UpdateDialogState,
} from "@frontend/app/app-shell-state";

const release: GithubReleaseUpdate = {
  latest_version: "1.2.4",
  release_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
  windows_zip_urls: { x64: "https://example.com/update.zip" },
};
const t = (key: string): string => key;

describe("App 更新弹窗状态", () => {
  it.each<{
    state: UpdateDialogState;
    open: boolean;
    submitting: boolean;
    label: string;
  }>([
    { state: { phase: "idle" }, open: false, submitting: false, label: "app.action.confirm" },
    {
      state: { phase: "available", release, zip_path: null },
      open: false,
      submitting: false,
      label: "app.action.confirm",
    },
    {
      state: { phase: "confirming", release },
      open: true,
      submitting: false,
      label: "app.action.confirm",
    },
    {
      state: { phase: "downloading", release, progress_percent: 45.678 },
      open: true,
      submitting: true,
      label: "45.68%",
    },
    {
      state: { phase: "ready_to_restart", release, zip_path: "E:/update.zip" },
      open: true,
      submitting: false,
      label: "app.update.restart_confirm",
    },
    {
      state: { phase: "launching", release, zip_path: "E:/update.zip" },
      open: true,
      submitting: true,
      label: "app.update.launching",
    },
  ])("按 $state.phase 阶段解析可见性、提交态和按钮", ({ state, open, submitting, label }) => {
    expect(is_update_dialog_open(state)).toBe(open);
    expect(is_update_dialog_submitting(state)).toBe(submitting);
    expect(resolve_update_confirm_label(state, t)).toBe(label);
    expect(read_update_release(state)).toBe(state.phase === "idle" ? null : release);
  });

  it("下载进度限制在 0..100", () => {
    expect(format_update_progress_label(-1)).toBe("0.00%");
    expect(format_update_progress_label(101)).toBe("100.00%");
  });
});

describe("App 项目导航状态", () => {
  it("未加载项目时把项目入口保存为待恢复路由", () => {
    expect(
      resolve_route_selection({
        route_id: "agent",
        project_loaded: false,
        project_session_status: "idle",
        pending_target_route: null,
      }),
    ).toEqual({ selected_route: "project-home", pending_target_route: "agent" });
  });

  it("非项目路由直接进入并清除待恢复路由", () => {
    expect(
      resolve_route_selection({
        route_id: "model",
        project_loaded: false,
        project_session_status: "idle",
        pending_target_route: "agent",
      }),
    ).toEqual({ selected_route: "model", pending_target_route: null });
  });

  it("项目就绪时恢复兼容路由，否则进入工作台", () => {
    const base = {
      previous_project_loaded: false,
      previous_project_path: "",
      previous_project_session_status: "idle" as const,
      project_loaded: true,
      project_path: "E:/demo/sample.lg",
      project_session_status: "ready" as const,
    };

    expect(
      resolve_project_route_after_snapshot({
        ...base,
        pending_target_route: "text-replacement",
      }),
    ).toEqual({
      selected_route: "pre-translation-replacement",
      pending_target_route: null,
    });
    expect(
      resolve_project_route_after_snapshot({
        ...base,
        pending_target_route: null,
      }),
    ).toEqual({ selected_route: "workbench", pending_target_route: null });
  });

  it("项目卸载时回到项目首页", () => {
    expect(
      resolve_project_route_after_snapshot({
        previous_project_loaded: true,
        previous_project_path: "E:/demo/sample.lg",
        previous_project_session_status: "ready",
        project_loaded: false,
        project_path: "",
        project_session_status: "idle",
        pending_target_route: "agent",
      }),
    ).toEqual({ selected_route: "project-home", pending_target_route: null });
  });

  it("项目状态决定导航禁用集合", () => {
    const unloaded = resolve_disabled_route_ids({
      project_loaded: false,
      project_session_status: "idle",
    });
    const warming = resolve_disabled_route_ids({
      project_loaded: true,
      project_session_status: "warming",
    });
    const ready = resolve_disabled_route_ids({
      project_loaded: true,
      project_session_status: "ready",
    });

    expect(unloaded.has("agent")).toBe(false);
    expect(unloaded.has("glossary")).toBe(true);
    expect(warming.has("agent")).toBe(true);
    expect(warming.has("glossary")).toBe(true);
    expect(ready.size).toBe(0);
  });
});
