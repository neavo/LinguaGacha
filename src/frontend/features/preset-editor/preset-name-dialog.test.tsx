import { act } from "react";

import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import { PresetNameDialog } from "./preset-name-dialog";

describe("PresetNameDialog", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("编辑名称后用 Enter 提交，提交期间阻止重复操作", async () => {
    const on_change = vi.fn();
    const on_submit = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <PresetNameDialog
          state={{
            open: true,
            mode: "save",
            value: "",
            submitting: false,
            target_virtual_id: null,
          }}
          on_change={on_change}
          on_submit={on_submit}
          on_close={() => {}}
        />,
      );
    });

    const input = document.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("缺少预设名称输入框。");
    }
    await act(async () => {
      const value_setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      value_setter?.call(input, "新预设");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(on_change).toHaveBeenCalledWith("新预设");
    expect(on_submit).toHaveBeenCalledOnce();
    await act(async () => {
      root?.render(
        <PresetNameDialog
          state={{
            open: true,
            mode: "save",
            value: "新预设",
            submitting: true,
            target_virtual_id: null,
          }}
          on_change={on_change}
          on_submit={on_submit}
          on_close={() => {}}
        />,
      );
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(on_submit).toHaveBeenCalledOnce();
  });
});
