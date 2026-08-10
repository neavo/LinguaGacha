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
      defaultValue={props.value}
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
vi.mock("@frontend/widgets/segmented-toggle/segmented-toggle", () => ({
  SegmentedToggle: (props: {
    aria_label: string;
    value: "enabled" | "disabled";
    disabled: boolean;
    on_value_change: (value: "enabled" | "disabled") => void;
  }) => (
    <button
      type="button"
      aria-label={props.aria_label}
      disabled={props.disabled}
      onClick={() => props.on_value_change(props.value === "enabled" ? "disabled" : "enabled")}
    />
  ),
}));
vi.mock("@frontend/widgets/interactions/shortcut-kbd", () => ({ ShortcutKbd: () => null }));

import { TextReplacementEditDialog } from "./text-replacement-edit-dialog";

describe("TextReplacementEditDialog", () => {
  it("通过独立规则控件更新正则与大小写状态", async () => {
    const on_change = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

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

    expect(
      container.querySelector('textarea[aria-label="quality_rule_editor.fields.source"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('textarea[aria-label="text_replacement_page.fields.replacement"]'),
    ).not.toBeNull();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="text_replacement_page.rule.regex"]')
        ?.click();
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="text_replacement_page.rule.case_sensitive"]',
        )
        ?.click();
    });

    expect(on_change).toHaveBeenCalledWith({ regex: true });
    expect(on_change).toHaveBeenCalledWith({ case_sensitive: false });

    await act(async () => root.unmount());
    container.remove();
  });
});
