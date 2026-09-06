import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/appearance/appearance-provider", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
}));

import { TextReplacementEditDialog } from "./text-replacement-edit-dialog";

describe("TextReplacementEditDialog", () => {
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

  it.each(["quality_rule_editor.fields.source", "text_replacement_page.fields.replacement"])(
    "点击 %s 正文与标题时保持换行设置",
    async (label) => {
      await act(async () => {
        root.render(
          <TextReplacementEditDialog
            open
            mode="edit"
            entry={{ src: "hero", dst: "勇者", regex: false, case_sensitive: true }}
            saving={false}
            readonly={false}
            validation_message={null}
            on_change={vi.fn()}
            on_save={vi.fn(async () => undefined)}
            on_close={vi.fn(async () => undefined)}
          />,
        );
      });

      const content = document.querySelector<HTMLElement>(`.cm-content[aria-label="${label}"]`)!;
      const section = content.closest(".text-replacement-page__dialog-section")!;
      const wrap_action = section.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
      const initial_wrap_state = wrap_action.getAttribute("aria-pressed");

      await act(async () => content.querySelector<HTMLElement>(".cm-line")!.click());
      expect(wrap_action.getAttribute("aria-pressed")).toBe(initial_wrap_state);
      await act(async () =>
        section.querySelector<HTMLElement>(".text-replacement-page__dialog-section-title")!.click(),
      );
      expect(wrap_action.getAttribute("aria-pressed")).toBe(initial_wrap_state);
    },
  );

  it("通过独立规则控件更新正则与大小写状态", async () => {
    const on_change = vi.fn();

    await act(async () => {
      root.render(
        <TextReplacementEditDialog
          open
          mode="edit"
          entry={{ src: "hero", dst: "勇者", regex: false, case_sensitive: true }}
          saving={false}
          readonly={false}
          validation_message={null}
          on_change={on_change}
          on_save={vi.fn(async () => undefined)}
          on_close={vi.fn(async () => undefined)}
        />,
      );
    });

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[aria-label="text_replacement_page.rule.regex"] button[aria-pressed="false"]',
        )
        ?.click();
      document
        .querySelector<HTMLButtonElement>(
          '[aria-label="text_replacement_page.rule.case_sensitive"] button[aria-pressed="false"]',
        )
        ?.click();
    });

    expect(on_change).toHaveBeenCalledWith({ regex: true });
    expect(on_change).toHaveBeenCalledWith({ case_sensitive: false });
  });
});
