import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type {
  SettingsSnapshot,
  SettingsSnapshotPayload,
} from "@frontend/app/state/desktop-state-context";
import { normalize_settings_snapshot } from "@frontend/app/state/desktop-state-context";
import { useLaboratoryPageState } from "@frontend/pages/laboratory-page/use-laboratory-page-state";

type RuntimeFixture = {
  settings_snapshot: SettingsSnapshot;
  task_snapshot: {
    busy: boolean;
  };
  project_snapshot: {
    loaded: boolean;
  };
  apply_settings_snapshot: ReturnType<typeof vi.fn>;
  commit_project_write: ReturnType<typeof vi.fn>;
  refresh_project_state: ReturnType<typeof vi.fn>;
  refresh_settings: ReturnType<typeof vi.fn>;
};

type ToastFixture = {
  push_toast: ReturnType<typeof vi.fn>;
  run_modal_progress_toast: ReturnType<typeof vi.fn>;
};

// state fixture 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

// toast fixture 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const toast_fixture: { current: ToastFixture } = {
  current: create_toast_fixture(),
};

/**
 * 支撑当前测试场景的专用辅助逻辑。
 */
const translate = (key: string): string => key;

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

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
  };
});

// create_settings_snapshot 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
/**
 * 构造当前测试场景的标准数据。
 */
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
    refresh_project_state: vi.fn(async () => {}),
    refresh_settings: vi.fn(async () => runtime_fixture.current.settings_snapshot),
  };
}

// create_toast_fixture 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
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

// create_settings_payload 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
/**
 * 构造当前测试场景的标准数据。
 */
function create_settings_payload(settings_snapshot: SettingsSnapshot): {
  settings: SettingsSnapshot;
} {
  return {
    settings: settings_snapshot,
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

  // LaboratoryProbe 收口测试中的共享步骤，保证断言只关注当前行为。
  function LaboratoryProbe(): JSX.Element | null {
    latest_state = useLaboratoryPageState();
    return null;
  }

  // flush_async_updates 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
  /**
   * 支撑当前测试场景的专用辅助逻辑。
   */
  async function flush_async_updates(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  // render_hook 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
  /**
   * 生成当前场景的展示内容。
   */
  async function render_hook(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(createElement(LaboratoryProbe));
    });
    await flush_async_updates();
  }

  it("后端预过滤提交失败时会回滚 mtool_optimizer_enable 并只显示通用失败提示", async () => {
    vi.mocked(api_fetch).mockImplementation(async (path, body = {}) => {
      if (path === "/api/settings/update") {
        return create_settings_payload(
          create_settings_snapshot({
            ...runtime_fixture.current.settings_snapshot,
            ...body,
          }),
        ) as never;
      }

      if (path === "/api/workbench/settings-alignment/apply") {
        throw new Error("prefilter_failed");
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
      await latest_state?.update_mtool_optimizer_enable(true);
    });
    await flush_async_updates();

    expect(latest_state?.snapshot.mtool_optimizer_enable).toBe(false);
    expect(toast_fixture.current.push_toast).toHaveBeenCalledTimes(1);
    expect(toast_fixture.current.push_toast).toHaveBeenCalledWith(
      "error",
      "laboratory_page.feedback.update_failed",
    );
    expect(vi.mocked(api_fetch).mock.calls).toEqual([
      ["/api/settings/update", { mtool_optimizer_enable: true }],
      ["/api/workbench/snapshot", {}],
      [
        "/api/workbench/settings-alignment/apply",
        {
          mode: "prefiltered_items",
          project_settings: {
            source_language: "JA",
            target_language: "ZH",
            mtool_optimizer_enable: true,
            skip_duplicate_source_text_enable: true,
          },
          expected_section_revisions: {
            items: 0,
            analysis: 0,
          },
        },
      ],
      ["/api/settings/update", { mtool_optimizer_enable: false }],
    ]);
  });
});
