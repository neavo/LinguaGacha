import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { create_empty_batch_translation_snapshot } from "@shared/batch-translation/batch-translation";
import { useProofreadingBatchActions } from "./use-proofreading-batch-actions";

vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: vi.fn() }));

it.each([false, true])("重翻确认提交稳定身份并完成回执或错误处理：失败 %s", async (failed) => {
  const snapshot = create_empty_batch_translation_snapshot();
  const error = new Error("请求失败");
  vi.mocked(api_fetch).mockReset();
  if (failed) vi.mocked(api_fetch).mockRejectedValueOnce(error);
  else vi.mocked(api_fetch).mockResolvedValueOnce({ batch_translation: snapshot });
  const options: Parameters<typeof useProofreadingBatchActions>[0] = {
    readonly: false,
    is_refreshing: false,
    is_writing: false,
    dialog_open: true,
    list_revisions: {},
    read_items_by_row_ids: vi.fn(async () => []),
    sync_task_snapshot: vi.fn(),
    run_project_write: vi.fn(),
    set_is_writing: vi.fn(),
    resolve_preferred_row_id: () => null,
    remember_preferred_row_id: vi.fn(),
    close_edit_dialog: vi.fn(),
    handle_api_error: vi.fn(),
    t: (key) => key,
  };
  let actions!: ReturnType<typeof useProofreadingBatchActions>;
  /** 挂载动作拥有者，页面负责的行级展示由页面集成测试验证。 */
  function Probe() {
    actions = useProofreadingBatchActions(options);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => {
      root.render(createElement(Probe));
    });
    await act(async () => {
      actions.request_retranslate_row_ids(["2", "1", "2"]);
    });
    expect(api_fetch).not.toHaveBeenCalled();
    await act(async () => {
      await actions.confirm_pending_confirmation("retranslate");
    });
    expect(api_fetch).toHaveBeenCalledWith("/api/batch-translation/start", {
      operation: "retranslate",
      scope: { kind: "items", item_ids: [2, 1] },
    });
    expect(actions.pending_confirmation).toBeNull();
    expect(options.set_is_writing).toHaveBeenLastCalledWith(false);
    if (failed) {
      expect(options.sync_task_snapshot).not.toHaveBeenCalled();
      expect(options.handle_api_error).toHaveBeenCalledWith(error, expect.any(String));
      expect(options.close_edit_dialog).not.toHaveBeenCalled();
    } else {
      expect(options.sync_task_snapshot).toHaveBeenCalledWith(snapshot);
      expect(options.close_edit_dialog).toHaveBeenCalledOnce();
    }
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});
