import { act, useRef, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEntry, AgentEntryStatus } from "@shared/agent";
import { AgentChatStoreContext } from "@frontend/app/session/agent/agent-chat-context";
import { AgentChatStore } from "@frontend/app/session/agent/agent-chat-store";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AgentRoundNavigator } from "./agent-round-navigator";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

function make_user_round(
  id: string,
  text: string,
  status: AgentEntryStatus = "success",
): AgentEntry {
  return {
    kind: "user_message",
    delivery: "round",
    id,
    text,
    attachments: [],
    status,
    createdAt: 1_000,
    endedAt: status === "running" ? null : 2_000,
    averageTokensPerSecond: null,
  };
}

function make_steer(id: string, text: string): AgentEntry {
  return {
    kind: "user_message",
    delivery: "steer",
    id,
    text,
    attachments: [],
    status: "success",
    createdAt: 1_500,
    endedAt: 1_500,
  };
}

function make_assistant(
  id: string,
  parts: Extract<AgentEntry, { kind: "assistant_message" }>["parts"],
  status: AgentEntryStatus = "success",
): AgentEntry {
  return {
    kind: "assistant_message",
    id,
    parts,
    status,
    createdAt: 1_200,
  };
}

/** 模拟固定每轮高度的滚动容器，便于验证 ScrollSpy 与滑动窗口行为。 */
function install_round_geometry(
  container: HTMLElement,
  round_ids: readonly string[],
  options: { scroll_top: number; viewport_height?: number; round_height?: number },
): { set_scroll_top: (top: number) => void } {
  const viewport_height = options.viewport_height ?? 500;
  const round_height = options.round_height ?? 200;
  const scroll_height = round_ids.length * round_height;
  let scroll_top = options.scroll_top;

  Object.defineProperties(container, {
    scrollHeight: { configurable: true, get: () => scroll_height },
    clientHeight: { configurable: true, get: () => viewport_height },
    scrollTop: {
      configurable: true,
      get: () => scroll_top,
      set: (value: number) => {
        scroll_top = Math.max(0, Math.min(value, Math.max(0, scroll_height - viewport_height)));
      },
    },
  });
  container.getBoundingClientRect = () => new DOMRect(0, 0, 800, viewport_height);

  for (const [index, round_id] of round_ids.entries()) {
    const anchor = container.querySelector<HTMLElement>(`[data-agent-round-id="${round_id}"]`);
    if (anchor === null) continue;
    anchor.getBoundingClientRect = () =>
      new DOMRect(0, index * round_height - scroll_top, 760, round_height);
  }

  return {
    set_scroll_top: (top: number) => {
      container.scrollTop = top;
    },
  };
}

function NavigatorHarness({
  store,
  round_ids,
  on_jump,
  on_conversation_ready,
}: {
  store: AgentChatStore;
  round_ids: readonly string[];
  on_jump: (round_id: string) => void;
  on_conversation_ready: (element: HTMLElement | null) => void;
}): JSX.Element {
  const conversation_ref = useRef<HTMLElement | null>(null);
  return (
    <AgentChatStoreContext.Provider value={store}>
      <TooltipProvider delay={0}>
        <div className="agent-page">
          <section
            ref={(node) => {
              conversation_ref.current = node;
              on_conversation_ready(node);
            }}
            className="agent-page__conversation"
          >
            <div>
              {round_ids.map((round_id) => (
                <div key={round_id} data-agent-round-id={round_id} />
              ))}
            </div>
          </section>
          <AgentRoundNavigator active conversation_ref={conversation_ref} on_jump={on_jump} />
        </div>
      </TooltipProvider>
    </AgentChatStoreContext.Provider>
  );
}

describe("AgentRoundNavigator", () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;
  let store: AgentChatStore;
  let conversation: HTMLElement | null = null;
  const on_jump = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    store = new AgentChatStore(window.localStorage, () => {});
    conversation = null;
    on_jump.mockReset();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
  });

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    conversation = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function render_entries(entries: readonly AgentEntry[]): Promise<HTMLDivElement> {
    if (host === null) {
      host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
    }
    await act(async () => {
      store.timeline.replace(entries);
      store.timeline.notify();
      const round_ids = store.timeline.read().roundIds;
      root?.render(
        <NavigatorHarness
          store={store}
          round_ids={round_ids}
          on_jump={on_jump}
          on_conversation_ready={(element) => {
            conversation = element;
          }}
        />,
      );
    });
    return host;
  }

  async function hover_trigger(trigger: HTMLElement): Promise<void> {
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 12, clientY: 12 }),
      );
      trigger.dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true, clientX: 12, clientY: 12 }),
      );
      trigger.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 12, clientY: 12 }),
      );
      vi.runAllTimers();
    });
  }

  it("少于两个回合时不显示，插话不单独建点", async () => {
    const view = await render_entries([
      make_user_round("r1", "第一句"),
      make_steer("s1", "中途插话"),
      make_assistant("a1", [{ kind: "text", text: "收到" }]),
    ]);
    expect(view.querySelector(".agent-round-nav")).toBeNull();

    await render_entries([
      make_user_round("r1", "第一句"),
      make_steer("s1", "中途插话"),
      make_assistant("a1", [{ kind: "text", text: "收到" }]),
      make_user_round("r2", "第二句"),
      make_assistant("a2", [{ kind: "text", text: "好的" }]),
    ]);
    const items = [...view.querySelectorAll<HTMLButtonElement>(".agent-round-nav__item")];
    expect(items.map((item) => item.dataset.roundId)).toEqual(["r1", "r2"]);
  });

  it("超过 11 个回合时按 5+1+5 建立滞后窗口，窗内滚动不动窗口、触边时推移", async () => {
    const entries: AgentEntry[] = [];
    const round_ids: string[] = [];
    for (let index = 1; index <= 30; index++) {
      const round_id = `r${index.toString()}`;
      round_ids.push(round_id);
      entries.push(
        make_user_round(round_id, `用户第 ${index.toString()} 轮`),
        make_assistant(`a${index.toString()}`, [
          { kind: "text", text: `回复 ${index.toString()}` },
        ]),
      );
    }

    const view = await render_entries(entries);
    if (conversation === null) throw new Error("缺少对话容器");
    const scroll = install_round_geometry(conversation, round_ids, { scroll_top: 2_800 });

    // 首次同步落在第 15 轮（index=14, top=2800），按 5+1+5 居中展示 r10..r20 共 11 个点
    await act(async () => {
      conversation?.dispatchEvent(new Event("scroll"));
      vi.runAllTimers();
    });

    const read_window = () => {
      const items = [...view.querySelectorAll<HTMLButtonElement>(".agent-round-nav__item")];
      return {
        ids: items.map((item) => item.dataset.roundId),
        active_id: items.find((item) => item.dataset.active === "true")?.dataset.roundId,
      };
    };

    expect(read_window()).toEqual({
      ids: ["r10", "r11", "r12", "r13", "r14", "r15", "r16", "r17", "r18", "r19", "r20"],
      active_id: "r15",
    });

    // 在窗口内部滚到第 12 轮（index=11, top=2200）：激活点真实前移，窗口切片保持不变
    scroll.set_scroll_top(2_200);
    await act(async () => {
      conversation?.dispatchEvent(new Event("scroll"));
      vi.runAllTimers();
    });
    expect(read_window()).toEqual({
      ids: ["r10", "r11", "r12", "r13", "r14", "r15", "r16", "r17", "r18", "r19", "r20"],
      active_id: "r12",
    });

    // 继续向上触及边缘缓冲到第 10 轮（index=9, top=1800）：窗口前移保留上方 2 个缓冲点（r8..r18）
    const active_slot_before_shift = view.querySelector<HTMLButtonElement>(
      '.agent-round-nav__item[data-active="true"]',
    );
    scroll.set_scroll_top(1_800);
    await act(async () => {
      conversation?.dispatchEvent(new Event("scroll"));
      vi.runAllTimers();
    });
    expect(read_window()).toEqual({
      ids: ["r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15", "r16", "r17", "r18"],
      active_id: "r10",
    });
    // 窗口推移时激活槽位复用同一 DOM 节点，不把旧激活点搬到相邻槽位淡出
    expect(
      view.querySelector<HTMLButtonElement>('.agent-round-nav__item[data-active="true"]'),
    ).toBe(active_slot_before_shift);

    // 滚到底部时贴边补齐为最后 11 个点（r20..r30）
    scroll.set_scroll_top(6_000);
    await act(async () => {
      conversation?.dispatchEvent(new Event("scroll"));
      vi.runAllTimers();
    });
    expect(read_window()).toEqual({
      ids: ["r20", "r21", "r22", "r23", "r24", "r25", "r26", "r27", "r28", "r29", "r30"],
      active_id: "r30",
    });
  });

  it("悬停展示双块预览，统一合并连续换行并替换为可见回车，且回退空正文与纯思考尾条", async () => {
    const view = await render_entries([
      make_user_round("r1", "\n第一行\n\n  \n  第二行需求\n"),
      make_assistant("a1-text", [
        {
          kind: "text",
          text: "### 标题\n\n- **重点** [文档](https://example.com)\n|步骤|结果|\n|---|---|\n|导入|`ok`|",
        },
      ]),
      make_assistant("a1-thinking-only", [{ kind: "thinking", text: "内部思考不应出现在预览" }]),
      make_user_round("r2", "", "running"),
    ]);

    const items = [...view.querySelectorAll<HTMLButtonElement>(".agent-round-nav__item")];
    await hover_trigger(items[0]!);
    expect(document.querySelector(".agent-round-nav__user")?.textContent).toBe(
      "第一行 ↵ 第二行需求",
    );
    expect(document.querySelector(".agent-round-nav__assistant")?.textContent).toBe(
      "标题 ↵ 重点 文档 ↵ 步骤 结果 ↵ 导入 ok",
    );

    await hover_trigger(items[1]!);
    expect(document.querySelector(".agent-round-nav__user")?.textContent).toBe(
      "agent_page.queue.no_message_text",
    );
    expect(document.querySelector(".agent-round-nav__assistant")?.textContent).toBe(
      "agent_page.status.running",
    );
  });

  it("点击圆点触发跳转，激活点随滚动条一路滑到目标位置", async () => {
    const view = await render_entries([
      make_user_round("r1", "第一轮"),
      make_assistant("a1", [{ kind: "text", text: "回复一" }]),
      make_user_round("r2", "第二轮"),
      make_assistant("a2", [{ kind: "text", text: "回复二" }]),
      make_user_round("r3", "第三轮"),
      make_assistant("a3", [{ kind: "text", text: "回复三" }]),
    ]);
    if (conversation === null) throw new Error("缺少对话容器");
    const scroll = install_round_geometry(conversation, ["r1", "r2", "r3"], {
      scroll_top: 700,
      round_height: 400,
    });
    await act(async () => {
      conversation?.dispatchEvent(new Event("scroll"));
      vi.runAllTimers();
    });

    const items = [...view.querySelectorAll<HTMLButtonElement>(".agent-round-nav__item")];
    expect(items[2]!.dataset.active).toBe("true");

    await act(async () => {
      items[0]!.click();
    });
    expect(on_jump).toHaveBeenCalledWith("r1");

    // 平滑滚动途中经过 r2、最终抵达 r1，激活点跟随滚动条逐一推进
    scroll.set_scroll_top(400);
    await act(async () => {
      conversation?.dispatchEvent(new Event("scroll"));
      vi.runAllTimers();
    });
    expect(items[1]!.dataset.active).toBe("true");

    scroll.set_scroll_top(0);
    await act(async () => {
      conversation?.dispatchEvent(new Event("scroll"));
      vi.runAllTimers();
    });
    expect(items[0]!.dataset.active).toBe("true");
  });
});
