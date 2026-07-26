import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
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

const save_state = {
  open: true,
  mode: "save",
  value: "",
  submitting: false,
  target_virtual_id: null,
} as const;

describe("PresetNameDialog", () => {
  it("保留页面既有的占位文案与快捷键样式变体", () => {
    const outlined_html = renderToStaticMarkup(
      <PresetNameDialog
        state={save_state}
        name_placeholder_key="text_preserve_page.preset.dialog.name_placeholder"
        save_shortcut_variant="outlined"
        on_change={() => {}}
        on_submit={() => {}}
        on_close={() => {}}
      />,
    );
    const default_html = renderToStaticMarkup(
      <PresetNameDialog
        state={save_state}
        on_change={() => {}}
        on_submit={() => {}}
        on_close={() => {}}
      />,
    );

    expect(outlined_html).toContain(
      'placeholder="text_preserve_page.preset.dialog.name_placeholder"',
    );
    expect(outlined_html).toContain("border-primary-foreground/16");
    expect(default_html).toContain('placeholder="quality_editor.preset.dialog.name_placeholder"');
    expect(default_html).toContain("bg-background/18");
    expect(default_html).not.toContain("border-primary-foreground/16");
  });
});
