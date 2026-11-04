import { describe, expect, it } from "vitest";

import type { GithubReleaseUpdate } from "@frontend/app/desktop/desktop-api";
import {
  format_update_progress_label,
  is_update_dialog_open,
  is_update_dialog_submitting,
  read_update_release,
  resolve_disabled_route_ids,
  resolve_route_after_project_snapshot,
  resolve_update_action_label,
  type UpdateDialogState,
} from "@frontend/app/app-shell-state";

const release: GithubReleaseUpdate = {
  latest_version: "1.2.4",
  release_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
  release_notes: "",
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
    { state: { phase: "idle" }, open: false, submitting: false, label: "app.update.action" },
    {
      state: { phase: "available", release, zip_path: null },
      open: false,
      submitting: false,
      label: "app.update.action",
    },
    {
      state: { phase: "confirming", release },
      open: true,
      submitting: false,
      label: "app.update.action",
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
    expect(resolve_update_action_label(state, t)).toBe(label);
    expect(read_update_release(state)).toBe(state.phase === "idle" ? null : release);
  });

  it("下载进度限制在 0..100", () => {
    expect(format_update_progress_label(-1)).toBe("0.00%");
    expect(format_update_progress_label(101)).toBe("100.00%");
  });
});

describe("App 工程导航状态", () => {
  it.each([
    { project_loaded: false, project_session_status: "idle", disabled: true },
    { project_loaded: true, project_session_status: "warming", disabled: true },
    { project_loaded: true, project_session_status: "ready", disabled: false },
  ] as const)("工程可用性 $project_loaded/$project_session_status", (args) => {
    const routes = resolve_disabled_route_ids(args);
    for (const route of [
      "proofreading",
      "workbench",
      "glossary",
      "text-preserve",
      "pre-translation-replacement",
      "post-translation-replacement",
      "knowledge",
      "custom-prompt",
      "laboratory",
    ] as const)
      expect(routes.has(route)).toBe(args.disabled);
    expect(routes.has("agent")).toBe(false);
    expect(routes.has("model")).toBe(false);
  });
  it.each([
    [true, false, "agent"],
    [false, true, null],
    [true, true, null],
    [false, false, null],
  ] as const)("工程快照 %s → %s", (previous_project_loaded, project_loaded, expected) => {
    expect(resolve_route_after_project_snapshot({ previous_project_loaded, project_loaded })).toBe(
      expected,
    );
  });
});
