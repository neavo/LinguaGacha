import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/appearance/appearance-provider", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
}));

import { GlossaryEditDialog } from "./glossary-edit-dialog";

describe("GlossaryEditDialog", () => {
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

  it.each([
    "quality_rule_editor.fields.source",
    "glossary_page.fields.translation",
    "glossary_page.fields.description",
  ])("点击 %s 正文与标题时保持换行设置", async (label) => {
    await act(async () => {
      root.render(
        <GlossaryEditDialog
          open
          mode="edit"
          entry={{ src: "hero", dst: "勇者", info: "主角", case_sensitive: false }}
          saving={false}
          readonly={false}
          on_change={vi.fn()}
          on_save={vi.fn(async () => undefined)}
          on_close={vi.fn(async () => undefined)}
        />,
      );
    });

    const content = document.querySelector<HTMLElement>(`.cm-content[aria-label="${label}"]`)!;
    const section = content.closest(".glossary-page__dialog-section")!;
    const wrap_action = section.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
    const initial_wrap_state = wrap_action.getAttribute("aria-pressed");

    await act(async () => content.querySelector<HTMLElement>(".cm-line")!.click());
    expect(wrap_action.getAttribute("aria-pressed")).toBe(initial_wrap_state);
    await act(async () =>
      section.querySelector<HTMLElement>(".glossary-page__dialog-section-title")!.click(),
    );
    expect(wrap_action.getAttribute("aria-pressed")).toBe(initial_wrap_state);
  });

  it("切换术语规则并保存，只读时禁用编辑与保存", async () => {
    const on_change = vi.fn();
    const on_save = vi.fn(async () => undefined);
    // 在同一次挂载中切换只读态，验证控件随运行状态更新。
    const render_dialog = async (readonly: boolean): Promise<void> => {
      await act(async () => {
        root.render(
          <GlossaryEditDialog
            open
            mode="create"
            entry={{ src: "hero", dst: "勇者", info: "主角", case_sensitive: false }}
            saving={false}
            readonly={readonly}
            on_change={on_change}
            on_save={on_save}
            on_close={vi.fn(async () => undefined)}
          />,
        );
      });
    };

    await render_dialog(false);
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[aria-label="glossary_page.rule.case_sensitive"] button[aria-pressed="false"]',
        )
        ?.click();
      find_button("app.action.save")?.click();
    });
    expect(on_change).toHaveBeenCalledWith({ case_sensitive: true });
    expect(on_save).toHaveBeenCalledOnce();

    await render_dialog(true);
    expect(
      document
        .querySelector<HTMLElement>('.cm-content[aria-label="quality_rule_editor.fields.source"]')
        ?.getAttribute("contenteditable"),
    ).toBe("false");
    expect(find_button("app.action.save")?.disabled).toBe(true);
  });
});

/** 按可见动作文字查找按钮，允许按钮同时展示快捷键提示。 */
function find_button(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.startsWith(text),
  );
}
