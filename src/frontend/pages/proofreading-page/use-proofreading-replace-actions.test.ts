import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { apply_project_item_manual_update } from "@shared/project/project-item-update";
import {
  create_empty_proofreading_list_view,
  type ProofreadingClientItem,
} from "@shared/proofreading/proofreading-types";
import { createProofreadingApiClient } from "./proofreading-api-client";
import { useProofreadingReplaceActions } from "./use-proofreading-replace-actions";

vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: vi.fn() }));

it("姓名替换只提交姓名字段，保留正文任务状态和其他姓名槽位", async () => {
  const item: ProofreadingClientItem = {
    item_id: 1,
    row_id: "1",
    file_path: "script.txt",
    internal_file_path: null,
    row_number: 1,
    src: "原文",
    dst: "既有译文",
    name_src: null,
    name_dst: ["旧名", "旁白"],
    status: "ERROR",
    retry_count: 3,
    warnings: [],
    glossary_applications: [],
    compressed_src: "原文",
    compressed_dst: "既有译文",
  };
  let saved = item;
  vi.mocked(api_fetch).mockResolvedValue({
    window: {
      view_id: "view-1",
      start: 0,
      row_count: 1,
      rows: [
        {
          kind: "item",
          row_id: item.row_id,
          item,
          compressed_src: item.src,
          compressed_dst: item.dst,
        },
      ],
    },
  });
  const options: Parameters<typeof useProofreadingReplaceActions>[0] = {
    active_row_id_ref: { current: "1" },
    list_revisions: {},
    is_refreshing: false,
    is_regex: false,
    is_writing: false,
    list_view: { ...create_empty_proofreading_list_view(), view_id: "view-1", row_count: 1 },
    proofreading_runtime_client_ref: { current: createProofreadingApiClient() },
    readonly: false,
    replace_cursor_ref: { current: 0 },
    replace_text: "新名",
    search_keyword: "旧名",
    push_toast: vi.fn(),
    read_current_view_row_ids: async () => ["1"],
    read_items_by_row_ids: async () => [item],
    run_project_write: async ({ plan }) => {
      saved = apply_project_item_manual_update(item, plan!.request_body.changes![0]!)!;
      return true;
    },
    close_edit_dialog: vi.fn(),
    t: (key) => key,
  };
  let actions!: ReturnType<typeof useProofreadingReplaceActions>;
  /** 挂载替换动作，查询适配与人工更新使用真实轻量协作者。 */
  function Probe(): null {
    actions = useProofreadingReplaceActions(options);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => {
      root.render(createElement(Probe));
    });
    await act(async () => {
      await actions.replace_next_visible_match();
    });
    expect(saved.name_dst).toEqual(["新名", "旁白"]);
    expect(saved.status).toBe("ERROR");
    expect(saved.retry_count).toBe(item.retry_count);
  } finally {
    await act(async () => {
      root.unmount();
    });
    vi.mocked(api_fetch).mockReset();
  }
});
