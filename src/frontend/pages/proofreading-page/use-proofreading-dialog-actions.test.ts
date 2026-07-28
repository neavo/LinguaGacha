import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProofreadingCommandPlan } from "@shared/proofreading/proofreading-command-planner";
import type {
  ProofreadingClientItem,
  ProofreadingContextItem,
} from "@shared/proofreading/proofreading-types";
import { useProofreadingDialogActions } from "@frontend/pages/proofreading-page/use-proofreading-dialog-actions";

type DialogActionState = ReturnType<typeof useProofreadingDialogActions>;

type WriteCall = {
  path: string;
  plan: ProofreadingCommandPlan | null;
  fallback_error_key: string;
  preferred_row_id?: string | null;
  success_message_builder?: ((changed_count: number) => string) | null;
  close_dialog?: boolean;
};

// 构造弹窗保存场景需要的完整校对 item。
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
    name_dst: "旧姓名",
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

// 构造上下文读取结果，竞态用例只覆盖需要区分的新旧译文。
function create_context_item(
  overrides: Partial<ProofreadingContextItem> = {},
): ProofreadingContextItem {
  return {
    row_id: "1",
    row_number: 1,
    src: "原文",
    dst: "旧译文",
    name_src: null,
    name_dst: "旧姓名",
    ...overrides,
  };
}

describe("useProofreadingDialogActions", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: DialogActionState | null = null;
  const target_item = create_client_item(); // 当前弹窗编辑目标
  const write_calls: WriteCall[] = []; // 记录公开写入请求，避免断言 hook 内部状态
  const read_context = vi.fn<(row_id: string) => Promise<ProofreadingContextItem[]>>();

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
    read_context.mockReset();
  });

  // 暴露 hook 返回值，测试只通过公开动作驱动弹窗状态。
  function DialogActionProbe(): null {
    latest_state = useProofreadingDialogActions({
      list_revisions: {
        items: 7,
        proofreading: 5,
        quality: 3,
      },
      visible_item_by_id: new Map([["1", target_item]]),
      read_items_by_row_ids: async (row_ids) => {
        return row_ids.includes("1") ? [target_item] : [];
      },
      read_context,
      run_project_write: vi.fn(async (args: WriteCall) => {
        write_calls.push(args);
      }),
      push_toast: vi.fn(),
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
      root?.render(createElement(DialogActionProbe));
    });
  }

  it("保存弹窗改动时提交当前列表 revision 锁", async () => {
    await render_hook();

    await act(async () => {
      await latest_state?.open_edit_dialog("1");
    });
    await act(async () => {
      latest_state?.update_dialog_draft({
        dst: "新译文",
        name_dst: "新姓名",
      });
    });
    await act(async () => {
      await latest_state?.save_dialog_entry();
    });

    expect(write_calls).toHaveLength(1);
    expect(write_calls[0]).toMatchObject({
      path: "/api/proofreading/item/save",
      fallback_error_key: "proofreading_page.feedback.save_failed",
      preferred_row_id: "1",
      close_dialog: true,
    });
    expect(write_calls[0]?.plan?.request_body).toMatchObject({
      item_id: 1,
      dst: "新译文",
      name_dst: "新姓名",
      expected_section_revisions: {
        items: 7,
        proofreading: 5,
      },
    });
  });

  it("读取上下文失败后可重试并返回编辑状态", async () => {
    const context_item = create_context_item();
    read_context.mockRejectedValueOnce(new Error("failed")).mockResolvedValueOnce([context_item]);
    await render_hook();
    await act(async () => {
      await latest_state?.open_edit_dialog("1");
    });
    await act(async () => {
      await latest_state?.open_dialog_context();
    });
    expect(latest_state?.dialog_state.context.status).toBe("error");

    await act(async () => {
      await latest_state?.open_dialog_context();
    });
    expect(latest_state?.dialog_state.context).toEqual({
      status: "ready",
      items: [context_item],
    });

    act(() => {
      latest_state?.close_dialog_context();
    });
    expect(latest_state?.dialog_state.context).toEqual({ status: "idle" });
  });

  it("返回编辑并重开同一条目后忽略旧上下文结果", async () => {
    const stale_item = create_context_item({ dst: "旧请求" });
    const current_item = create_context_item({ dst: "新请求" });
    let resolve_stale: ((items: ProofreadingContextItem[]) => void) | undefined;
    let resolve_current: ((items: ProofreadingContextItem[]) => void) | undefined;
    read_context
      .mockImplementationOnce(() => {
        return new Promise((resolve) => {
          resolve_stale = resolve;
        });
      })
      .mockImplementationOnce(() => {
        return new Promise((resolve) => {
          resolve_current = resolve;
        });
      });
    await render_hook();
    await act(async () => {
      await latest_state?.open_edit_dialog("1");
    });

    let stale_request: Promise<void> | undefined;
    act(() => {
      stale_request = latest_state?.open_dialog_context();
    });
    expect(latest_state?.dialog_state.context.status).toBe("loading");
    act(() => {
      latest_state?.close_dialog_context();
    });
    let current_request: Promise<void> | undefined;
    act(() => {
      current_request = latest_state?.open_dialog_context();
    });

    resolve_stale?.([stale_item]);
    await act(async () => {
      await stale_request;
    });
    expect(latest_state?.dialog_state.context.status).toBe("loading");

    resolve_current?.([current_item]);
    await act(async () => {
      await current_request;
    });

    expect(latest_state?.dialog_state.context).toEqual({ status: "ready", items: [current_item] });
  });
});
