import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AgentTaskToolbar } from "./agent-task-toolbar";

const mocks = vi.hoisted(() => ({ open_external_url: vi.fn() }));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({
  open_external_url: mocks.open_external_url,
}));

describe("AgentTaskToolbar", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.useRealTimers();
    mocks.open_external_url.mockReset();
  });

  it("底栏末项在任务不可用时仍打开 Wiki 首页", async () => {
    const view = await render({
      disconnected: true,
      approval_disabled: true,
      open_instructions: <button type="button">instructions</button>,
    });
    const buttons = [...view.querySelectorAll<HTMLButtonElement>("button")];
    const help = buttons.find((button) => button.textContent === "agent_page.action.help")!;
    expect(buttons.at(-1)).toBe(help);
    await act(async () => help.click());
    expect(mocks.open_external_url).toHaveBeenCalledExactlyOnceWith(
      "https://github.com/neavo/LinguaGacha/wiki",
    );
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
        <TooltipProvider delay={0}>
          <input />
          <AgentTaskToolbar
            language_control={null}
            add_file={null}
            open_instructions={null}
            locked={false}
            context={{ tokens: null, compactable: false, limits: null }}
            usage={{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }}
            model_selection={{
              snapshot: {
                models: [],
                model_selection: {
                  agent: "",
                  translation: "",
                  agent_batch_translation: null,
                  agent_media: null,
                },
              },
              loading: false,
              updating: false,
              select_model: async () => {},
            }}
            approval_mode="manual"
            approval_disabled={false}
            disconnected={false}
            on_agent_model_select={vi.fn()}
            on_approval_mode_change={vi.fn()}
            {...props}
          />
        </TooltipProvider>,
      ),
    );
    return container;
  }
});
