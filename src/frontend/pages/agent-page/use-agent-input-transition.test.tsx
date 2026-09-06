import { act, useRef, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPendingDecision } from "@shared/agent";
import type { AgentComposerHandle } from "./agent-composer";
import { useAgentInputTransition } from "./use-agent-input-transition";

/** 测试只推进浏览器动画的完成信号，尺寸插值由实际界面验证。 */
class TestAnimation {
  onfinish: (() => void) | null = null;
  private cancelled = false;
  /** 撤销动画后，其完成信号失效。 */
  cancel(): void {
    this.cancelled = true;
  }
  /** 由测试推进仍有效的完成回调。 */
  finish(): void {
    if (!this.cancelled) this.onfinish?.();
  }
}

/** 通过最小消费方的决定内容与发送能力观察过渡。 */
function Probe({ decision }: { decision: AgentPendingDecision | null }): JSX.Element {
  const composer = useRef<AgentComposerHandle>(null);
  const layout = useAgentInputTransition(decision, composer);
  return (
    <div ref={layout.region_ref} style={{ padding: 0 }}>
      <div ref={layout.area_ref}>
        <div ref={layout.status_ref} />
        <div ref={layout.decision_ref}>
          {layout.visible_decision && <h2 ref={layout.title_ref}>{layout.visible_decision.id}</h2>}
        </div>
        <div ref={layout.composer_slot_ref} />
        <button disabled={layout.locked}>发送</button>
      </div>
    </div>
  );
}

/** 提供含固定选项的待决快照。 */
function question(id: string): AgentPendingDecision {
  return {
    id,
    kind: "question",
    expiresAt: Date.now() + 300_000,
    question: {
      prompt: "选择范围",
      options: [
        { id: "all", label: "全部" },
        { id: "chapter", label: "当前章节" },
      ],
    },
  };
}

describe("useAgentInputTransition", () => {
  let container: HTMLDivElement;
  let root: Root;
  let animations: TestAnimation[];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    animations = [];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 720, 120),
    );
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    // happy-dom 的 WAAPI 由显式完成信号替代。
    vi.spyOn(HTMLElement.prototype, "animate").mockImplementation(() => {
      const animation = new TestAnimation();
      animations.push(animation);
      return animation as unknown as Animation;
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** 复用组件实例，并覆盖应用实际使用的 StrictMode 挂载重放。 */
  async function render(decision: AgentPendingDecision | null): Promise<void> {
    await act(async () =>
      root.render(
        <StrictMode>
          <Probe decision={decision} />
        </StrictMode>,
      ),
    );
  }

  /** 同步推进已创建动画的完成信号。 */
  async function finish(): Promise<void> {
    await act(async () => {
      for (const animation of animations) animation.finish();
    });
  }

  it.each([false, true])(
    "输入锁保持到离场完成并释放内容与占位（减少动态效果：%s）",
    async (reduced) => {
      vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
      await render(question("first"));
      expect(animations).toHaveLength(0);
      await render(null);
      expect(container.querySelector("h2")?.textContent).toBe("first");
      expect(container.querySelector("button")?.disabled).toBe(true);
      await finish();
      expect(container.querySelector("h2")).toBeNull();
      expect(container.querySelector("button")?.disabled).toBe(false);
      expect(container.querySelector("[data-transitioning]")).toBeNull();
      expect((container.firstElementChild as HTMLElement).style.height).toBe("");
    },
  );

  it("离场中出现下一项决定时继续锁定，并由最新过渡收尾", async () => {
    await render(null);
    await render(question("first"));
    await render(null);
    await render(question("second"));
    await finish();
    expect(container.querySelector("h2")?.textContent).toBe("second");
    expect(container.querySelector("button")?.disabled).toBe(true);
    expect(container.querySelector("[data-transitioning]")).toBeNull();
    await render(null);
    expect(container.querySelector("h2")?.textContent).toBe("second");
    expect(container.querySelector("button")?.disabled).toBe(true);
    await finish();
    expect(container.querySelector("button")?.disabled).toBe(false);
  });
  it("窗口变化结束离场并释放输入锁，后续动画完成不会重复收尾", async () => {
    await render(question("first"));
    await render(null);
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(container.querySelector("h2")).toBeNull();
    expect(container.querySelector("button")?.disabled).toBe(false);
    expect((container.firstElementChild as HTMLElement).style.height).toBe("");
    await render(question("second"));
    await finish();
    expect(container.querySelector("h2")?.textContent).toBe("second");
    expect(container.querySelector("button")?.disabled).toBe(true);
  });

  it("卸载时撤销动画并解除窗口监听", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    await render(null);
    await render(question("first"));
    await act(async () => root.render(null));
    expect(animations.every((animation) => animation.onfinish === null)).toBe(true);
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    await finish();
    expect(container.childElementCount).toBe(0);
  });
});
