import { normalize_setting_snapshot } from "@domain/setting";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type {
  SettingsSnapshot,
  SettingsSnapshotPayload,
} from "@frontend/app/state/desktop-state-context";
import { useLaboratoryPageState } from "@frontend/pages/laboratory-page/use-laboratory-page-state";

type RuntimeFixture = {
  settings_snapshot: SettingsSnapshot;
  runtime_snapshot: { revision: number; owner: "batch_translation" | "agent" | null };
  project_snapshot: {
    loaded: boolean;
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
  };
});

function create_settings_snapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return normalize_setting_snapshot({
    app_language: "ZH",
    source_language: "JA",
    target_language: "ZH",
    request_timeout: 300,
    prompt_enhancement_enable: true,
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

describe("useLaboratoryPageState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useLaboratoryPageState> | null = null;

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

  function LaboratoryProbe(): JSX.Element | null {
    latest_state = useLaboratoryPageState();
    return null;
  }

  async function render_hook(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(createElement(LaboratoryProbe));
    });
  }

  it("Agent 运行中可提交提示词增强，预过滤仍锁定", async () => {
    runtime_fixture.current.runtime_snapshot = { revision: 1, owner: "agent" };
    vi.mocked(api_fetch).mockResolvedValue({
      settings: create_settings_snapshot({ prompt_enhancement_enable: false }),
    } as never);
    await render_hook();
    await act(async () => {
      await latest_state?.update_prompt_enhancement_enable(false);
      await latest_state?.update_mtool_optimizer_enable(true);
    });
    expect(vi.mocked(api_fetch).mock.calls).toEqual([
      ["/api/settings/update", { prompt_enhancement_enable: false }],
    ]);
    expect(latest_state?.snapshot.prompt_enhancement_enable).toBe(false);
    expect(runtime_fixture.current.commit_project_write).not.toHaveBeenCalled();
  });
});
