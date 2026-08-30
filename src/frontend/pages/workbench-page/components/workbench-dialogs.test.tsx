import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchDialogs } from "./workbench-dialogs";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("WorkbenchDialogs", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("普通确认提交主动作", () => {
    const on_confirm = vi.fn();
    render_dialog(
      {
        kind: "reset-file",
        target_rel_paths: ["demo.txt"],
        pending_path: null,
        submitting: false,
      },
      on_confirm,
      vi.fn(),
    );

    act(() =>
      document.body
        .querySelector<HTMLButtonElement>('[data-slot="alert-dialog-primary-action"]')
        ?.click(),
    );
    expect(on_confirm).toHaveBeenCalledOnce();
  });

  it("继承询问分别提交填充与不填充动作", () => {
    const on_confirm = vi.fn();
    const on_secondary = vi.fn();
    render_dialog(
      {
        kind: "inherit-import-files",
        target_rel_paths: ["demo.txt"],
        pending_path: "E:/demo.txt",
        submitting: false,
      },
      on_confirm,
      on_secondary,
    );

    act(() =>
      document.body
        .querySelector<HTMLButtonElement>('[data-slot="alert-dialog-primary-action"]')
        ?.click(),
    );
    act(() =>
      document.body
        .querySelector<HTMLButtonElement>('[data-slot="alert-dialog-secondary-action"]')
        ?.click(),
    );
    expect(on_confirm).toHaveBeenCalledOnce();
    expect(on_secondary).toHaveBeenCalledOnce();
  });

  function render_dialog(
    dialog_state: Parameters<typeof WorkbenchDialogs>[0]["dialog_state"],
    on_confirm: () => void,
    on_secondary: () => void,
  ): void {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <WorkbenchDialogs
          dialog_state={dialog_state}
          on_confirm={on_confirm}
          on_secondary={on_secondary}
          on_close={vi.fn()}
        />,
      );
    });
  }
});
