import { normalize_setting_snapshot } from "@domain/setting";
import { type JSX, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type {
  SettingsSnapshot,
  SettingsSnapshotPayload,
} from "@frontend/app/state/desktop-state-context";
import { useFunctionSettingsState } from "@frontend/pages/function-settings-page/use-function-settings-state";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

type RuntimeFixture = {
  settings_snapshot: SettingsSnapshot;
  runtime_snapshot: { revision: number; owner: "batch_translation" | "agent" | null };
  project_snapshot: {
    loaded: boolean;
    path: string;
    languages: { source_language: string; target_language: string } | null;
  };
  apply_settings_snapshot: ReturnType<typeof vi.fn>;
  commit_project_write: ReturnType<typeof vi.fn>;
  refresh_settings: ReturnType<typeof vi.fn>;
};

type ToastFixture = {
  push_toast: ReturnType<typeof vi.fn>;
  run_modal_progress_toast: ReturnType<typeof vi.fn>;
};

const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

const toast_fixture: { current: ToastFixture } = {
  current: create_toast_fixture(),
};

const translate = (key: string): string => key;

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => runtime_fixture.current,
    useRuntimeSnapshot: () => runtime_fixture.current.runtime_snapshot,
  };
});

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  get push_error_toast() {
    return toast_fixture.current.push_toast;
  },
  get push_toast() {
    return toast_fixture.current.push_toast;
  },
  get run_modal_progress_toast() {
    return toast_fixture.current.run_modal_progress_toast;
  },
}));

vi.mock("@frontend/app/locale/locale-context", () => {
  return {
    useI18n: () => {
      return {
        t: translate,
      };
    },
  };
});

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: vi.fn(),
    report_renderer_error: vi.fn(async () => undefined),
    DesktopApiError: class DesktopApiError extends Error {},
  };
});

/** 用生产归一化规则补齐应用设置夹具。 */
function create_settings_snapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return normalize_setting_snapshot({
    app_language: "ZH",
    request_timeout: 300,
    mtool_optimizer_enable: false,
    skip_duplicate_source_text_enable: true,
    ...overrides,
  });
}

/** 分别提供应用设置与项目语言，验证保存入口的归属。 */
function create_runtime_fixture(): RuntimeFixture {
  const settings_snapshot = create_settings_snapshot();
  return {
    settings_snapshot,
    runtime_snapshot: { revision: 0, owner: null },
    project_snapshot: {
      loaded: true,
      path: "E:/demo/sample.lg",
      languages: { source_language: "JA", target_language: "ZH" },
    },
    apply_settings_snapshot: vi.fn((payload: SettingsSnapshotPayload) => {
      const next_settings_snapshot = normalize_setting_snapshot(payload.settings);
      runtime_fixture.current = {
        ...runtime_fixture.current,
        settings_snapshot: next_settings_snapshot,
      };
      return next_settings_snapshot;
    }),
    commit_project_write: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => {
      const payload = await run();
      return {
        payload,
        write_result: {
          accepted: true,
          changes: [],
        },
      };
    }),
    refresh_settings: vi.fn(async () => runtime_fixture.current.settings_snapshot),
  };
}

/** 执行进度提示中的任务并收集保存反馈。 */
function create_toast_fixture(): ToastFixture {
  return {
    push_toast: vi.fn(),
    run_modal_progress_toast: vi.fn(async ({ task }: { task: () => Promise<unknown> }) => {
      return await task();
    }),
  };
}

describe("useFunctionSettingsState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useFunctionSettingsState> | null = null;

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    latest_state = null;
    runtime_fixture.current = create_runtime_fixture();
    toast_fixture.current = create_toast_fixture();
    vi.mocked(api_fetch).mockReset();
  });

  /** 通过 React 渲染暴露设置 Hook 的公开状态。 */
  function FunctionSettingsProbe(): JSX.Element | null {
    latest_state = useFunctionSettingsState();
    return null;
  }

  /** 复用挂载根以验证设置与项目快照变化。 */
  async function render_hook(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(createElement(FunctionSettingsProbe));
    });
  }

  it("项目语言保存成功经项目写入口提交，显示补读后的项目语言", async () => {
    vi.mocked(api_fetch).mockResolvedValue({ accepted: true, changes: [] } as never);
    runtime_fixture.current.commit_project_write.mockImplementation(
      async ({ run }: { run: () => Promise<unknown> }) => {
        const payload = await run();
        // 写入方等待项目快照补读，这里模拟补读后的项目语言。
        runtime_fixture.current.project_snapshot = {
          ...runtime_fixture.current.project_snapshot,
          languages: { source_language: "EN", target_language: "ZH" },
        };
        return { payload, write_result: { accepted: true, changes: [] } };
      },
    );
    await render_hook();
    await act(async () => {
      await latest_state?.update_source_language("EN");
    });
    await render_hook();

    expect(latest_state?.languages).toEqual({ source_language: "EN", target_language: "ZH" });
    expect(latest_state?.language_pending_state).toEqual({
      source_language: false,
      target_language: false,
    });
    expect(runtime_fixture.current.commit_project_write).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "project.settings.update" }),
    );
    expect(vi.mocked(api_fetch).mock.calls).toEqual([
      ["/api/project/settings/update", { source_language: "EN" }],
    ]);
    expect(toast_fixture.current.run_modal_progress_toast).toHaveBeenCalledOnce();
    expect(toast_fixture.current.push_toast).toHaveBeenCalledWith("info", expect.any(String));
  });

  it("未加载项目时显示默认语言并禁止修改", async () => {
    runtime_fixture.current.project_snapshot = { loaded: false, path: "", languages: null };
    await render_hook();
    await act(async () => {
      await latest_state?.update_target_language("EN");
    });
    expect(latest_state?.languages).toEqual({ source_language: "JA", target_language: "ZH" });
    expect(latest_state?.language_locked).toBe(true);
    expect(api_fetch).not.toHaveBeenCalled();
  });

  it("项目语言保存失败恢复项目快照值，页面只提交一次命令", async () => {
    vi.mocked(api_fetch).mockRejectedValue(new Error("prefilter_failed"));
    await render_hook();
    await act(async () => {
      await latest_state?.update_source_language("EN");
    });
    expect(latest_state?.languages.source_language).toBe("JA");
    expect(vi.mocked(api_fetch).mock.calls).toEqual([
      ["/api/project/settings/update", { source_language: "EN" }],
    ]);
    expect(toast_fixture.current.push_toast).toHaveBeenCalledExactlyOnceWith(
      "app.feedback.save_failed",
      expect.any(Error),
    );
  });

  it("任务期间语言仍锁定，超时设置可以保存", async () => {
    runtime_fixture.current.runtime_snapshot = { revision: 1, owner: "agent" };
    vi.mocked(api_fetch).mockResolvedValue({
      settings: create_settings_snapshot({ request_timeout: 600 }),
    } as never);
    await render_hook();
    await act(async () => {
      await latest_state?.update_target_language("EN");
      await latest_state?.update_request_timeout(600);
    });
    expect(vi.mocked(api_fetch).mock.calls).toEqual([
      ["/api/settings/update", { request_timeout: 600 }],
    ]);
    expect(latest_state?.snapshot.request_timeout).toBe(600);
  });
  it("前后文独立保存并恢复失败字段，只发出一次失败通知", async () => {
    await render_hook();
    expect(runtime_fixture.current.refresh_settings).toHaveBeenCalledTimes(1);
    vi.mocked(api_fetch).mockResolvedValueOnce({
      settings: create_settings_snapshot({ preceding_lines_threshold: 3 }),
    } as never);
    await act(async () => {
      await latest_state?.update_preceding_lines_threshold(3);
    });
    expect(latest_state?.snapshot.preceding_lines_threshold).toBe(3);
    let reject_save!: (error: Error) => void;
    vi.mocked(api_fetch).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          reject_save = reject;
        }),
    );
    let save!: Promise<void>;
    await act(async () => {
      save = latest_state!.update_following_lines_threshold(4);
    });
    expect(latest_state?.snapshot.following_lines_threshold).toBe(4);
    expect(latest_state?.pending_state.following_lines_threshold).toBe(true);
    expect(latest_state?.pending_state.preceding_lines_threshold).toBe(false);
    await act(async () => {
      reject_save(new Error("save failed"));
      await save;
    });
    expect(latest_state?.snapshot).toMatchObject({
      preceding_lines_threshold: 3,
      following_lines_threshold: 0,
    });
    expect(latest_state?.pending_state.following_lines_threshold).toBe(false);
    expect(toast_fixture.current.push_toast).toHaveBeenCalledExactlyOnceWith(
      "app.feedback.save_failed",
      expect.any(Error),
    );
    expect(vi.mocked(api_fetch).mock.calls).toEqual([
      ["/api/settings/update", { preceding_lines_threshold: 3 }],
      ["/api/settings/update", { following_lines_threshold: 4 }],
    ]);
  });

  it("两个固定目录独立选择，取消和保存失败保留原设置", async () => {
    vi.stubGlobal("desktopApp", create_desktop_bridge_api_mock());
    runtime_fixture.current.settings_snapshot = create_settings_snapshot({
      project_fixed_path: "E:/projects",
      translation_fixed_path: "E:/translations",
    });
    const pick = vi.spyOn(window.desktopApp, "pickDirectory");
    pick
      .mockResolvedValueOnce({ canceled: true, paths: [] })
      .mockResolvedValueOnce({ canceled: false, paths: ["E:/new"] })
      .mockResolvedValueOnce({ canceled: false, paths: ["E:/other"] });
    await render_hook();
    await act(async () => {
      await latest_state?.update_project_save_mode("FIXED");
    });
    expect(api_fetch).not.toHaveBeenCalled();
    vi.mocked(api_fetch).mockResolvedValueOnce({
      settings: create_settings_snapshot({
        project_fixed_path: "E:/projects",
        translation_save_mode: "FIXED",
        translation_fixed_path: "E:/new",
      }),
    } as never);
    await act(async () => {
      await latest_state?.update_translation_save_mode("FIXED");
    });
    expect(api_fetch).toHaveBeenLastCalledWith("/api/settings/update", {
      translation_save_mode: "FIXED",
      translation_fixed_path: "E:/new",
    });
    expect(latest_state?.snapshot.project_fixed_path).toBe("E:/projects");
    await act(async () => {
      await latest_state?.update_translation_save_mode("FIXED");
    });
    expect(pick).toHaveBeenCalledTimes(2);
    vi.mocked(api_fetch).mockRejectedValueOnce(new Error("save failed"));
    await act(async () => {
      await latest_state?.update_project_save_mode("FIXED");
    });
    expect(latest_state?.snapshot.translation_fixed_path).toBe("E:/new");
    expect(latest_state?.snapshot.project_save_mode).toBe("MANUAL");
    expect(latest_state?.snapshot.project_fixed_path).toBe("E:/projects");
    expect(toast_fixture.current.push_toast).toHaveBeenCalledExactlyOnceWith(
      "app.feedback.save_failed",
      expect.any(Error),
    );
    expect(pick.mock.calls.map(([path]) => path)).toEqual([
      "E:/projects",
      "E:/translations",
      "E:/projects",
    ]);
    pick.mockRestore();
  });

  it("选择和保存期间分别标记对应行忙碌", async () => {
    vi.stubGlobal("desktopApp", create_desktop_bridge_api_mock());
    let resolve_pick!: (value: { canceled: boolean; paths: string[] }) => void;
    vi.spyOn(window.desktopApp, "pickDirectory").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolve_pick = resolve;
        }),
    );
    let resolve_save!: (value: unknown) => void;
    vi.mocked(api_fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolve_save = resolve;
        }),
    );
    await render_hook();
    let pending!: Promise<void>;
    act(() => {
      pending = latest_state!.update_translation_save_mode("FIXED");
    });
    expect(latest_state?.choosing_directory).toEqual({
      project_save_mode: false,
      translation_save_mode: true,
    });
    await act(async () => {
      resolve_pick({ canceled: false, paths: ["E:/chosen"] });
      await Promise.resolve();
    });
    expect(latest_state?.pending_state.translation_save_mode).toBe(true);
    expect(latest_state?.pending_state.project_save_mode).toBe(false);
    await act(async () => {
      resolve_save({
        settings: create_settings_snapshot({
          translation_save_mode: "FIXED",
          translation_fixed_path: "E:/chosen",
        }),
      });
      await pending;
    });
    expect(latest_state?.pending_state.translation_save_mode).toBe(false);
  });
});
