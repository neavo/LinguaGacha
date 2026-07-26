import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CustomPromptConfirmDialog } from "./custom-prompt-confirm-dialog";

const alert_dialog_props = vi.hoisted(() => {
  return {
    current: null as Record<string, unknown> | null,
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
  const messages: Record<string, string> = {
    "app.action.cancel": "取消",
    "app.toggle.enabled": "启用",
    "custom_prompt_page.confirm.enable_after_import.description": "是否启用自定义提示词功能 …?",
  };

  return {
    useI18n: () => ({
      t: (key: string) => messages[key] ?? key,
    }),
  };
});

vi.mock("@frontend/widgets/app-alert-dialog", () => {
  return {
    AppAlertDialog: (props: Record<string, unknown>) => {
      alert_dialog_props.current = props;
      return <div />;
    },
  };
});

describe("CustomPromptConfirmDialog", () => {
  it("导入后启用确认使用专用描述和按钮", () => {
    renderToStaticMarkup(
      <CustomPromptConfirmDialog
        state={{ kind: "enable-after-import", submitting: false }}
        on_confirm={vi.fn()}
        on_close={vi.fn()}
      />,
    );

    expect(alert_dialog_props.current).toMatchObject({
      open: true,
      description: "是否启用自定义提示词功能 …?",
      confirmLabel: "启用",
      cancelLabel: "取消",
      submitting: false,
    });
    expect(alert_dialog_props.current?.title).toBeUndefined();
  });

  it("原有确认动作继续使用通用标题和确认按钮", () => {
    renderToStaticMarkup(
      <CustomPromptConfirmDialog
        state={{ kind: "reset", submitting: false }}
        on_confirm={vi.fn()}
        on_close={vi.fn()}
      />,
    );

    expect(alert_dialog_props.current).toMatchObject({
      open: true,
      description: "quality_editor.confirm.reset.description",
      cancelLabel: "取消",
      submitting: false,
    });
    expect(alert_dialog_props.current?.title).toBeUndefined();
    expect(alert_dialog_props.current?.confirmLabel).toBeUndefined();
  });
});
