import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProofreadingPage } from "@/pages/proofreading-page/page";

const { proofreading_state_fixture, register_page_cache_mock } = vi.hoisted(() => {
  return {
    proofreading_state_fixture: {
      current: null as ReturnType<typeof create_proofreading_state_fixture> | null,
    },
    register_page_cache_mock: vi.fn(),
  };
});

vi.mock("@/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@/app/session/project-session-context", () => {
  return {
    useProjectSessionPageCacheRegistration: register_page_cache_mock,
  };
});

vi.mock("@/pages/proofreading-page/use-proofreading-page-state", () => {
  return {
    useProofreadingPageState: () => proofreading_state_fixture.current,
  };
});

vi.mock("@/widgets/app-button/app-button", () => {
  return {
    AppButton: (props: {
      children: ReactNode;
      disabled?: boolean;
      onClick?: () => void;
      type?: "button";
    }) => (
      <button type={props.type ?? "button"} disabled={props.disabled} onClick={props.onClick}>
        {props.children}
      </button>
    ),
  };
});

vi.mock("@/widgets/search-bar/search-bar", () => {
  return {
    SearchBar: (props: {
      disabled?: boolean;
      extra_actions?: ReactNode;
      keyword: string;
      on_keyword_change: (keyword: string) => void;
    }) => (
      <div data-keyword={props.keyword}>
        <button
          type="button"
          disabled={props.disabled}
          onClick={() => {
            props.on_keyword_change("苹果");
          }}
        />
        {props.extra_actions}
      </div>
    ),
  };
});

vi.mock("@/pages/proofreading-page/components/proofreading-table", () => {
  return {
    ProofreadingTable: (props: { readonly: boolean }) => (
      <div data-readonly={props.readonly ? "true" : "false"} data-testid="proofreading-table" />
    ),
  };
});

vi.mock("@/pages/proofreading-page/components/proofreading-filter-dialog", () => {
  return {
    ProofreadingFilterDialog: () => null,
  };
});

vi.mock("@/pages/proofreading-page/components/proofreading-edit-dialog", () => {
  return {
    ProofreadingEditDialog: (props: { readonly: boolean }) => (
      <div data-readonly={props.readonly ? "true" : "false"} data-testid="proofreading-edit" />
    ),
  };
});

vi.mock("@/pages/proofreading-page/components/proofreading-confirm-dialog", () => {
  return {
    ProofreadingConfirmDialog: () => null,
  };
});

// create_proofreading_state_fixture 构造页面壳消费的最小校对页状态。
function create_proofreading_state_fixture() {
  return {
    active_row_id: null,
    anchor_row_id: null,
    apply_table_selection: vi.fn(),
    apply_table_sort_state: vi.fn(),
    close_filter_dialog: vi.fn(),
    close_pending_confirmation: vi.fn(),
    cache_status: "ready",
    confirm_filter_dialog_filters: vi.fn(),
    confirm_pending_confirmation: vi.fn(),
    consumed_revisions: {
      items: 3,
      proofreading: 2,
      quality: 4,
    },
    dialog_item: null,
    dialog_state: {
      draft_dst: "",
      open: false,
      saving: false,
    },
    filter_dialog_filters: {},
    filter_dialog_open: false,
    filter_panel: null,
    filter_panel_loading: false,
    get_visible_row_at_index: vi.fn(),
    get_visible_row_id_at_index: vi.fn(),
    handle_table_selection_error: vi.fn(),
    invalid_regex_message: null,
    is_mutating: false,
    is_refreshing: false,
    is_regex: false,
    open_edit_dialog: vi.fn(),
    open_filter_dialog: vi.fn(),
    pending_confirmation: null,
    read_visible_range: vi.fn(),
    readonly: false,
    replace_all_visible_matches: vi.fn(),
    replace_next_visible_match: vi.fn(),
    replace_text: "",
    request_clear_translation_row_ids: vi.fn(),
    request_close_dialog: vi.fn(),
    request_retranslate_row_ids: vi.fn(),
    request_set_translation_status_row_ids: vi.fn(),
    required_sections: ["project", "items", "quality", "proofreading"],
    resolve_visible_row_ids_range: vi.fn(),
    resolve_visible_row_index: vi.fn(),
    retranslating_row_ids: new Set<string>(),
    save_dialog_entry: vi.fn(),
    search_keyword: "",
    search_scope: "all",
    selected_row_ids: new Set<string>(),
    settled_project_path: "E:/demo/demo.lg",
    sort_state: null,
    update_dialog_draft: vi.fn(),
    update_filter_dialog_filters: vi.fn(),
    update_regex: vi.fn(),
    update_replace_text: vi.fn(),
    update_search_keyword: vi.fn(),
    update_search_scope: vi.fn(),
    visible_items: [],
    visible_row_count: 0,
  };
}

describe("ProofreadingPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    proofreading_state_fixture.current = create_proofreading_state_fixture();
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
    register_page_cache_mock.mockReset();
  });

  async function mount_page(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ProofreadingPage is_sidebar_collapsed={false} />);
    });
  }

  it("挂载时登记校对页缓存快照", async () => {
    await mount_page();

    expect(register_page_cache_mock).toHaveBeenCalledWith("proofreading", {
      consumedRevisions: {
        items: 3,
        proofreading: 2,
        quality: 4,
      },
      isRefreshing: false,
      requiredSections: ["project", "items", "quality", "proofreading"],
      settledProjectPath: "E:/demo/demo.lg",
    });
  });

  it("质量缓存未 ready 时保留搜索并锁住筛选和编辑动作", async () => {
    if (proofreading_state_fixture.current === null) {
      throw new Error("缺少校对页状态夹具。");
    }
    proofreading_state_fixture.current.cache_status = "refreshing";
    proofreading_state_fixture.current.is_refreshing = true;

    await mount_page();

    const buttons = [...(container?.querySelectorAll("button") ?? [])];
    expect(buttons[0]?.disabled).toBe(false);
    expect(buttons[1]?.disabled).toBe(true);
    expect(
      container?.querySelector("[data-testid='proofreading-table']")?.getAttribute("data-readonly"),
    ).toBe("true");
    expect(
      container?.querySelector("[data-testid='proofreading-edit']")?.getAttribute("data-readonly"),
    ).toBe("true");

    await act(async () => {
      buttons[0]?.click();
      buttons[1]?.click();
    });
    expect(proofreading_state_fixture.current.update_search_keyword).toHaveBeenCalledWith("苹果");
    expect(proofreading_state_fixture.current.open_filter_dialog).not.toHaveBeenCalled();
  });
});
