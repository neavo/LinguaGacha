import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AgentTaskToolbar } from "./agent-task-toolbar";

const request_export = vi.hoisted(() => vi.fn());
vi.mock("@frontend/app/session/translation-export/translation-export-context", () => ({
  useTranslationExport: () => ({ can_request_export: true, request_export }),
}));
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("AgentTaskToolbar", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    request_export.mockClear();
  });

  it("新任务按钮与输入中的快捷键共用可用性", async () => {
    const on_reset = vi.fn();
    const view = await render({ can_reset: true, on_reset });
    const input = view.querySelector("input")!;
    const trigger = async () => {
      const event = new KeyboardEvent("keydown", {
        key: "n",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        input.focus();
        input.dispatchEvent(event);
      });
      return event;
    };
    expect((await trigger()).defaultPrevented).toBe(true);
    expect(on_reset).toHaveBeenCalledOnce();
    await render({ can_reset: false, on_reset });
    expect((await trigger()).defaultPrevented).toBe(false);
    await act(async () => view.querySelector<HTMLButtonElement>(".agent-composer__reset")?.click());
    expect(on_reset).toHaveBeenCalledOnce();
  });

  it("新任务不可用时仍可生成译文和修改审批模式", async () => {
    const on_approval_mode_change = vi.fn();
    const view = await render({ can_reset: false, on_approval_mode_change });
    await act(async () =>
      view.querySelector<HTMLButtonElement>(".agent-composer__export")?.click(),
    );
    expect(request_export).toHaveBeenCalledOnce();
    await act(async () =>
      view.querySelector<HTMLButtonElement>(".agent-composer__approval-trigger")?.click(),
    );
    const auto = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (item) => item.textContent?.includes("agent_page.approval.auto"),
    )!;
    await act(async () => auto.click());
    expect(on_approval_mode_change).toHaveBeenCalledWith("auto");
  });

  it("收起底部交互时关闭审批菜单，恢复后保持关闭", async () => {
    const view = await render({});
    await act(async () =>
      view.querySelector<HTMLButtonElement>(".agent-composer__approval-trigger")!.click(),
    );
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await render({ locked: true });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await render({ locked: false });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  /** 工具栏在普通输入框有焦点时仍响应快捷键。 */
  async function render(
    props: Partial<ComponentProps<typeof AgentTaskToolbar>>,
  ): Promise<HTMLDivElement> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
    }
    root ??= createRoot(container);
    await act(async () =>
      root?.render(
        <TooltipProvider>
          <input />
          <AgentTaskToolbar
            locked={false}
            can_reset={false}
            context={{ tokens: null, compactable: false, limits: null }}
            model_selection={{
              snapshot: {
                models: [],
                model_selection: { agent: "", translation: "", agent_batch_translation: null },
              },
              loading: false,
              updating: false,
              select_model: async () => {},
              update_thinking_level: async () => {},
            }}
            approval_mode="manual"
            approval_disabled={false}
            disconnected={false}
            on_reset={vi.fn()}
            {...props}
          />
        </TooltipProvider>,
      ),
    );
    return container;
  }
});
