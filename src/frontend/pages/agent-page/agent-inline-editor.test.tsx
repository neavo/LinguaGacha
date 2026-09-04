import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentMessageInput } from "@shared/agent";
import type { AgentInputSession } from "@frontend/app/session/agent/agent-session-context";
import type { ModelSelectionController } from "@frontend/features/model-selection/use-model-selection";

type MockComposerProps = {
  input_session: AgentInputSession;
  locked?: boolean;
  on_send: (message: AgentMessageInput) => void;
  on_cancel_edit?: () => void;
};

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@frontend/app/feedback/visible-error-message", () => ({
  resolve_visible_error_message: (_error: unknown, _t: unknown, fallback: string) => fallback,
}));

vi.mock("./agent-composer", () => ({
  AgentComposer: (props: MockComposerProps) => (
    <div data-locked={props.locked ? "true" : "false"}>
      <span data-draft>{props.input_session.read_draft().text}</span>
      <button
        type="button"
        data-send
        onClick={() => props.on_send({ text: "新内容", attachments: [] })}
      >
        send
      </button>
      <button type="button" data-cancel disabled={props.locked} onClick={props.on_cancel_edit}>
        cancel
      </button>
    </div>
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
    await act(async () => view.querySelector<HTMLButtonElement>("[data-send]")?.click());

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

    await act(async () => view.querySelector<HTMLButtonElement>("[data-send]")?.click());
    expect(view.querySelector<HTMLDivElement>("[data-locked]")?.dataset.locked).toBe("true");
    await act(async () => view.querySelector<HTMLButtonElement>("[data-cancel]")?.click());
    expect(on_cancel).not.toHaveBeenCalled();

    release_save();
    await act(async () => await Promise.resolve());
    expect(on_saved).toHaveBeenCalledWith({ text: "新内容", attachments: [] });
  });

  it("保存失败后保留编辑器并允许再次取消", async () => {
    const on_cancel = vi.fn();
    const failed_save = vi.fn(async () => {
      throw new Error("offline");
    });
    const failed_view = render_editor(failed_save, vi.fn(), on_cancel);
    await act(async () => failed_view.querySelector<HTMLButtonElement>("[data-send]")?.click());
    expect(failed_view.querySelector('[role="alert"]')?.textContent).toContain(
      "agent_page.error.edit",
    );
    await act(async () => failed_view.querySelector<HTMLButtonElement>("[data-cancel]")?.click());
    expect(on_cancel).toHaveBeenCalledOnce();
  });

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
    const model_selection: ModelSelectionController = {
      snapshot: {
        model_selection: { translation: "", analysis: "", agent: "" },
        models: [],
      },
      loading: false,
      updating: false,
      select_model: async () => undefined,
      update_thinking_level: async () => undefined,
    };
    act(() => {
      root?.render(
        <AgentInlineEditor
          target={target}
          skills={[]}
          command={null}
          model_selection={model_selection}
          unavailable_reason={null}
          on_save={on_save}
          on_saved={on_saved}
          on_cancel={on_cancel}
          on_image_error={vi.fn()}
        />,
      );
    });
    return container;
  }
});
