import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentAutoScroll } from "./agent-scroll";

type AutoScrollApi = ReturnType<typeof useAgentAutoScroll>;
type AutoScrollProbeProps = {
  enabled: boolean;
  on_ready: (api: AutoScrollApi) => void;
};

/** 只暴露 Hook 的公开归底 API，不复制其内部调度状态。 */
function AutoScrollProbe(props: AutoScrollProbeProps): JSX.Element | null {
  const api = useAgentAutoScroll(props.enabled);
  useEffect(() => {
    props.on_ready(api);
  }, [api, props.on_ready]);
  return null;
}

describe("useAgentAutoScroll", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let next_frame_id = 1;
  let pending_frames = new Map<number, FrameRequestCallback>(); // 可控的 requestAnimationFrame 队列

  beforeEach(() => {
    pending_frames = new Map();
    next_frame_id = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
      const id = next_frame_id++;
      pending_frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
      pending_frames.delete(id);
    });
  });

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    pending_frames.clear();
    vi.unstubAllGlobals();
  });

  async function render(element: JSX.Element): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => root?.render(element));
  }

  /** 同步执行当前帧，避免测试依赖真实时钟。 */
  function flush_frames(): void {
    const frames = [...pending_frames.values()];
    pending_frames.clear();
    for (const callback of frames) callback(0);
  }

  /** 构造可观察的滚动目标，只保留归底行为需要的几何属性。 */
  function scroll_target(): { target: HTMLElement; read_top: () => number } {
    const target = document.createElement("div");
    let scroll_top = 0;
    Object.defineProperties(target, {
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: {
        configurable: true,
        get: () => scroll_top,
        set: (value: number) => {
          scroll_top = value;
        },
      },
    });
    return { target, read_top: () => scroll_top };
  }

  it("启用时合并同一帧的内容跟随并归底", async () => {
    let api!: AutoScrollApi;
    await render(<AutoScrollProbe enabled on_ready={(next_api) => (api = next_api)} />);
    const scroll = scroll_target();

    api.follow_content(scroll.target);
    api.follow_content(scroll.target);
    expect(scroll.read_top()).toBe(0);
    expect(pending_frames.size).toBe(1);

    flush_frames();
    expect(scroll.read_top()).toBe(1_000);
  });

  it("禁用时不执行排队跟随，显式恢复仍然立即归底", async () => {
    let api!: AutoScrollApi;
    await render(<AutoScrollProbe enabled={false} on_ready={(next_api) => (api = next_api)} />);
    const scroll = scroll_target();

    api.follow_content(scroll.target);
    flush_frames();
    expect(scroll.read_top()).toBe(0);

    api.resume(scroll.target);
    expect(scroll.read_top()).toBe(1_000);
  });

  it("卸载时取消尚未执行的跟随帧", async () => {
    let api!: AutoScrollApi;
    await render(<AutoScrollProbe enabled on_ready={(next_api) => (api = next_api)} />);
    const scroll = scroll_target();
    api.follow_content(scroll.target);
    expect(pending_frames.size).toBe(1);

    await act(async () => root?.unmount());
    root = null;
    flush_frames();
    expect(scroll.read_top()).toBe(0);
  });
});
