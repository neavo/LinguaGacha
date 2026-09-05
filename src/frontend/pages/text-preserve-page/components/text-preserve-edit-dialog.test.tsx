import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/widgets/interactions/use-action-shortcut", () => ({
  useActionShortcut: () => undefined,
}));
vi.mock("@frontend/app/appearance/appearance-provider", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
}));
vi.mock("@frontend/shadcn/tooltip", () => ({
  Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipTrigger: (props: { render: ReactNode }) => <>{props.render}</>,
  TooltipContent: () => null,
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
      find_button(container, "app.action.save")?.focus();
      await act(async () => render(true));
      const rule = container.querySelector(
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

function find_button(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === text,
  );
}
