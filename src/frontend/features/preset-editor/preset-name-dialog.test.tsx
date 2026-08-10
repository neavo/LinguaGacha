import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@frontend/widgets/interactions/use-action-shortcut", () => ({
  useActionShortcut: () => {},
}));

vi.mock("@frontend/widgets/app-page-dialog", () => ({
  AppPageDialog: (props: { children: ReactNode; footer: ReactNode; title: string }) => (
    <section>
      <h1>{props.title}</h1>
      {props.children}
      {props.footer}
    </section>
  ),
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

  it("编辑名称并用 Enter 或保存按钮提交", async () => {
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
          name_placeholder_key="text_preserve_page.preset.dialog.name_placeholder"
          on_change={on_change}
          on_submit={on_submit}
          on_close={() => {}}
        />,
      );
    });

    const input = container.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("缺少预设名称输入框。");
    }
    expect(input.placeholder).toBe("text_preserve_page.preset.dialog.name_placeholder");

    await act(async () => {
      const value_setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      value_setter?.call(input, "新预设");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      [...container!.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("app.action.save"))
        ?.click();
    });

    expect(on_change).toHaveBeenCalledWith("新预设");
    expect(on_submit).toHaveBeenCalledTimes(2);
  });
});
