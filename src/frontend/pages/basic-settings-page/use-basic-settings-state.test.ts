import { normalize_setting_snapshot } from "@domain/setting";
import { type JSX, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type {
  SettingsSnapshot,
  SettingsSnapshotPayload,
} from "@frontend/app/state/desktop-state-context";
import { useBasicSettingsState } from "@frontend/pages/basic-settings-page/use-basic-settings-state";
import type { ProxySettingValue } from "@domain/setting";
import type { AppProxyRuntimeStatus } from "@shared/proxy";

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

const APPLIED_PROXY_STATUS: AppProxyRuntimeStatus = {
  applied: true,
  effectiveMode: "manual",
  failureReason: null,
};

const MANUAL_PROXY: ProxySettingValue = {
  mode: "manual",
  protocol: "HTTP",
  host: "127.0.0.1",
  port: 7890,
  username: "",
  password: "",
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

/** 代理状态随设置读取返回，其余接口由各测试决定。 */
function mock_api(update: (body: Record<string, unknown>) => unknown): void {
  vi.mocked(api_fetch).mockImplementation(async (url, body) => {
    if (url === "/api/settings/app") {
      return {
        settings: runtime_fixture.current.settings_snapshot,
        proxyStatus: APPLIED_PROXY_STATUS,
      } as never;
    }
    return update((body ?? {}) as Record<string, unknown>) as never;
  });
}

describe("useBasicSettingsState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useBasicSettingsState> | null = null;

  afterEach(async () => {
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
  function BasicSettingsProbe(): JSX.Element | null {
    latest_state = useBasicSettingsState();
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
      root?.render(createElement(BasicSettingsProbe));
    });
  }

  it("项目语言保存成功经项目写入口提交，显示补读后的项目语言", async () => {
    mock_api(() => ({ accepted: true, changes: [] }));
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
      ["/api/settings/app", {}],
      ["/api/project/settings/update", { source_language: "EN" }],
    ]);
    expect(toast_fixture.current.run_modal_progress_toast).toHaveBeenCalledOnce();
    expect(toast_fixture.current.push_toast).toHaveBeenCalledWith("info", expect.any(String));
  });

  it("未加载项目时显示默认语言并禁止修改", async () => {
    mock_api(() => ({ settings: runtime_fixture.current.settings_snapshot }));
    runtime_fixture.current.project_snapshot = { loaded: false, path: "", languages: null };
    await render_hook();
    await act(async () => {
      await latest_state?.update_target_language("EN");
    });
    expect(latest_state?.languages).toEqual({ source_language: "JA", target_language: "ZH" });
    expect(latest_state?.language_locked).toBe(true);
    expect(vi.mocked(api_fetch).mock.calls).toEqual([["/api/settings/app", {}]]);
  });

  it("项目语言保存失败恢复项目快照值，页面只提交一次命令", async () => {
    mock_api(() => {
      throw new Error("prefilter_failed");
    });
    await render_hook();
    await act(async () => {
      await latest_state?.update_source_language("EN");
    });
    expect(latest_state?.languages.source_language).toBe("JA");
    expect(vi.mocked(api_fetch).mock.calls).toEqual([
      ["/api/settings/app", {}],
      ["/api/project/settings/update", { source_language: "EN" }],
    ]);
    expect(toast_fixture.current.push_toast).toHaveBeenCalledExactlyOnceWith(
      "app.feedback.save_failed",
      expect.any(Error),
    );
  });

  it("任务期间语言仍锁定，超时设置可以保存", async () => {
    runtime_fixture.current.runtime_snapshot = { revision: 1, owner: "agent" };
    mock_api(() => ({ settings: create_settings_snapshot({ request_timeout: 600 }) }));
    await render_hook();
    await act(async () => {
      await latest_state?.update_target_language("EN");
      await latest_state?.update_request_timeout(600);
    });
    expect(vi.mocked(api_fetch).mock.calls).toEqual([
      ["/api/settings/app", {}],
      ["/api/settings/update", { request_timeout: 600 }],
    ]);
    expect(latest_state?.snapshot.request_timeout).toBe(600);
  });

  it("代理保存整体提交，成功后重新读取下发状态", async () => {
    mock_api(() => ({ settings: create_settings_snapshot({ proxy: MANUAL_PROXY }) }));
    await render_hook();

    let saved: Awaited<ReturnType<NonNullable<typeof latest_state>["save_proxy"]>> = null;
    await act(async () => {
      saved = (await latest_state?.save_proxy(MANUAL_PROXY)) ?? null;
    });

    expect(saved).toEqual(MANUAL_PROXY);
    expect(vi.mocked(api_fetch).mock.calls).toEqual([
      ["/api/settings/app", {}],
      ["/api/settings/update", { proxy: MANUAL_PROXY }],
      ["/api/settings/app", {}],
    ]);
    expect(latest_state?.snapshot.proxy).toEqual(MANUAL_PROXY);
    expect(latest_state?.proxy_status).toEqual(APPLIED_PROXY_STATUS);
  });
});
