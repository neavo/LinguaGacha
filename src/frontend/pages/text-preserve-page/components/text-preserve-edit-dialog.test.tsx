import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const shortcut_mock = vi.hoisted(() => vi.fn());

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/widgets/interactions/use-action-shortcut", () => ({
  useActionShortcut: shortcut_mock,
}));
vi.mock("@frontend/widgets/app-editor/app-editor", () => ({
  AppEditor: (props: {
    value: string;
    aria_label: string;
    read_only: boolean;
    invalid?: boolean;
  }) => (
    <textarea
      aria-label={props.aria_label}
      aria-invalid={props.invalid || undefined}
      readOnly={props.read_only}
      value={props.value}
    />
  ),
}));
vi.mock("@frontend/widgets/app-page-dialog", () => ({
  AppPageDialog: (props: {
    open: boolean;
    title: ReactNode;
    children: ReactNode;
    footer: ReactNode;
  }) =>
    props.open ? (
      <section aria-label={String(props.title)}>
        {props.children}
        <footer>{props.footer}</footer>
      </section>
    ) : null,
}));
vi.mock("@frontend/widgets/interactions/shortcut-kbd", () => ({ ShortcutKbd: () => null }));

import { TextPreserveEditDialog } from "./text-preserve-edit-dialog";

describe("TextPreserveEditDialog", () => {
  it("显示规则校验错误，并在只读时保留字段但禁用保存", async () => {
    const on_save = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TextPreserveEditDialog
          open
          mode="edit"
          entry={{ src: "\\U00110000", info: "非法转义" }}
          saving={false}
          readonly
          validation_message="转义序列无效"
          on_change={vi.fn()}
          on_save={on_save}
          on_close={vi.fn(async () => undefined)}
        />,
      );
    });

    const rule = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="quality_rule_editor.fields.rule"]',
    );
    expect(rule?.readOnly).toBe(true);
    expect(rule?.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector(".text-preserve-page__dialog-error")).not.toBeNull();
    expect(find_button(container, "app.action.save")?.disabled).toBe(true);
    expect(shortcut_mock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "save", enabled: false }),
    );

    await act(async () => root.unmount());
    container.remove();
  });
});

function find_button(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === text,
  );
}
