import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/appearance/appearance-provider", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
}));

import { TextPreserveEditDialog } from "./text-preserve-edit-dialog";

describe("TextPreserveEditDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it.each(["quality_rule_editor.fields.rule", "text_preserve_page.fields.note"])(
    "点击 %s 正文与标题时保持换行设置",
    async (label) => {
      await act(async () => {
        root.render(
          <TextPreserveEditDialog
            open
            mode="edit"
            entry={{ src: "hero", info: "主角" }}
            saving={false}
            readonly={false}
            invalid={false}
            on_change={vi.fn()}
            on_save={vi.fn(async () => undefined)}
            on_close={vi.fn(async () => undefined)}
          />,
        );
      });

      const content = document.querySelector<HTMLElement>(`.cm-content[aria-label="${label}"]`)!;
      const section = content.closest(".text-preserve-page__dialog-section")!;
      const wrap_action = section.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
      const initial_wrap_state = wrap_action.getAttribute("aria-pressed");

      await act(async () => content.querySelector<HTMLElement>(".cm-line")!.click());
      expect(wrap_action.getAttribute("aria-pressed")).toBe(initial_wrap_state);
      await act(async () =>
        section.querySelector<HTMLElement>(".text-preserve-page__dialog-section-title")!.click(),
      );
      expect(wrap_action.getAttribute("aria-pressed")).toBe(initial_wrap_state);
    },
  );

  it("标记规则校验错误，并在只读时保留字段但禁用保存", async () => {
    const on_save = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <TextPreserveEditDialog
          open
          mode="edit"
          entry={{ src: "\\U00110000", info: "非法转义" }}
          saving={false}
          readonly
          invalid
          on_change={vi.fn()}
          on_save={on_save}
          on_close={vi.fn(async () => undefined)}
        />,
      );
    });

    const rule = document.querySelector<HTMLElement>(
      '.cm-content[aria-label="quality_rule_editor.fields.rule"]',
    );
    expect(rule?.getAttribute("contenteditable")).toBe("false");
    expect(rule?.getAttribute("aria-invalid")).toBe("true");
    expect(find_button("app.action.save")?.disabled).toBe(true);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }),
      );
    });
    expect(on_save).not.toHaveBeenCalled();
  });
  it("校验失败后将焦点定位到规则编辑器", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (invalid: boolean) =>
      root.render(
        <TextPreserveEditDialog
          open
          mode="edit"
          entry={{ src: "[", info: "规则" }}
          saving={false}
          readonly={false}
          invalid={invalid}
          on_change={vi.fn()}
          on_save={async () => undefined}
          on_close={async () => undefined}
        />,
      );
    try {
      await act(async () => render(false));
      find_button("app.action.save")?.focus();
      await act(async () => render(true));
      const rule = document.querySelector(
        '.cm-content[aria-label="quality_rule_editor.fields.rule"]',
      );
      expect(document.activeElement).toBe(rule);
      expect(rule?.getAttribute("aria-invalid")).toBe("true");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});

/** 按可见动作文字查找按钮，允许按钮同时展示快捷键提示。 */
function find_button(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.startsWith(text),
  );
}
