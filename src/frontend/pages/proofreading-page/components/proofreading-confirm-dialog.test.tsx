import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProofreadingConfirmDialog } from "./proofreading-confirm-dialog";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("ProofreadingConfirmDialog", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("清空确认把两个动作映射到各自的提交意图", () => {
    const on_confirm = vi.fn(async () => {});
    render_dialog(
      <ProofreadingConfirmDialog
        state={{
          kind: "clear-translations",
          target_row_ids: ["1", "2"],
          preferred_row_id: "1",
          submitting_action: null,
        }}
        on_confirm={on_confirm}
        on_close={vi.fn()}
      />,
    );

    const secondary_action = document.body.querySelector<HTMLButtonElement>(
      '[data-slot="alert-dialog-secondary-action"]',
    );
    const primary_action = document.body.querySelector<HTMLButtonElement>(
      '[data-slot="alert-dialog-primary-action"]',
    );
    if (secondary_action === null || primary_action === null) {
      throw new Error("缺少清空译文确认动作");
    }

    act(() => secondary_action.click());
    act(() => primary_action.click());
    expect(on_confirm).toHaveBeenNthCalledWith(1, "clear-translations");
    expect(on_confirm).toHaveBeenNthCalledWith(2, "clear-translations-and-reset-status");
  });

  function render_dialog(element: JSX.Element): void {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(element));
  }
});
