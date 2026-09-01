import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TranslationExportDialog } from "./translation-export-dialog";
import type { TranslationExportState } from "./use-translation-export-flow";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params?.COUNT === undefined ? key : `${key}:${params.COUNT}`,
  }),
}));

describe("TranslationExportDialog", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root !== null) act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("有警告时显示类型计数并提供前往 AGENT 与继续任务", () => {
    const jump_to_agent = vi.fn();
    const confirm_export = vi.fn(async () => {});
    render_dialog(
      {
        phase: "ready",
        summary: {
          total_count: 3,
          entries: [
            { code: "FOREIGN_CHAR_RESIDUE", count: 1 },
            { code: "GLOSSARY", count: 2 },
          ],
        },
      },
      { jump_to_agent, confirm_export },
    );

    expect(document.body.textContent).toContain(
      "workbench_page.translation_export.warning_description:3",
    );
    expect(document.body.textContent).toContain("proofreading_page.warning.foreign_char_residue1");
    expect(document.body.textContent).toContain("proofreading_page.warning.glossary2");
    act(() =>
      document.body
        .querySelector<HTMLButtonElement>('[data-slot="alert-dialog-secondary-action"]')
        ?.click(),
    );
    act(() =>
      document.body
        .querySelector<HTMLButtonElement>('[data-slot="alert-dialog-primary-action"]')
        ?.click(),
    );
    expect(jump_to_agent).toHaveBeenCalledOnce();
    expect(confirm_export).toHaveBeenCalledOnce();
  });

  it("无警告时直接提交确认动作", () => {
    const confirm_export = vi.fn(async () => {});
    render_dialog({ phase: "ready", summary: { total_count: 0, entries: [] } }, { confirm_export });

    expect(document.body.querySelector('[data-slot="alert-dialog-secondary-action"]')).toBeNull();
    act(() =>
      document.body
        .querySelector<HTMLButtonElement>('[data-slot="alert-dialog-primary-action"]')
        ?.click(),
    );
    expect(confirm_export).toHaveBeenCalledOnce();
  });

  function render_dialog(
    state: TranslationExportState,
    callbacks: {
      jump_to_agent?: () => void;
      confirm_export?: () => Promise<void>;
    } = {},
  ): void {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <TranslationExportDialog
          state={state}
          retry_check={vi.fn()}
          confirm_export={callbacks.confirm_export ?? vi.fn(async () => {})}
          jump_to_agent={callbacks.jump_to_agent ?? vi.fn()}
          close={vi.fn()}
        />,
      );
    });
  }
});
