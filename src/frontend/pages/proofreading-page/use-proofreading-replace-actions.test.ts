import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProofreadingCommandPlan } from "@shared/proofreading/proofreading-command-planner";
import { createProofreadingApiClient } from "@frontend/pages/proofreading-page/proofreading-api-client";
import type {
  ProofreadingClientItem,
  ProofreadingListView,
} from "@shared/proofreading/proofreading-types";
import { useProofreadingReplaceActions } from "@frontend/pages/proofreading-page/use-proofreading-replace-actions";

type ReplaceActionState = ReturnType<typeof useProofreadingReplaceActions>;

type WriteCall = {
  path: string;
  plan: ProofreadingCommandPlan | null;
  fallback_error_key: string;
  preferred_row_id?: string | null;
  pending_replace_cursor?: number | null;
  success_message_builder?: ((changed_count: number) => string) | null;
  empty_warning_message?: string | null;
  close_dialog?: boolean;
};

// 构造替换场景需要的完整校对 item。
function create_client_item(
  overrides: Partial<ProofreadingClientItem> = {},
): ProofreadingClientItem {
  return {
    item_id: 1,
    row_id: "1",
    file_path: "chapter.txt",
    row_number: 1,
    src: "原文",
    dst: "旧译文",
    name_src: null,
    name_dst: null,
    status: "NONE",
    retry_count: 0,
    warnings: [],
    warning_fragments_by_code: {},
    applied_glossary_terms: [],
    failed_glossary_terms: [],
    compressed_src: "原文",
    compressed_dst: "旧译文",
    ...overrides,
  };
}

// 构造带稳定 view_id 的列表视图，供替换动作读取当前范围。
function create_list_view(): ProofreadingListView {
  return {
    projectId: "E:/demo/sample.lg",
    revisions: {
      files: 2,
      items: 7,
      quality: 3,
      proofreading: 5,
    },
    view_id: "proofreading-view",
    row_count: 2,
    window_start: 0,
    window_rows: [],
    invalid_regex_message: null,
  };
}

describe("useProofreadingReplaceActions", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReplaceActionState | null = null;
  const write_calls: WriteCall[] = []; // 记录公开写入请求，证明替换动作提交的最终意图
  let first_item = create_client_item();
  let second_item = create_client_item({
    item_id: 2,
    row_id: "2",
    dst: "第二条旧译文",
  });
  let runtime_client = createProofreadingApiClient();
  let current_replace_text = "新";
  let current_search_keyword = "旧";

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
    write_calls.length = 0;
    first_item = create_client_item();
    second_item = create_client_item({
      item_id: 2,
      row_id: "2",
      dst: "第二条旧译文",
    });
    runtime_client = createProofreadingApiClient();
    current_replace_text = "新";
    current_search_keyword = "旧";
  });

  // 暴露 hook 返回值，替换依赖通过 options 的公开边界注入。
  function ReplaceActionProbe(): null {
    latest_state = useProofreadingReplaceActions({
      active_row_id_ref: { current: "1" },
      list_revisions: {
        items: 7,
        proofreading: 5,
        quality: 3,
      },
      is_refreshing: false,
      is_regex: false,
      is_writing: false,
      list_view: create_list_view(),
      proofreading_runtime_client_ref: {
        current: runtime_client,
      },
      readonly: false,
      replace_cursor_ref: { current: 0 },
      replace_text: current_replace_text,
      search_keyword: current_search_keyword,
      push_toast: vi.fn(),
      read_current_view_row_ids: async () => ["1", "2"],
      read_items_by_row_ids: async (row_ids) => {
        return row_ids.flatMap((row_id) => {
          if (row_id === "1") {
            return [first_item];
          }
          if (row_id === "2") {
            return [second_item];
          }
          return [];
        });
      },
      run_project_write: vi.fn(async (args: WriteCall) => {
        write_calls.push(args);
      }),
      t: (key) => key,
    });
    return null;
  }

  // 渲染最小 hook 探针，复用同一个 React root。
  async function render_hook(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(createElement(ReplaceActionProbe));
    });
  }

  it("全量替换可见匹配时提交当前列表 revision 锁", async () => {
    await render_hook();

    await act(async () => {
      await latest_state?.replace_all_visible_matches();
    });

    expect(write_calls).toHaveLength(1);
    expect(write_calls[0]).toMatchObject({
      path: "/api/proofreading/items/replace-all",
      fallback_error_key: "proofreading_page.feedback.replace_failed",
      preferred_row_id: "1",
      pending_replace_cursor: 0,
      close_dialog: true,
    });
    expect(write_calls[0]?.plan?.request_body).toMatchObject({
      item_ids: [1, 2],
      search_text: "旧",
      replace_text: "新",
      is_regex: false,
      expected_section_revisions: {
        items: 7,
        proofreading: 5,
      },
    });
  });

  it("全量替换允许空替换文本用于删除匹配内容", async () => {
    current_replace_text = "";
    await render_hook();

    await act(async () => {
      await latest_state?.replace_all_visible_matches();
    });

    expect(write_calls).toHaveLength(1);
    expect(write_calls[0]?.plan?.request_body).toMatchObject({
      item_ids: [1, 2],
      search_text: "旧",
      replace_text: "",
      is_regex: false,
      expected_section_revisions: {
        items: 7,
        proofreading: 5,
      },
    });
  });

  it("替换下一个匹配时保存姓名译文", async () => {
    current_search_keyword = "Name";
    current_replace_text = "Hero";
    const target_item = create_client_item({ dst: "正文译文", name_dst: "Name: Alice" });
    runtime_client = {
      ...runtime_client,
      read_proofreading_list_window: vi.fn(async () => ({
        view_id: "proofreading-view",
        start: 0,
        row_count: 1,
        rows: [
          {
            row_id: "1",
            item: target_item,
            compressed_src: target_item.compressed_src,
            compressed_dst: target_item.compressed_dst,
          },
        ],
      })),
    };
    await render_hook();

    await act(async () => {
      await latest_state?.replace_next_visible_match();
    });

    expect(write_calls[0]).toMatchObject({
      path: "/api/proofreading/items/update",
      preferred_row_id: "1",
      pending_replace_cursor: 1,
    });
    expect(write_calls[0]?.plan?.request_body).toMatchObject({
      changes: [{ item_id: 1, name_dst: "Hero: Alice" }],
      expected_section_revisions: {
        items: 7,
        proofreading: 5,
      },
    });
  });
});
