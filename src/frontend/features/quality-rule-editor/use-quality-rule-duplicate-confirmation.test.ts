import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useQualityRuleDuplicateConfirmation } from "./use-quality-rule-duplicate-confirmation";

type Entry = { entry_id: string; src: string; info: string };
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
});

it("覆盖内容变化但重复数量相同时重新确认，最终使用最新目标", async () => {
  let entries: Entry[] = [{ entry_id: "original", src: "foo", info: "old" }];
  const apply = vi.fn(async () => true);
  let current!: ReturnType<typeof useQualityRuleDuplicateConfirmation<Entry, null>>;
  /** 通过公开 Hook 输出观察页面状态与操作结果。 */
  function Probe() {
    current = useQualityRuleDuplicateConfirmation({
      rule_type: "TEXT_PRESERVE",
      apply_entries: apply,
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root!.render(createElement(Probe));
  });
  await act(async () => {
    await current.persist_entries_with_duplicate_resolution(
      () => ({
        kind: "import",
        existing_entries: entries,
        incoming_entries: [{ entry_id: "new", src: "foo", info: "replacement" }],
      }),
      null,
    );
  });
  entries = [{ entry_id: "original", src: "foo", info: "changed while confirming" }];
  await act(async () => {
    await current.import_duplicate_overwrite();
  });
  expect(apply).not.toHaveBeenCalled();
  expect(current.import_confirm_state).toMatchObject({
    open: true,
    duplicate_count: 1,
    submitting: false,
  });
  await act(async () => {
    await current.import_duplicate_overwrite();
  });
  expect(apply).toHaveBeenCalledWith(
    [expect.objectContaining({ entry_id: "original", info: "replacement" })],
    null,
  );
});

it("项目重置后旧确认提交的失败收尾不会恢复弹窗", async () => {
  let settle!: (saved: boolean) => void;
  const apply = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        settle = resolve;
      }),
  );
  let current!: ReturnType<typeof useQualityRuleDuplicateConfirmation<Entry, null>>;
  /** 通过公开 Hook 输出观察页面状态与操作结果。 */
  function Probe() {
    current = useQualityRuleDuplicateConfirmation({
      rule_type: "TEXT_PRESERVE",
      apply_entries: apply,
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root!.render(createElement(Probe));
  });
  await act(async () => {
    await current.persist_entries_with_duplicate_resolution(
      () => ({
        kind: "import",
        existing_entries: [{ entry_id: "original", src: "foo", info: "old" }],
        incoming_entries: [{ entry_id: "new", src: "foo", info: "new" }],
      }),
      null,
    );
  });
  let pending!: Promise<void>;
  await act(async () => {
    pending = current.import_duplicate_overwrite();
  });
  await act(async () => {
    current.reset_import_confirmation();
  });
  await act(async () => {
    settle(false);
    await pending;
  });
  expect(current.import_confirm_state).toMatchObject({ open: false, submitting: false });
});
