import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@frontend/widgets/app-alert-dialog", () => ({
  AppAlertDialog: (props: {
    open: boolean;
    description: string;
    confirmLabel?: string;
    cancelLabel: string;
  }) =>
    props.open ? (
      <section>
        <p>{props.description}</p>
        <button type="button">{props.cancelLabel}</button>
        <button type="button">{props.confirmLabel ?? "默认确认"}</button>
      </section>
    ) : null,
}));

import { CustomPromptConfirmDialog } from "./custom-prompt-confirm-dialog";

describe("CustomPromptConfirmDialog", () => {
  it.each([
    [
      "enable-after-import",
      "custom_prompt_page.confirm.enable_after_import.description",
      "app.toggle.enabled",
    ],
    ["reset", "quality_editor.confirm.reset.description", "默认确认"],
  ] as const)("%s 确认展示对应说明和动作", (kind, description, action) => {
    const html = renderToStaticMarkup(
      <CustomPromptConfirmDialog
        state={{ kind, submitting: false }}
        on_confirm={() => {}}
        on_close={() => {}}
      />,
    );

    expect(html).toContain(description);
    expect(html).toContain(action);
  });
});
