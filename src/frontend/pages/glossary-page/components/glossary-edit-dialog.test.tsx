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
  AppEditor: (props: { value: string; aria_label: string; read_only: boolean }) => (
    <textarea aria-label={props.aria_label} readOnly={props.read_only} defaultValue={props.value} />
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
vi.mock("@frontend/widgets/boolean-segmented-toggle", () => ({
  BooleanSegmentedToggle: (props: {
    aria_label: string;
    value: boolean;
    disabled: boolean;
    on_value_change: (value: boolean) => void;
  }) => (
    <button
      type="button"
      aria-label={props.aria_label}
      disabled={props.disabled}
      onClick={() => props.on_value_change(!props.value)}
    />
  ),
}));
vi.mock("@frontend/widgets/interactions/shortcut-kbd", () => ({ ShortcutKbd: () => null }));

import { GlossaryEditDialog } from "./glossary-edit-dialog";

describe("GlossaryEditDialog", () => {
  it("通过可访问字段编辑术语规则，并在只读时禁用保存", async () => {
    const on_change = vi.fn();
    const on_save = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
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
    expect(container.querySelector('[aria-label="app.action.create"]')).not.toBeNull();
    expect(
      container.querySelector('textarea[aria-label="quality_rule_editor.fields.source"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('textarea[aria-label="glossary_page.fields.translation"]'),
    ).not.toBeNull();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="glossary_page.rule.case_sensitive"]')
        ?.click();
      find_button(container, "app.action.save")?.click();
    });
    expect(on_change).toHaveBeenCalledWith({ case_sensitive: true });
    expect(on_save).toHaveBeenCalledOnce();

    await render_dialog(true);
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="quality_rule_editor.fields.source"]',
      )?.readOnly,
    ).toBe(true);
    expect(find_button(container, "app.action.save")?.disabled).toBe(true);

    await act(async () => root.unmount());
    container.remove();
  });
});

function find_button(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === text,
  );
}
