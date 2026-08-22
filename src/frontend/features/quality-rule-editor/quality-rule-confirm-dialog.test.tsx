import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QualityRuleConfirmDialog } from "./quality-rule-confirm-dialog";
import type { QualityRuleConfirmState } from "./quality-rule-confirm-state";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@frontend/widgets/app-alert-dialog", () => ({
  AppConfirmDialog: (props: { open: boolean; description: string }) =>
    props.open ? <span>{props.description}</span> : null,
}));

describe("QualityRuleConfirmDialog", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root !== null) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("删除确认展示选中记录数量", () => {
    const state: QualityRuleConfirmState = {
      open: true,
      kind: "delete-selection",
      selection_count: 3,
      preset_name: "待处理预设",
      preset_input_value: "",
      submitting: false,
      target_virtual_id: "user:test.txt",
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <QualityRuleConfirmDialog state={state} on_confirm={vi.fn()} on_close={vi.fn()} />,
      );
    });

    expect(container?.textContent).toBe("quality_rule_editor.confirm.delete_selection.description");
  });
});
