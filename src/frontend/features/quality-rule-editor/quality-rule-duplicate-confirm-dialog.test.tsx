import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AppActionDialog } from "@frontend/widgets/app-alert-dialog";
import { QualityRuleDuplicateConfirmDialog } from "./quality-rule-duplicate-confirm-dialog";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/widgets/app-alert-dialog", () => ({
  AppActionDialog: (props: ComponentProps<typeof AppActionDialog>) => (
    <>
      <button data-action="overwrite" onClick={() => void props.primaryAction.onSelect()} />
      {props.secondaryAction && (
        <button data-action="skip" onClick={() => void props.secondaryAction!.onSelect()} />
      )}
      <button data-action="cancel" onClick={props.onClose} />
    </>
  ),
}));

it("单条编辑提供覆盖与取消，批量导入额外开放跳过", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const overwrite = vi.fn(),
    skip = vi.fn(),
    cancel = vi.fn();
  try {
    act(() =>
      root.render(
        <QualityRuleDuplicateConfirmDialog
          state={{ open: true, duplicate_count: 1, submitting: false, allow_skip: false }}
          on_overwrite={overwrite}
          on_skip={skip}
          on_close={cancel}
        />,
      ),
    );
    expect(container.querySelector('[data-action="skip"]')).toBeNull();
    act(() => (container.querySelector('[data-action="overwrite"]') as HTMLButtonElement).click());
    act(() => (container.querySelector('[data-action="cancel"]') as HTMLButtonElement).click());
    expect(overwrite).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    act(() =>
      root.render(
        <QualityRuleDuplicateConfirmDialog
          state={{ open: true, duplicate_count: 1, submitting: false, allow_skip: true }}
          on_overwrite={overwrite}
          on_skip={skip}
          on_close={cancel}
        />,
      ),
    );
    act(() => (container.querySelector('[data-action="skip"]') as HTMLButtonElement).click());
    expect(skip).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
  }
});
