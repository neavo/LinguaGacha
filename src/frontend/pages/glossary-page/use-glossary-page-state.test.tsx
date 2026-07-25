import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGlossaryPageState } from "./use-glossary-page-state";

const {
  api_fetch_mock,
  debounced_result_snapshot,
  desktop_state,
  i18n_value,
  import_confirmation,
  push_toast_mock,
  result_snapshot_state,
  table_ui_state,
} = vi.hoisted(() => {
  const push_toast = vi.fn();
  const debounced_callback = Object.assign(vi.fn(), {
    cancel: vi.fn(),
    schedule: vi.fn(),
  });
  return {
    api_fetch_mock: vi.fn(),
    debounced_result_snapshot: debounced_callback,
    desktop_state: {
      project_snapshot: {
        path: "E:/demo/sample.lg",
        loaded: true,
      },
      project_change_signal: {
        seq: 1,
        reason: "test",
        updated_sections: ["quality"],
        results: [],
      },
      project_session_status: "ready",
      settings_snapshot: {
        glossary_default_preset: "",
      },
      apply_settings_snapshot: vi.fn(),
      commit_project_write: vi.fn(async (request) => {
        return await request.run();
      }),
      task_snapshot: {
        task_type: null,
        status: "idle",
        busy: false,
        progress: {},
        extras: { kind: "analysis", candidate_count: 0 },
      },
    },
    i18n_value: {
      t: (key: string, params?: Record<string, string>) => {
        return params?.TITLE === undefined ? key : `${key}:${params.TITLE}`;
      },
    },
    import_confirmation: {
      import_confirm_state: {
        open: false,
        duplicate_count: 0,
        submitting: false,
      },
      persist_entries_with_duplicate_resolution: vi.fn(),
      import_duplicate_skip: vi.fn(),
      import_duplicate_overwrite: vi.fn(),
      close_import_duplicate_confirm: vi.fn(),
      reset_import_confirmation: vi.fn(),
    },
    push_toast_mock: push_toast,
    result_snapshot_state: {
      result_snapshot: null,
      set_result_snapshot: vi.fn(),
      set_pending_result_refresh: vi.fn(),
    },
    table_ui_state: {
      filter_state: {
        keyword: "",
        scope: "all",
        is_regex: false,
      },
      sort_state: {
        field: null,
        direction: null,
      },
      selected_row_ids: [],
      active_row_id: null,
      anchor_row_id: null,
      restore_scroll_row_id: null,
      set_filter_state: vi.fn(),
      set_sort_state: vi.fn(),
      set_selection_state: vi.fn(),
      restore_selection_state: vi.fn(),
      reset_table_state: vi.fn(),
    },
  };
});

let glossary_enabled = false;
let save_should_fail = false;

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

vi.mock("@frontend/app/navigation/navigation-context", () => {
  return {
    useAppNavigation: () => ({
      navigate_to_route: vi.fn(),
      push_proofreading_lookup_intent: vi.fn(),
    }),
  };
});

vi.mock("@frontend/widgets/interactions/use-debounce", () => {
  return {
    useDebouncedCallback: () => debounced_result_snapshot,
  };
});

vi.mock("@frontend/pages/glossary-page/glossary-api-client", () => {
  return {
    read_glossary_quality_rule: vi.fn(async () => ({
      projectPath: "E:/demo/sample.lg",
      sectionRevisions: {
        quality: 1,
      },
      qualityRule: {
        enabled: glossary_enabled,
        entries: [],
      },
    })),
    read_glossary_section_revisions: vi.fn(async () => ({
      quality: 1,
    })),
  };
});

vi.mock("@frontend/app/session/quality-rule-statistics-store", () => {
  return {
    isQualityRuleStatisticsCacheReady: () => false,
    isQualityRuleStatisticsCacheRunning: () => false,
  };
});

vi.mock("@frontend/app/session/quality-rule-statistics-context", () => {
  return {
    useQualityRuleStatistics: () => ({
      phase: "idle",
      current_snapshot: null,
      completed_snapshot: null,
      completed_entry_ids: [],
      matched_count_by_entry_id: {},
      subset_parent_labels_by_entry_id: {},
      last_error: null,
      request_token: 0,
      updated_at: 0,
    }),
  };
});

vi.mock("@frontend/app/state/project-change-signal", () => {
  return {
    useProjectChangeSeqForSections: () => 1,
  };
});

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => desktop_state,
  };
});

vi.mock("@frontend/app/feedback/desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
    }),
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => i18n_value,
  };
});

vi.mock("@frontend/app/result/hook", () => {
  return {
    useResultSnapshotState: () => result_snapshot_state,
  };
});

vi.mock(
  "@frontend/widgets/quality-rule-import-confirm-dialog/use-quality-rule-import-confirmation",
  () => {
    return {
      useQualityRuleImportConfirmation: () => import_confirmation,
    };
  },
);

vi.mock("@frontend/app/session/project-session-ui-state-context", () => {
  return {
    useProjectSessionTableUiState: () => table_ui_state,
  };
});

function Probe(props: {
  on_ready: (state: ReturnType<typeof useGlossaryPageState>) => void;
}): JSX.Element | null {
  const state = useGlossaryPageState();

  useEffect(() => {
    props.on_ready(state);
  }, [props, state]);

  return null;
}

describe("useGlossaryPageState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useGlossaryPageState> | null = null;

  beforeEach(() => {
    glossary_enabled = false;
    save_should_fail = false;
    push_toast_mock.mockReset();
    api_fetch_mock.mockReset();
    api_fetch_mock.mockImplementation(
      async (path: string, payload?: { meta?: { enabled?: boolean } }) => {
        if (path !== "/api/quality/rules/update-meta") {
          throw new Error(`未处理的测试请求：${path}`);
        }
        if (save_should_fail) {
          throw new Error("保存失败");
        }
        glossary_enabled = Boolean(payload?.meta?.enabled);
        return {
          accepted: true,
          changes: [],
        };
      },
    );
  });

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
  });

  async function mount_probe(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <Probe
          on_ready={(state) => {
            latest_state = state;
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("启用和禁用成功后显示对应状态提醒", async () => {
    await mount_probe();

    await act(async () => {
      await latest_state?.update_enabled(true);
    });
    expect(latest_state?.enabled).toBe(true);
    expect(push_toast_mock).toHaveBeenLastCalledWith(
      "success",
      "app.feedback.feature_enabled:glossary_page.title",
    );

    await act(async () => {
      await latest_state?.update_enabled(false);
    });
    expect(latest_state?.enabled).toBe(false);
    expect(push_toast_mock).toHaveBeenLastCalledWith(
      "success",
      "app.feedback.feature_disabled:glossary_page.title",
    );
  });

  it("开关写入失败时不显示成功提醒", async () => {
    await mount_probe();
    save_should_fail = true;

    await act(async () => {
      await latest_state?.update_enabled(true);
    });

    expect(latest_state?.enabled).toBe(false);
    expect(push_toast_mock).not.toHaveBeenCalledWith("success", expect.anything());
  });
});
