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

type RuntimeFixture = {
  settings_snapshot: SettingsSnapshot;
  runtime_snapshot: { revision: number; owner: "batch_translation" | "agent" | null };
  project_snapshot: {
    loaded: boolean;
    path: string;
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

function create_settings_snapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return normalize_setting_snapshot({
    app_language: "ZH",
    source_language: "JA",
    target_language: "ZH",
    request_timeout: 300,
    mtool_optimizer_enable: false,
    skip_duplicate_source_text_enable: true,
    ...overrides,
  });
}

function create_runtime_fixture(): RuntimeFixture {
  const settings_snapshot = create_settings_snapshot();
  return {
    settings_snapshot,
    runtime_snapshot: { revision: 0, owner: null },
    project_snapshot: {
      loaded: true,
      path: "E:/demo/sample.lg",
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

function create_toast_fixture(): ToastFixture {
  return {
    push_toast: vi.fn(),
    run_modal_progress_toast: vi.fn(async ({ task }: { task: () => Promise<unknown> }) => {
      return await task();
    }),
  };
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

  function BasicSettingsProbe(): JSX.Element | null {
    latest_state = useBasicSettingsState();
    return null;
  }

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

  it("语言保存失败从后端恢复设置，页面只提交一次命令", async () => {
    vi.mocked(api_fetch).mockRejectedValue(new Error("prefilter_failed"));
    await render_hook();
    await act(async () => {
      await latest_state?.update_source_language("EN");
    });
    expect(latest_state?.snapshot.source_language).toBe("JA");
    expect(vi.mocked(api_fetch).mock.calls).toEqual([
      ["/api/settings/update", { source_language: "EN" }],
    ]);
    expect(toast_fixture.current.push_toast).toHaveBeenCalledExactlyOnceWith(
      "error",
      "basic_settings_page.feedback.update_failed",
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
});
