import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProofreadingDialogActions } from "./use-proofreading-dialog-actions";
import type {
  ProofreadingClientItem,
  ProofreadingContextItem,
} from "@shared/proofreading/proofreading-types";

const item: ProofreadingClientItem = {
  item_id: 1,
  row_id: "1",
  file_path: "chapter.txt",
  row_number: 1,
  src: "原文",
  dst: "译文",
  name_src: null,
  name_dst: null,
  status: "NONE",
  retry_count: 0,
  warnings: [],
  warning_fragments_by_code: {},
  glossary_applications: [],
  compressed_src: "原文",
  compressed_dst: "译文",
};

describe("useProofreadingDialogActions", () => {
  let root: Root;
  let container: HTMLDivElement;
  let state: ReturnType<typeof useProofreadingDialogActions> | null;
  const read_items = vi.fn<() => Promise<ProofreadingClientItem[]>>();
  const read_context = vi.fn<() => Promise<ProofreadingContextItem[]>>();
  const push_toast = vi.fn();
  const options = {
    list_revisions: { items: 7, proofreading: 1 },
    visible_item_by_id: new Map([["1", item]]),
    read_items_by_row_ids: read_items,
    read_context,
    run_project_write: vi.fn(async () => {}),
    push_toast,
    t: (key: string) => key,
  };

  /** 直接观察弹窗 Hook，让请求隔离用例只依赖它拥有的状态。 */
  function Probe(): null {
    state = useProofreadingDialogActions(options);
    return null;
  }

  beforeEach(() => {
    state = null;
    read_items.mockReset().mockResolvedValue([item]);
    read_context.mockReset().mockResolvedValue([]);
    push_toast.mockReset();
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  /** 挂载并等待 Hook 的初始化状态。 */
  async function render_hook(): Promise<void> {
    await act(async () => {
      root.render(createElement(Probe));
    });
  }

  it("详情读取失败时通知一次并保留当前编辑状态", async () => {
    read_items.mockRejectedValueOnce(new Error("详情读取失败"));
    await render_hook();

    await act(async () => {
      await state?.open_edit_dialog("1");
    });

    expect(state?.dialog_state.open).toBe(false);
    expect(push_toast).toHaveBeenCalledWith("error", expect.any(String));
    push_toast.mockClear();
    await act(async () => {
      await state?.open_edit_dialog("1");
    });
    act(() => {
      state?.update_dialog_draft({ dst: "未保存译文" });
    });
    read_items.mockRejectedValueOnce(new Error("详情读取失败"));
    await act(async () => {
      await expect(state?.save_dialog_entry()).resolves.toBeUndefined();
    });
    expect(push_toast).toHaveBeenCalledTimes(1);
    expect(state?.dialog_state).toMatchObject({
      open: true,
      saving: false,
      draft_item: { dst: "未保存译文" },
    });
  });

  it("上下文读取失败后可重试", async () => {
    const context_item: ProofreadingContextItem = {
      row_id: "1",
      row_number: 1,
      src: "原文",
      dst: "译文",
      name_src: null,
      name_dst: null,
    };
    read_context.mockRejectedValueOnce(new Error("failed")).mockResolvedValueOnce([context_item]);
    await render_hook();
    await act(async () => {
      await state?.open_edit_dialog("1");
    });
    await act(async () => {
      await state?.open_dialog_context();
    });
    expect(state?.dialog_state.context.status).toBe("error");

    await act(async () => {
      await state?.open_dialog_context();
    });
    expect(state?.dialog_state.context).toEqual({ status: "ready", items: [context_item] });
  });

  it("重新打开上下文后忽略旧请求结果", async () => {
    const stale_request = Promise.withResolvers<ProofreadingContextItem[]>();
    const current_request = Promise.withResolvers<ProofreadingContextItem[]>();
    read_context
      .mockReturnValueOnce(stale_request.promise)
      .mockReturnValueOnce(current_request.promise);
    await render_hook();
    await act(async () => {
      await state?.open_edit_dialog("1");
    });

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = state?.open_dialog_context();
      state?.close_dialog_context();
      second = state?.open_dialog_context();
    });
    await act(async () => {
      stale_request.resolve([]);
      await first;
    });
    expect(state?.dialog_state.context.status).toBe("loading");

    const current_item: ProofreadingContextItem = {
      row_id: "1",
      row_number: 1,
      src: "当前原文",
      dst: "当前译文",
      name_src: null,
      name_dst: null,
    };
    await act(async () => {
      current_request.resolve([current_item]);
      await second;
    });
    expect(state?.dialog_state.context).toEqual({ status: "ready", items: [current_item] });
  });
});
