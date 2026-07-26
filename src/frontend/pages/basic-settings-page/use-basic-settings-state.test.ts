import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type {
  SettingsSnapshot,
  SettingsSnapshotPayload,
} from "@frontend/app/state/desktop-state-context";
import { normalize_settings_snapshot } from "@frontend/app/state/desktop-state-context";
import { useBasicSettingsState } from "@frontend/pages/basic-settings-page/use-basic-settings-state";

type RuntimeFixture = {
  settings_snapshot: SettingsSnapshot;
  task_snapshot: {
    busy: boolean;
  };
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
  };
});

vi.mock("@frontend/app/feedback/desktop-toast", () => {
  return {
    useDesktopToast: () => toast_fixture.current,
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
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

/**
 * 构造当前测试场景的标准数据。
 */
function create_settings_snapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return normalize_settings_snapshot({
    settings: {
      app_language: "ZH",
      source_language: "JA",
      target_language: "ZH",
      request_timeout: 300,
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
      ...overrides,
    },
  });
}

/**
 * 构造当前测试场景的标准数据。
 */
function create_runtime_fixture(): RuntimeFixture {
  const settings_snapshot = create_settings_snapshot();
  return {
    settings_snapshot,
    task_snapshot: {
      busy: false,
    },
    project_snapshot: {
      loaded: true,
      path: "E:/demo/sample.lg",
    },
    apply_settings_snapshot: vi.fn((payload: SettingsSnapshotPayload) => {
      const next_settings_snapshot = normalize_settings_snapshot(payload);
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

/**
 * 构造当前测试场景的标准数据。
 */
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

  async function flush_async_updates(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
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
    await flush_async_updates();
  }

  it("后端预过滤提交失败时会回滚 source_language 并只显示通用失败提示", async () => {
    vi.mocked(api_fetch).mockImplementation(async (path, body = {}) => {
      if (path === "/api/settings/update") {
        return {
          settings: create_settings_snapshot({
            ...runtime_fixture.current.settings_snapshot,
            ...body,
          }),
        } as never;
      }

      if (path === "/api/workbench/settings-alignment/apply") {
        if ((body as { mode?: string }).mode === "prefiltered_items") {
          throw new Error("prefilter_failed");
        }
        return {} as never;
      }
      if (path === "/api/workbench/snapshot") {
        return {
          sectionRevisions: {
            items: 0,
            analysis: 0,
          },
        } as never;
      }

      throw new Error(`unexpected path: ${path}`);
    });

    await render_hook();

    expect(latest_state).not.toBeNull();

    await act(async () => {
      await latest_state?.update_source_language("EN");
    });
    await flush_async_updates();

    expect(latest_state?.snapshot.source_language).toBe("JA");
    expect(toast_fixture.current.push_toast).toHaveBeenCalledTimes(1);
    expect(toast_fixture.current.push_toast).toHaveBeenCalledWith(
      "error",
      "basic_settings_page.feedback.update_failed",
    );
    expect(vi.mocked(api_fetch).mock.calls).toEqual([
      ["/api/settings/update", { source_language: "EN" }],
      ["/api/workbench/snapshot", {}],
      [
        "/api/workbench/settings-alignment/apply",
        {
          mode: "prefiltered_items",
          project_settings: {
            source_language: "EN",
            target_language: "ZH",
            mtool_optimizer_enable: false,
            skip_duplicate_source_text_enable: true,
          },
          expected_section_revisions: {
            items: 0,
            analysis: 0,
          },
        },
      ],
      ["/api/settings/update", { source_language: "JA" }],
      [
        "/api/workbench/settings-alignment/apply",
        {
          mode: "settings_only",
          project_settings: {
            source_language: "JA",
            target_language: "ZH",
            mtool_optimizer_enable: false,
            skip_duplicate_source_text_enable: true,
          },
        },
      ],
    ]);
  });
});
