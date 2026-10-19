import { act, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentMessageInput } from "@shared/agent";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import type { AgentMessageEditor } from "./agent-message-editor";

const push_toast = vi.hoisted(() => vi.fn());
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: push_toast,
}));

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("./agent-message-editor", () => ({
  AgentMessageEditor: (
    props: Pick<
      ComponentProps<typeof AgentMessageEditor>,
      "input_state" | "on_submit" | "render_actions"
    >,
  ) => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        props.on_submit({ text: "新内容", attachments: [] });
      }}
    >
      <span data-draft>{props.input_state.draft.read().text}</span>
      {props.render_actions({ has_content: true, uploads_pending: false }).submit}
    </form>
  ),
}));

import { AgentInlineEditor, type AgentInlineEditTarget } from "./agent-inline-editor";

describe("AgentInlineEditor", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
  });

  it("保存成功后把独立草稿交回父层", async () => {
    const on_save = vi.fn(async () => undefined);
    const on_saved = vi.fn();
    const view = render_editor(on_save, on_saved);

    expect(view.querySelector("[data-draft]")?.textContent).toBe("原内容");
    await act(async () =>
      view.querySelector<HTMLButtonElement>('[aria-label="app.action.save"]')?.click(),
    );

    expect(on_save).toHaveBeenCalledWith({ text: "新内容", attachments: [] });
    expect(on_saved).toHaveBeenCalledWith({ text: "新内容", attachments: [] });
  });

  it("保存期间锁定取消，完成后交回父层", async () => {
    let release_save = (): void => {
      throw new Error("保存 Promise 尚未建立");
    };
    const on_save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release_save = resolve;
        }),
    );
    const on_cancel = vi.fn();
    const on_saved = vi.fn();
    const view = render_editor(on_save, on_saved, on_cancel);

    await act(async () =>
      view.querySelector<HTMLButtonElement>('[aria-label="app.action.save"]')?.click(),
    );
    const save = view.querySelector<HTMLButtonElement>('[aria-label="app.action.save"]')!;
    const cancel = view.querySelector<HTMLButtonElement>('[aria-label="app.action.cancel"]')!;
    expect(save.disabled).toBe(true);
    expect(save.getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(save.querySelector("kbd")?.textContent).toBe("Enter");
    expect(cancel.getAttribute("aria-keyshortcuts")).toBe("Escape");
    expect(cancel.querySelector("kbd")?.textContent).toBe("Esc");
    await act(async () => {
      save.click();
      cancel.click();
    });
    expect(on_save).toHaveBeenCalledOnce();
    expect(on_cancel).not.toHaveBeenCalled();

    release_save();
    await act(async () => await Promise.resolve());
    expect(on_saved).toHaveBeenCalledWith({ text: "新内容", attachments: [] });
  });

  it("保存失败后保留草稿与键位，并允许再次保存", async () => {
    const on_cancel = vi.fn();
    const failed_save = vi.fn(async (): Promise<void> => {
      throw new Error("offline");
    });
    const failed_view = render_editor(failed_save, vi.fn(), on_cancel);
    await act(async () =>
      failed_view.querySelector<HTMLButtonElement>('[aria-label="app.action.save"]')?.click(),
    );
    expect(push_toast).toHaveBeenCalledWith("app.feedback.modify_failed", expect.any(Error));
    const save = failed_view.querySelector<HTMLButtonElement>('[aria-label="app.action.save"]')!;
    expect(save.disabled).toBe(false);
    expect(save.getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(save.querySelector("kbd")?.textContent).toBe("Enter");
    failed_save.mockResolvedValueOnce(undefined);
    await act(async () =>
      failed_view.querySelector<HTMLButtonElement>('[aria-label="app.action.save"]')?.click(),
    );
    expect(failed_save).toHaveBeenCalledTimes(2);
  });

  it("保存失败后仍可取消", async () => {
    const on_cancel = vi.fn();
    const failed_view = render_editor(
      async () => {
        throw new Error("offline");
      },
      vi.fn(),
      on_cancel,
    );
    await act(async () =>
      failed_view.querySelector<HTMLButtonElement>('[aria-label="app.action.save"]')?.click(),
    );
    await act(async () =>
      failed_view.querySelector<HTMLButtonElement>('[aria-label="app.action.cancel"]')?.click(),
    );
    expect(on_cancel).toHaveBeenCalledOnce();
  });

  /** 隔离正文编辑，观察保存失败与取消的生命周期。 */
  function render_editor(
    on_save: (message: AgentMessageInput) => Promise<void>,
    on_saved: (message: AgentMessageInput) => void,
    on_cancel: () => void = vi.fn(),
  ): HTMLDivElement {
    const target: AgentInlineEditTarget = {
      kind: "entry",
      entryId: "entry-1",
      role: "user",
      message: { text: "原内容", attachments: [] },
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <StrictMode>
          <TooltipProvider>
            <AgentInlineEditor
              target={target}
              skills={[]}
              command={null}
              unavailable_reason={null}
              on_save={on_save}
              on_saved={on_saved}
              on_cancel={on_cancel}
            />
          </TooltipProvider>
        </StrictMode>,
      );
    });
    return container;
  }
});
