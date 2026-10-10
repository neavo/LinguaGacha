import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apply_project_item_manual_update } from "@shared/project/project-item-update";
import type { ProofreadingProjectWriteRunner } from "./proofreading-page-state-contract";
import { useProofreadingDialogActions } from "./use-proofreading-dialog-actions";
import type {
  ProofreadingClientItem,
  ProofreadingContextItem,
} from "@shared/proofreading/proofreading-types";
import { build_project_item_public_record, create_item } from "@domain/item";
import type { ProjectItemPublicRecord } from "@domain/item";

const push_toast = vi.hoisted(() => vi.fn());
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_error_toast: push_toast }));

const item: ProofreadingClientItem = {
  item_id: 1,
  row_id: "1",
  file_path: "chapter.txt",
  internal_file_path: null,
  row_number: 1,
  src: "原文",
  dst: "译文",
  name_src: null,
  name_dst: null,
  status: "NONE",
  warnings: [],
  glossary_applications: [],
  compressed_src: "原文",
  compressed_dst: "译文",
};

const saved_item = build_project_item_public_record(
  create_item({
    id: 1,
    row: 1,
    src: "原文",
    dst: "已保存译文",
    name_src: ["角色", "旁白"],
  }),
);

describe("useProofreadingDialogActions", () => {
  let root: Root;
  let container: HTMLDivElement;
  let state: ReturnType<typeof useProofreadingDialogActions> | null;
  const read_items = vi.fn<() => Promise<ProofreadingClientItem[]>>();
  const read_context = vi.fn<() => Promise<ProofreadingContextItem[]>>();
  const options = {
    list_revisions: { items: 7, proofreading: 1 },
    visible_item_by_id: new Map([["1", item]]),
    read_items_by_row_ids: read_items,
    read_context,
    read_raw_item: vi.fn<() => Promise<ProjectItemPublicRecord>>(async () => saved_item),
    run_project_write: vi.fn<ProofreadingProjectWriteRunner>(async () => true),
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
    options.read_raw_item.mockReset().mockResolvedValue(saved_item);
    options.run_project_write.mockReset().mockResolvedValue(true);
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

  it("保存姓名差异后完成条目并关闭弹窗", async () => {
    const current = { ...item, status: "ERROR", name_dst: ["旧名", "旁白"] };
    read_items.mockResolvedValue([current]);
    await render_hook();
    await act(async () => {
      await state?.open_edit_dialog("1");
    });
    act(() => state?.update_dialog_draft({ name_dst: "新名" }));
    await act(async () => {
      await state?.save_dialog_entry();
    });
    const change = options.run_project_write.mock.calls[0]![0].plan!.request_body.changes![0]!;
    expect(change).toEqual({ item_id: 1, name_dst: "新名" });
    const saved = apply_project_item_manual_update(current, change)!;
    expect(saved.status).toBe("PROCESSED");
    expect(saved.name_dst).toEqual(["新名", "旁白"]);
    expect(state?.dialog_state.open).toBe(false);
  });

  it.each(["navigate", "save"] as const)(
    "无内容变化时 %s 保留失败状态且省略提交",
    async (action) => {
      read_items.mockResolvedValue([{ ...item, status: "ERROR" }]);
      await render_hook();
      await act(async () => {
        await state?.open_edit_dialog("1");
      });
      await act(async () => {
        if (action === "save") await state?.save_dialog_entry();
        else expect(await state?.save_dialog_draft()).toBe(true);
      });
      expect(options.run_project_write).not.toHaveBeenCalled();
      expect(state?.dialog_state.open).toBe(action === "navigate");
    },
  );

  it("内容保存失败时保留弹窗", async () => {
    options.run_project_write.mockResolvedValue(false);
    await render_hook();
    await act(async () => {
      await state?.open_edit_dialog("1");
    });
    act(() => state?.update_dialog_draft({ dst: "新译文" }));
    await act(async () => {
      await state?.save_dialog_entry();
    });
    expect(state?.dialog_state).toMatchObject({
      open: true,
      pending: false,
      draft_item: { dst: "新译文" },
    });
  });

  it("保存读取同步互斥，卸载后不继续提交", async () => {
    await render_hook();
    await act(async () => {
      await state?.open_edit_dialog("1");
    });
    act(() => {
      state?.update_dialog_draft({ dst: "未保存译文" });
    });
    const request = Promise.withResolvers<ProofreadingClientItem[]>();
    read_items.mockReturnValueOnce(request.promise);
    let saving: Promise<void> | undefined;
    await act(async () => {
      saving = state?.save_dialog_entry();
      await state?.save_dialog_entry();
    });
    expect(read_items).toHaveBeenCalledTimes(2);
    await act(async () => {
      root.unmount();
    });
    await act(async () => {
      request.resolve([item]);
      await saving;
    });
    expect(options.run_project_write).not.toHaveBeenCalled();
    expect(push_toast).not.toHaveBeenCalled();
  });

  it("详情读取失败时通知一次并保留当前编辑状态", async () => {
    read_items.mockRejectedValueOnce(new Error("详情读取失败"));
    await render_hook();

    await act(async () => {
      await state?.open_edit_dialog("1");
    });

    expect(state?.dialog_state.open).toBe(false);
    expect(push_toast).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
    push_toast.mockClear();
    await act(async () => {
      await state?.open_edit_dialog("1");
    });
    act(() => {
      state?.update_dialog_draft({ dst: "未保存译文" });
    });
    read_items.mockRejectedValueOnce(new Error("详情读取失败"));
    await act(async () => {
      await state?.save_dialog_entry();
    });
    expect(push_toast).toHaveBeenCalledTimes(1);
    expect(state?.dialog_state).toMatchObject({
      open: true,
      pending: false,
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
      await state?.open_dialog_view("context");
    });
    expect(state?.dialog_state.view).toMatchObject({ kind: "context", status: "error" });

    await act(async () => {
      await state?.open_dialog_view("context");
    });
    expect(state?.dialog_state.view).toEqual({
      kind: "context",
      status: "ready",
      items: [context_item],
    });
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
      first = state?.open_dialog_view("context");
      state?.return_to_edit();
      second = state?.open_dialog_view("context");
    });
    await act(async () => {
      stale_request.resolve([]);
      await first;
    });
    expect(state?.dialog_state.view).toMatchObject({ kind: "context", status: "loading" });

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
    expect(state?.dialog_state.view).toEqual({
      kind: "context",
      status: "ready",
      items: [current_item],
    });
  });

  it("原始数据失败只通知一次，展示已保存快照，返回保留草稿，重进读取当前值", async () => {
    const current_item = { ...saved_item, extra_field: { nested: [null, "", false] } };
    const updated_item = { ...saved_item, dst: "新保存译文", extra_field: '{"updated":true}' };
    options.read_raw_item
      .mockRejectedValueOnce(new Error("读取失败"))
      .mockResolvedValueOnce(current_item)
      .mockResolvedValueOnce(updated_item);
    await render_hook();
    await act(async () => {
      await state?.open_edit_dialog("1");
    });
    act(() => state?.update_dialog_draft({ dst: "草稿", name_dst: "草稿姓名" }));
    await act(async () => {
      await state?.open_dialog_view("raw-data");
    });
    expect(state?.dialog_state.view).toEqual({ kind: "raw-data", status: "error" });
    expect(push_toast).toHaveBeenCalledTimes(1);
    act(() => state?.return_to_edit());
    expect(state?.dialog_state).toMatchObject({
      view: { kind: "edit" },
      draft_item: { dst: "草稿", name_dst: "草稿姓名" },
    });
    await act(async () => {
      await state?.open_dialog_view("raw-data");
    });
    expect(state?.dialog_state.view).toEqual({
      kind: "raw-data",
      status: "ready",
      text: JSON.stringify(current_item, null, 2),
    });
    current_item.dst = "后台已更新";
    act(() => state?.update_dialog_draft({ dst: "继续编辑草稿" }));
    expect(state?.dialog_state.view).toMatchObject({
      text: expect.stringContaining('"dst": "已保存译文"'),
    });
    act(() => state?.return_to_edit());
    await act(async () => {
      await state?.open_dialog_view("raw-data");
    });
    const view = state?.dialog_state.view;
    if (view?.kind !== "raw-data" || view.status !== "ready") throw new Error("原始数据未就绪");
    expect(JSON.parse(view.text)).toEqual(updated_item);
    expect(view.text).toContain('\n  "item_id": 1');
    act(() => state?.return_to_edit());
    expect(state?.dialog_state.draft_item).toEqual({ dst: "继续编辑草稿", name_dst: "草稿姓名" });
  });

  it.each(["return", "close", "target", "view"] as const)(
    "%s 后迟到的原始数据无法覆盖视图或通知",
    async (action) => {
      await render_hook();
      await act(async () => {
        await state?.open_edit_dialog("1");
      });
      const request = Promise.withResolvers<ProjectItemPublicRecord>();
      options.read_raw_item.mockReturnValueOnce(request.promise);
      let reading: Promise<void> | undefined;
      act(() => {
        reading = state?.open_dialog_view("raw-data");
      });
      if (action === "return") act(() => state?.return_to_edit());
      if (action === "close") act(() => state?.reset_dialog());
      if (action === "target")
        act(() => state?.show_dialog_item({ ...item, item_id: 2, row_id: "2" }));
      if (action === "view") {
        read_context.mockResolvedValue([
          { row_id: "1", row_number: 1, src: "原文", dst: "译文", name_src: null, name_dst: null },
        ]);
        await act(async () => {
          await state?.open_dialog_view("context");
        });
      }
      const current = state?.dialog_state;
      await act(async () => {
        request.reject(new Error("旧请求失败"));
        await reading;
      });
      expect(state?.dialog_state).toEqual(current);
      expect(push_toast).not.toHaveBeenCalled();
    },
  );
});
