import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@/app/desktop-api";
import type { SettingsSnapshot } from "@/app/runtime/desktop/desktop-runtime-context";
import { WorkerClientError } from "@/lib/worker-client-error";
import { useBasicSettingsState } from "@/pages/basic-settings-page/use-basic-settings-state";

type RuntimeFixture = {
  settings_snapshot: SettingsSnapshot;
  task_snapshot: {
    busy: boolean;
  };
  project_snapshot: {
    loaded: boolean;
    path: string;
  };
  project_store: {
    getState: () => Record<string, unknown>;
  };
  set_settings_snapshot: ReturnType<typeof vi.fn>;
  commit_local_project_patch: ReturnType<typeof vi.fn>;
  refresh_project_runtime: ReturnType<typeof vi.fn>;
  align_project_runtime_ack: ReturnType<typeof vi.fn>;
  refresh_settings: ReturnType<typeof vi.fn>;
};

type BarrierFixture = {
  create_barrier_checkpoint: ReturnType<typeof vi.fn>;
  wait_for_barrier: ReturnType<typeof vi.fn>;
};

type ToastFixture = {
  push_toast: ReturnType<typeof vi.fn>;
  run_modal_progress_toast: ReturnType<typeof vi.fn>;
};

type ProjectPrefilterClientFixture = {
  compute: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

const barrier_fixture: { current: BarrierFixture } = {
  current: create_barrier_fixture(),
};

const toast_fixture: { current: ToastFixture } = {
  current: create_toast_fixture(),
};

const project_prefilter_client_fixture: { current: ProjectPrefilterClientFixture } = {
  current: create_project_prefilter_client_fixture(),
};

const translate = (key: string): string => key;

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/app/runtime/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => runtime_fixture.current,
  };
});

vi.mock("@/app/runtime/project-pages/project-pages-context", () => {
  return {
    useProjectPagesBarrier: () => barrier_fixture.current,
  };
});

vi.mock("@/app/runtime/toast/use-desktop-toast", () => {
  return {
    useDesktopToast: () => toast_fixture.current,
  };
});

vi.mock("@/app/project/derived/project-prefilter-client", () => {
  return {
    createProjectPrefilterClient: () => project_prefilter_client_fixture.current,
  };
});

vi.mock("@/i18n", () => {
  return {
    useI18n: () => {
      return {
        t: translate,
      };
    },
  };
});

vi.mock("@/app/desktop-api", () => {
  return {
    api_fetch: vi.fn(),
    DesktopApiError: class DesktopApiError extends Error {},
  };
});

function create_settings_snapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return {
    app_language: "ZH",
    source_language: "JA",
    target_language: "ZH",
    project_save_mode: "MANUAL",
    project_fixed_path: "",
    output_folder_open_on_finish: false,
    request_timeout: 300,
    preceding_lines_threshold: 0,
    clean_ruby: false,
    deduplication_in_trans: false,
    deduplication_in_bilingual: false,
    check_kana_residue: false,
    check_hangeul_residue: false,
    check_similarity: false,
    write_translated_name_fields_to_file: false,
    auto_process_prefix_suffix_preserved_text: false,
    mtool_optimizer_enable: false,
    glossary_default_preset: "",
    pre_translation_replacement_default_preset: "",
    post_translation_replacement_default_preset: "",
    text_preserve_default_preset: "",
    translation_custom_prompt_default_preset: "",
    analysis_custom_prompt_default_preset: "",
    recent_projects: [],
    ...overrides,
  };
}

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
    project_store: {
      getState: () => {
        return {};
      },
    },
    set_settings_snapshot: vi.fn((next_settings_snapshot: SettingsSnapshot) => {
      runtime_fixture.current = {
        ...runtime_fixture.current,
        settings_snapshot: next_settings_snapshot,
      };
    }),
    commit_local_project_patch: vi.fn(() => {
      return {
        rollback: vi.fn(),
      };
    }),
    refresh_project_runtime: vi.fn(async () => {}),
    align_project_runtime_ack: vi.fn(),
    refresh_settings: vi.fn(async () => runtime_fixture.current.settings_snapshot),
  };
}

function create_barrier_fixture(): BarrierFixture {
  return {
    create_barrier_checkpoint: vi.fn(() => "checkpoint"),
    wait_for_barrier: vi.fn(async () => {}),
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

function create_project_prefilter_client_fixture(): ProjectPrefilterClientFixture {
  return {
    compute: vi.fn(async () => {
      return {};
    }),
    dispose: vi.fn(),
  };
}

function create_settings_payload(settings_snapshot: SettingsSnapshot): {
  settings: SettingsSnapshot;
} {
  return {
    settings: settings_snapshot,
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
    barrier_fixture.current = create_barrier_fixture();
    toast_fixture.current = create_toast_fixture();
    project_prefilter_client_fixture.current = create_project_prefilter_client_fixture();
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

  it("prefilter worker 失败时会回滚 source_language 并只显示通用失败提示", async () => {
    project_prefilter_client_fixture.current.compute = vi.fn(async () => {
      throw new WorkerClientError("project prefilter worker 初始化失败。", "init_failed");
    });
    vi.mocked(api_fetch).mockImplementation(async (path, body = {}) => {
      if (path === "/api/settings/update") {
        return create_settings_payload(
          create_settings_snapshot({
            ...runtime_fixture.current.settings_snapshot,
            ...body,
          }),
        ) as never;
      }

      if (path === "/api/project/settings/sync-meta") {
        return {} as never;
      }

      throw new Error(`unexpected path: ${path}`);
    });

    await render_hook();

    expect(latest_state).not.toBeNull();

    await act(async () => {
      await latest_state?.update_source_language("EN");
    });
    await flush_async_updates();

    expect(project_prefilter_client_fixture.current.compute).toHaveBeenCalledTimes(1);
    expect(latest_state?.snapshot.source_language).toBe("JA");
    expect(toast_fixture.current.push_toast).toHaveBeenCalledTimes(1);
    expect(toast_fixture.current.push_toast).toHaveBeenCalledWith(
      "error",
      "basic_settings_page.feedback.update_failed",
    );
    expect(barrier_fixture.current.wait_for_barrier).not.toHaveBeenCalled();
    expect(vi.mocked(api_fetch).mock.calls).toEqual([
      ["/api/settings/update", { source_language: "EN" }],
      [
        "/api/project/settings/sync-meta",
        {
          source_language: "EN",
          target_language: "ZH",
        },
      ],
      ["/api/settings/update", { source_language: "JA" }],
      [
        "/api/project/settings/sync-meta",
        {
          source_language: "JA",
          target_language: "ZH",
        },
      ],
    ]);
  });
});
