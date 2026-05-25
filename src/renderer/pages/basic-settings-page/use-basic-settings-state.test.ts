import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@/app/desktop/desktop-api";
import type {
  SettingsSnapshot,
  SettingsSnapshotPayload,
} from "@/app/desktop/desktop-runtime-context";
import { normalize_settings_snapshot } from "@/app/desktop/desktop-runtime-context";
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
  apply_settings_snapshot: ReturnType<typeof vi.fn>;
  commit_project_mutation: ReturnType<typeof vi.fn>;
  refresh_project_runtime: ReturnType<typeof vi.fn>;
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

// runtime fixture 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

// barrier fixture 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const barrier_fixture: { current: BarrierFixture } = {
  current: create_barrier_fixture(),
};

// toast fixture 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const toast_fixture: { current: ToastFixture } = {
  current: create_toast_fixture(),
};

const translate = (key: string): string => key;

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/app/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => runtime_fixture.current,
  };
});

vi.mock("@/app/session/project-session-context", () => {
  return {
    useProjectSessionBarrier: () => barrier_fixture.current,
  };
});

vi.mock("@/app/ui-runtime/toast/use-desktop-toast", () => {
  return {
    useDesktopToast: () => toast_fixture.current,
  };
});

vi.mock("@/app/locale/locale-provider", () => {
  return {
    useI18n: () => {
      return {
        t: translate,
      };
    },
  };
});

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: vi.fn(),
    report_renderer_error: vi.fn(async () => undefined),
    DesktopApiError: class DesktopApiError extends Error {},
  };
});

// create_settings_snapshot 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
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
    deduplication_in_bilingual: false,
    check_kana_residue: false,
    check_hangeul_residue: false,
    check_similarity: false,
    write_translated_name_fields_to_file: false,
    auto_process_prefix_suffix_preserved_text: false,
    mtool_optimizer_enable: false,
    skip_duplicate_source_text_enable: true,
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

// create_runtime_fixture 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
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
        return {
          revisions: {
            sections: {
              items: 0,
              analysis: 0,
            },
          },
        };
      },
    },
    apply_settings_snapshot: vi.fn((payload: SettingsSnapshotPayload) => {
      const next_settings_snapshot = normalize_settings_snapshot(payload);
      runtime_fixture.current = {
        ...runtime_fixture.current,
        settings_snapshot: next_settings_snapshot,
      };
      return next_settings_snapshot;
    }),
    commit_project_mutation: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => {
      const payload = await run();
      return {
        payload,
        mutation_result: {
          accepted: true,
          changes: [],
        },
      };
    }),
    refresh_project_runtime: vi.fn(async () => {}),
    refresh_settings: vi.fn(async () => runtime_fixture.current.settings_snapshot),
  };
}

// create_barrier_fixture 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_barrier_fixture(): BarrierFixture {
  return {
    create_barrier_checkpoint: vi.fn(() => "checkpoint"),
    wait_for_barrier: vi.fn(async () => {}),
  };
}

// create_toast_fixture 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_toast_fixture(): ToastFixture {
  return {
    push_toast: vi.fn(),
    run_modal_progress_toast: vi.fn(async ({ task }: { task: () => Promise<unknown> }) => {
      return await task();
    }),
  };
}

// create_settings_payload 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
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
    vi.mocked(api_fetch).mockReset();
  });

  // BasicSettingsProbe 收口测试中的共享步骤，保证断言只关注当前行为。
  function BasicSettingsProbe(): JSX.Element | null {
    latest_state = useBasicSettingsState();
    return null;
  }

  // flush_async_updates 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
  async function flush_async_updates(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  // render_hook 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
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
        return create_settings_payload(
          create_settings_snapshot({
            ...runtime_fixture.current.settings_snapshot,
            ...body,
          }),
        ) as never;
      }

      if (path === "/api/project/settings-alignment/apply") {
        if ((body as { mode?: string }).mode === "prefiltered_items") {
          throw new Error("prefilter_failed");
        }
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
        "/api/project/settings-alignment/apply",
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
        "/api/project/settings-alignment/apply",
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

  it("刷新失败时保留当前基础设置并弹出错误 toast", async () => {
    runtime_fixture.current.refresh_settings = vi.fn(async () => {
      throw new Error("基础设置刷新失败");
    });

    await render_hook();

    expect(latest_state).not.toBeNull();

    expect(latest_state?.snapshot.request_timeout).toBe(300);
    expect(toast_fixture.current.push_toast).toHaveBeenCalledTimes(1);
    expect(toast_fixture.current.push_toast).toHaveBeenCalledWith(
      "error",
      "basic_settings_page.feedback.refresh_failed",
    );
  });
});
