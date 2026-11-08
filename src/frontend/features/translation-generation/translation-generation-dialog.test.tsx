import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TranslationGenerationDialog } from "./translation-generation-dialog";
import type { TranslationGenerationState } from "./use-translation-generation-flow";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("TranslationGenerationDialog", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root !== null) act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it.each([false, true])("警告框优先显示，存在格式限制时只提供下一步：%s", (has_next) => {
    const next_step = vi.fn();
    const confirm_generation = vi.fn(async () => {});
    render_dialog(
      {
        phase: "ready",
        step: "warnings",
        warning_count: 3,
        files_revision: 0,
        has_supported_files: true,
        has_agent_files: has_next,
      },
      { next_step, confirm_generation },
    );
    expect(document.body.textContent).toContain(
      "app.translation_generation.confirmation.warning_description",
    );
    const primary = document.body.querySelector<HTMLButtonElement>(
      '[data-slot="alert-dialog-primary-action"]',
    )!;
    expect(primary.textContent).toContain(
      has_next ? "app.action.next" : "app.translation_generation.confirmation.generate_directly",
    );
    act(() => primary.click());
    expect(next_step).toHaveBeenCalledTimes(Number(has_next));
    expect(confirm_generation).toHaveBeenCalledTimes(Number(!has_next));
  });

  it.each([true, false])("格式确认只显示提示与动作，可直接生成：%s", (has_supported_files) => {
    const jump_to_agent = vi.fn();
    const confirm_generation = vi.fn(async () => {});
    render_dialog(
      {
        phase: "ready",
        step: "files",
        warning_count: 0,
        files_revision: 0,
        has_supported_files,
        has_agent_files: true,
      },
      { jump_to_agent, confirm_generation },
    );
    expect(document.body.querySelector("ul")).toBeNull();
    expect(document.body.textContent).toContain(
      "app.translation_generation.confirmation.generic_description",
    );
    expect(
      document.body.querySelector('[data-slot="alert-dialog-primary-action"]')?.textContent,
    ).toContain("app.action.handle_with_agent");
    if (has_supported_files)
      expect(
        document.body.querySelector('[data-slot="alert-dialog-secondary-action"]')?.textContent,
      ).toContain("app.translation_generation.confirmation.generate_directly");
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
    expect(jump_to_agent).toHaveBeenCalledOnce();
    expect(confirm_generation).toHaveBeenCalledTimes(has_supported_files ? 1 : 0);
  });
  it("全部可直接生成时显示普通确认", () => {
    const confirm_generation = vi.fn(async () => {});
    render_dialog(
      {
        phase: "ready",
        step: "files",
        warning_count: 0,
        files_revision: 0,
        has_supported_files: true,
        has_agent_files: false,
      },
      { confirm_generation },
    );
    expect(document.body.querySelector('[data-slot="alert-dialog-secondary-action"]')).toBeNull();
    act(() =>
      document.body
        .querySelector<HTMLButtonElement>('[data-slot="alert-dialog-primary-action"]')
        ?.click(),
    );
    expect(confirm_generation).toHaveBeenCalledOnce();
  });
  /** 通过公开流程状态驱动确认与警告分流。 */
  function render_dialog(
    state: TranslationGenerationState,
    callbacks: {
      jump_to_agent?: () => void;
      next_step?: () => void;
      confirm_generation?: () => Promise<void>;
    } = {},
  ): void {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <TranslationGenerationDialog
          state={state}
          retry_check={vi.fn()}
          next_step={callbacks.next_step ?? vi.fn()}
          confirm_generation={callbacks.confirm_generation ?? vi.fn(async () => {})}
          jump_to_agent={callbacks.jump_to_agent ?? vi.fn()}
          close={vi.fn()}
        />,
      );
    });
  }
});
